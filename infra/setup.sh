#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash setup.sh"
  exit 1
fi

echo "=== Installing dependencies ==="
apt-get update -qq
apt-get install -y tor clamav clamav-daemon unattended-upgrades ufw postgresql nginx

echo "=== Creating secure directories ==="
mkdir -p /var/secure /var/secure-queue /var/secure-submissions
chmod 700 /var/secure /var/secure-queue /var/secure-submissions

useradd -r -s /sbin/nologin -d /var/secure journalist-platform 2>/dev/null || true
chown journalist-platform:journalist-platform /var/secure /var/secure-queue /var/secure-submissions

echo "=== Setting up PostgreSQL ==="
systemctl enable postgresql
systemctl start postgresql
sudo -u postgres createuser journalist-platform --no-superuser --no-createdb --no-createrole 2>/dev/null || true
sudo -u postgres createdb journalist_workspace --owner=journalist-platform 2>/dev/null || true

echo "=== Configuring nginx publication site ==="
mkdir -p /var/publication/articles
chown -R journalist-platform:journalist-platform /var/publication
chmod 755 /var/publication /var/publication/articles

cat > /var/publication/index.html <<'IDXEOF'
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Published Articles</title></head>
<body><h1>Published Articles</h1><p>No articles published yet.</p></body>
</html>
IDXEOF
chown journalist-platform:journalist-platform /var/publication/index.html

cp "$(dirname "$0")/nginx-publication.conf" /etc/nginx/sites-available/publication
ln -sf /etc/nginx/sites-available/publication /etc/nginx/sites-enabled/publication
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "=== Configuring Tor ==="
cp "$(dirname "$0")/torrc.template" /etc/tor/torrc
mkdir -p /var/lib/tor/source-portal /var/lib/tor/journalist-workspace /var/lib/tor/publication
chown debian-tor:debian-tor /var/lib/tor/source-portal /var/lib/tor/journalist-workspace /var/lib/tor/publication
chmod 700 /var/lib/tor/source-portal /var/lib/tor/journalist-workspace /var/lib/tor/publication

echo "=== Installing systemd units ==="
cp "$(dirname "$0")/source-portal.service" /etc/systemd/system/
cp "$(dirname "$0")/journalist-workspace.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable source-portal
systemctl enable journalist-workspace

echo "=== Enabling automatic security updates ==="
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APTEOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APTEOF

echo "=== Configuring firewall ==="
ufw default deny incoming
ufw default deny outgoing
ufw allow out on lo
ufw allow out 9001/tcp
ufw allow out 9030/tcp
ufw --force enable

echo "=== Starting Tor ==="
systemctl enable tor
systemctl start tor

echo ""
echo "=== Setup complete ==="
echo "Source portal .onion address:"
cat /var/lib/tor/source-portal/hostname 2>/dev/null || echo "(Tor still starting — check again in 30s with: cat /var/lib/tor/source-portal/hostname)"
echo ""
echo "Publication site .onion address:"
cat /var/lib/tor/publication/hostname 2>/dev/null || echo "(Tor still starting — check with: cat /var/lib/tor/publication/hostname)"
echo ""
echo "Next steps:"
echo "1. Install Bun: curl -fsSL https://bun.sh/install | bash"
echo "2. cd /opt/journalist-platform && bun install"
echo "3. systemctl start source-portal"
