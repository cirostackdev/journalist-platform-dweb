# Journalist Platform

A Tor-only anonymous source submission platform, journalist workspace, and publication site. Sources submit documents and tips through an isolated .onion portal encrypted with the newsroom's public key. Journalists use a separate .onion workspace to decrypt, review, and process submissions. Published articles are distributed via a public .onion site served through nginx.

## Prerequisites

- **Node.js/Bun**: Install Bun from https://bun.sh
- **PostgreSQL**: Version 12+
- **ffmpeg**: For media processing
- **Tor**: For .onion services and anonymous routing
- **nginx**: Reverse proxy for Tor and publication site
- **systemd**: Linux init system
- **OpenSSL**: For key generation

## First Boot

1. **Run infrastructure setup** (as root):
   ```bash
   sudo bash /opt/journalist-platform/infra/setup.sh
   ```
   This installs dependencies, creates secure directories, sets up PostgreSQL, configures nginx and Tor, and enables systemd units for both services.

2. **Generate the newsroom keypair** (from the project root):
   ```bash
   cd /opt/journalist-platform/packages/journalist-workspace
   bun run keygen
   ```
   This prints two outputs:
   - **Public Key**: Encrypts Data Encryption Keys (DEKs) when sources upload documents
   - **Private Key**: Decrypts DEKs so journalists can access submissions

   Save both keys securely — you'll need them for env var configuration below.

3. **Configure journalist-workspace env vars** in `/etc/journalist-workspace.env`:
   ```bash
   DATABASE_URL=postgres://journalist-platform@localhost/journalist_workspace
   MASTER_KEY=<32-byte hex string, 64 characters>
   NEWSROOM_PUBLIC_KEY=<public key from keygen>
   NEWSROOM_PRIVATE_KEY=<private key from keygen>
   SUBMISSION_QUEUE_DIR=/var/secure-queue
   QUEUE_ENCRYPTION_KEY=<32-byte hex string, 64 characters>
   ```

4. **Configure source-portal env vars** in `/etc/source-portal.env`:
   ```bash
   SUBMISSION_QUEUE_DIR=/var/secure-queue
   QUEUE_ENCRYPTION_KEY=<32-byte hex string, 64 characters>
   UPLOAD_DIR=/var/secure-submissions
   ```

5. **Start services**:
   ```bash
   systemctl start source-portal journalist-workspace
   ```

6. **Retrieve Tor .onion addresses**:
   ```bash
   cat /var/lib/tor/source-portal/hostname
   cat /var/lib/tor/journalist-workspace/hostname
   ```
   - Share the source-portal .onion address with sources for secure submissions
   - Access the journalist-workspace .onion address in Tor Browser to begin processing submissions

7. **Check service status**:
   ```bash
   systemctl status source-portal journalist-workspace
   journalctl -u journalist-workspace -f  # follow logs
   ```

## Master Key

The `MASTER_KEY` is a 32-byte hex string (64 hex characters) used to encrypt all sensitive data at rest. Generate one with:
```bash
openssl rand -hex 32
```

**This key is critical**: losing it means losing access to all encrypted content. Store it securely offline or in your infrastructure's secrets manager. Never commit it to version control.

## Admin Setup

After services are running, create the first admin user. Check if a `create-admin` script exists:
```bash
cd /opt/journalist-platform/packages/journalist-workspace
bun run create-admin
```

If no script exists, manually bootstrap the first admin by inserting directly into the database:
```bash
psql -U journalist-platform journalist_workspace
INSERT INTO users (email, role, password_hash) VALUES ('admin@newsroom.internal', 'admin', ...);
```

Then log into the journalist-workspace .onion service in Tor Browser and proceed with normal account management.

## Keypair Workflow

The newsroom keypair operates as follows:

- **Public Key** (shared): Sources' browsers use this to encrypt their DEKs before uploading documents. The encrypted DEK travels with the submission.
- **Private Key** (secret): Stored in the journalist-workspace env vars. When a journalist retrieves a submission, the private key decrypts the DEK, allowing access to the plaintext document.

Both keys are stored as environment variables, not as files, to minimize filesystem exposure. They are loaded at service startup and never persisted to disk.

## Troubleshooting

- **Tor onion address not generating**: Tor startup is asynchronous. Wait 30 seconds and re-check `/var/lib/tor/source-portal/hostname`.
- **Services won't start**: Check logs with `journalctl -u source-portal -n 50` and `journalctl -u journalist-workspace -n 50`.
- **Database connection failed**: Ensure PostgreSQL is running (`systemctl status postgresql`) and the journalist-platform user exists (`sudo -u postgres psql -l`).
- **Permission denied on secure directories**: Verify ownership: `ls -la /var/secure /var/secure-queue /var/secure-submissions` should all be owned by `journalist-platform:journalist-platform`.
