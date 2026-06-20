import { marked } from "marked"
import sanitizeHtml from "sanitize-html"
import { writeFileSync, mkdirSync, readdirSync, readFileSync, statSync, existsSync } from "fs"
import { join } from "path"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "strong", "em", "a", "code", "pre"],
  allowedAttributes: {
    a: ["href"],
  },
  disallowedTagsMode: "discard",
}

const DARK_CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#060B14;--surface:#0D1524;--border:#1E2A45;--border-2:#2A3A58;
    --text:#F1F5F9;--text-muted:#94A3B8;--text-subtle:#64748B;
    --green:#10B981;--green-dim:#10B98120;--green-border:#10B98130;--green-bg:#0A150E}
  html,body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;
    -webkit-font-smoothing:antialiased;min-height:100vh}
  .page{max-width:680px;margin:0 auto;padding:40px 20px 80px}
  .site-header{display:flex;align-items:center;justify-content:space-between;
    padding:16px 0 28px;border-bottom:1px solid var(--border);margin-bottom:48px}
  .logo{display:flex;align-items:center;gap:8px;text-decoration:none}
  .logo-dot{width:9px;height:9px;border-radius:50%;background:var(--green);
    box-shadow:0 0 8px #10B981aa;flex-shrink:0}
  .logo-text{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green)}
  .header-right{font-size:11px;color:var(--border-2);text-decoration:none}
  .header-right:hover{color:var(--text-subtle)}
`

const ARTICLE_CSS = `
  .progress-bar{position:fixed;top:0;left:0;right:0;height:2px;background:#111827;z-index:50}
  .progress-fill{height:100%;width:0;background:var(--green);transition:width .1s linear}
  .article-header{margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid var(--border)}
  .kicker{font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;
    letter-spacing:.12em;margin-bottom:12px}
  .article-h1{font-size:30px;font-weight:800;line-height:1.2;letter-spacing:-.02em;
    color:var(--text);margin-bottom:14px}
  .meta-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--text-subtle)}
  .meta-verified{color:var(--green)}
  .meta-dot{width:3px;height:3px;border-radius:50%;background:var(--border-2)}
  .article-content{font-family:Georgia,'Times New Roman',serif;font-size:17px;
    line-height:1.8;color:#CBD5E1;max-width:620px}
  .article-content p{margin-bottom:1.5em}
  .article-content p:first-child{font-size:19px;color:#E2E8F0;line-height:1.7;
    border-left:3px solid var(--green);padding-left:18px;margin-bottom:2em}
  .article-content h2{font-family:system-ui;font-size:18px;font-weight:700;
    color:var(--text);margin:2em 0 .8em;letter-spacing:-.01em}
  .article-content h3{font-family:system-ui;font-size:16px;font-weight:600;
    color:var(--text-muted);margin:1.5em 0 .6em}
  .article-content blockquote{border-left:3px solid var(--green);padding:12px 18px;
    background:var(--green-bg);border-radius:0 8px 8px 0;margin:1.5em 0}
  .article-content blockquote p{color:var(--text-subtle);font-style:italic;
    margin-bottom:0;font-size:16px;border:none;padding:0}
  .article-content a{color:var(--green);text-decoration:underline}
  .article-content ul,.article-content ol{padding-left:1.5em;margin-bottom:1.5em}
  .article-content li{margin-bottom:.4em}
  .article-footer{margin-top:48px;padding-top:24px;border-top:1px solid var(--border);
    display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
  .article-footer-text{font-size:11px;color:var(--border-2);line-height:1.6}
  .btn-back{font-size:12px;color:var(--green);border:1px solid var(--green-border);
    border-radius:6px;padding:7px 14px;text-decoration:none;transition:background .15s}
  .btn-back:hover{background:var(--green-dim)}
`

const INDEX_CSS = `
  .index-hero{margin-bottom:40px}
  .index-kicker{font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;
    letter-spacing:.12em;margin-bottom:10px}
  .index-h1{font-size:32px;font-weight:800;line-height:1.15;letter-spacing:-.02em;
    color:var(--text);margin-bottom:10px}
  .index-subtitle{font-size:14px;color:var(--text-subtle);line-height:1.7}
  .article-list{display:flex;flex-direction:column;gap:0}
  .article-item{display:flex;gap:20px;padding:22px 0;border-bottom:1px solid #111827;
    align-items:flex-start;text-decoration:none}
  .article-item:first-child{border-top:1px solid #111827}
  .article-item:hover .article-title{color:var(--green)}
  .article-num{font-size:11px;color:var(--border-2);font-family:monospace;font-weight:700;
    padding-top:3px;min-width:20px;flex-shrink:0}
  .article-date{font-size:11px;color:var(--text-subtle);margin-bottom:5px}
  .article-title{font-size:17px;font-weight:700;color:var(--text);line-height:1.3;
    margin-bottom:6px;transition:color .15s}
  .article-excerpt{font-size:13px;color:var(--text-subtle);line-height:1.65}
  .article-read{font-size:11px;color:var(--green);margin-top:8px;display:inline-block}
  .site-footer{margin-top:64px;padding-top:24px;border-top:1px solid #111827;
    display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
  .footer-text{font-size:11px;color:var(--border-2);line-height:1.6}
  .live-indicator{display:flex;align-items:center;gap:6px}
  .live-dot{width:6px;height:6px;border-radius:50%;background:var(--green)}
  .live-label{font-size:10px;color:var(--green);font-weight:600}
`

function extractTitleFromHtml(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (!m) return "Untitled"
  return m[1].replace(/<[^>]+>/g, "").trim()
}

function extractExcerptFromHtml(html: string): string {
  // Strip all HTML tags and collapse whitespace to get plain text
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  // Skip the title (first sentence/heading-length content) by finding first sentence break
  const firstBreak = text.search(/[.!?]\s/)
  const startAt = firstBreak > 0 && firstBreak < 120 ? firstBreak + 2 : 0
  return text.slice(startAt, startAt + 200).trim()
}

function formatDate(mtime: Date): string {
  return mtime.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

function siteHeader(rightHref: string, rightLabel: string): string {
  return `
  <header class="site-header">
    <a href="${rightHref === "../index.html" ? "../index.html" : "/"}" class="logo">
      <div class="logo-dot"></div>
      <span class="logo-text">The Newsroom</span>
    </a>
    <a href="${rightHref}" class="header-right">${rightLabel}</a>
  </header>`
}

export function updateIndex(publicationDir: string): void {
  const articlesDir = join(publicationDir, "articles")
  mkdirSync(articlesDir, { recursive: true })

  const files = readdirSync(articlesDir)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .reverse()

  const items = files.map((f, i) => {
    const filePath = join(articlesDir, f)
    const html = readFileSync(filePath, "utf8")
    const mtime = statSync(filePath).mtime
    const title = extractTitleFromHtml(html)
    const excerpt = extractExcerptFromHtml(html)
    const num = String(i + 1).padStart(2, "0")
    return `
    <a class="article-item" href="articles/${f}">
      <div class="article-num">${num}</div>
      <div>
        <div class="article-date">${formatDate(mtime)}</div>
        <div class="article-title">${title}</div>
        ${excerpt ? `<div class="article-excerpt">${excerpt.slice(0, 200)}${excerpt.length > 200 ? "…" : ""}</div>` : ""}
        <span class="article-read">Read report →</span>
      </div>
    </a>`
  }).join("\n")

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Newsroom — Published Reports</title>
  <style>${DARK_CSS}${INDEX_CSS}</style>
</head>
<body>
<div class="page">
  ${siteHeader("video-index.html", "Videos →")}
  <div class="index-hero">
    <div class="index-kicker">Investigative Journalism</div>
    <h1 class="index-h1">Published Reports</h1>
    <p class="index-subtitle">Independently verified reporting sourced through encrypted, anonymous submissions.</p>
  </div>
  <div class="article-list">
    ${items || '<p style="color:var(--text-subtle);padding:40px 0;text-align:center;">No articles published yet.</p>'}
  </div>
  <footer class="site-footer">
    <span class="footer-text">All reports verified and published by the newsroom.<br>This site is only accessible over Tor.</span>
    <div class="live-indicator">
      <div class="live-dot"></div>
      <span class="live-label">Live</span>
    </div>
  </footer>
</div>
</body>
</html>`

  writeFileSync(join(publicationDir, "index.html"), html, "utf8")
}

export async function publishArticle(opts: {
  articleId: string
  encryptedBody: string
  encryptedDek: string
  masterKey: Buffer
  publicationDir: string
}): Promise<void> {
  const dek = await decryptDEK(opts.encryptedDek, opts.masterKey)
  const bodyBuf = await decryptData(opts.encryptedBody, dek)
  const markdown = bodyBuf.toString("utf8")
  const rawHtml = await marked(markdown)
  const contentHtml = sanitizeHtml(rawHtml, SANITIZE_OPTIONS)

  const title = extractTitleFromHtml(contentHtml) || "Report"
  const publishDate = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | The Newsroom</title>
  <style>${DARK_CSS}${ARTICLE_CSS}</style>
</head>
<body>
<div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
<div class="page">
  ${siteHeader("../index.html", "← All reports")}
  <div class="article-header">
    <div class="kicker">Investigation · ${publishDate}</div>
    <h1 class="article-h1">${title}</h1>
    <div class="meta-row">
      <span>The Newsroom</span>
      <div class="meta-dot"></div>
      <span>${publishDate}</span>
      <div class="meta-dot"></div>
      <span class="meta-verified">Verified</span>
    </div>
  </div>
  <div class="article-content">
${contentHtml}
  </div>
  <div class="article-footer">
    <div class="article-footer-text">
      This report was produced using encrypted source submissions.<br>
      Source materials are archived securely and cannot be disclosed.
    </div>
    <a href="../index.html" class="btn-back">← All reports</a>
  </div>
</div>
<script>
  (function(){
    var fill = document.getElementById('progress-fill');
    if(!fill) return;
    window.addEventListener('scroll', function(){
      var el = document.documentElement;
      var pct = el.scrollHeight > el.clientHeight
        ? (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100
        : 0;
      fill.style.width = pct + '%';
    }, { passive: true });
  })();
</script>
</body>
</html>`

  const articlesDir = join(opts.publicationDir, "articles")
  mkdirSync(articlesDir, { recursive: true })
  writeFileSync(join(articlesDir, `${opts.articleId}.html`), html, "utf8")
  updateIndex(opts.publicationDir)
}

// ── Video report publication ───────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const VIDEO_CSS = `
  .video-hero{position:relative;background:#000;width:100%;overflow:hidden;margin-bottom:0}
  .video-hero video{width:100%;height:auto;display:block;max-height:480px}
  .video-overlay{position:absolute;bottom:0;left:0;right:0;padding:20px 28px;
    background:linear-gradient(to top,rgba(6,11,20,.95) 0%,transparent 100%)}
  .video-kicker{font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;
    letter-spacing:.12em;margin-bottom:8px}
  .video-title{font-size:22px;font-weight:800;line-height:1.2;letter-spacing:-.02em;
    text-shadow:0 2px 8px rgba(0,0,0,.8)}
  .quality-bar{display:flex;align-items:center;justify-content:space-between;
    padding:10px 28px;background:var(--surface);border-bottom:1px solid var(--border);font-size:11px}
  .quality-badge{display:flex;align-items:center;gap:6px;color:var(--green)}
  .quality-dot{width:6px;height:6px;border-radius:50%;background:var(--green)}
  .quality-btns{display:flex;gap:6px}
  .q-btn{padding:3px 10px;border:1px solid var(--border);border-radius:4px;
    color:var(--text-muted);cursor:pointer;background:transparent;font-size:10px}
  .q-btn.active,.q-btn:hover{border-color:var(--green);color:var(--green)}
  .video-body{padding:28px 28px 60px;max-width:680px;margin:0 auto}
  .video-desc p{font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.8;
    color:#CBD5E1}
  .video-desc p:first-child{font-size:18px;border-left:3px solid var(--green);
    padding-left:16px;margin-bottom:1.5em;color:#E2E8F0}
`

export function publishVideoReport(opts: {
  videoId: string
  title: string
  description: string
  publicationDir: string
  publishDate: Date
}): void {
  const { videoId, title, description, publicationDir, publishDate } = opts
  const dateStr = formatDate(publishDate)
  const outDir = join(publicationDir, "videos", videoId)
  const thumbExists = existsSync(join(outDir, "thumbnail.jpg"))

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DARK_CSS}${VIDEO_CSS}</style>
</head>
<body>
<div class="page" style="padding:0;max-width:100%">
  ${siteHeader("../../index.html", "← All reports")}
  <div class="video-hero">
    <video id="hls-player" controls${thumbExists ? ` poster="thumbnail.jpg"` : ""}></video>
    <div class="video-overlay">
      <div class="video-kicker">Video Report · Investigation · ${dateStr}</div>
      <div class="video-title">${escapeHtml(title)}</div>
    </div>
  </div>
  <div class="quality-bar">
    <div class="quality-badge">
      <div class="quality-dot"></div>
      <span>Verified source footage</span>
      <span style="color:var(--border-2)">·</span>
      <span style="color:var(--text-subtle)">Metadata stripped</span>
    </div>
    <div class="quality-btns">
      <button class="q-btn active" onclick="setQuality(this,'auto')">Auto</button>
      <button class="q-btn" onclick="setQuality(this,'1080p')">1080p</button>
      <button class="q-btn" onclick="setQuality(this,'720p')">720p</button>
      <button class="q-btn" onclick="setQuality(this,'480p')">480p</button>
    </div>
  </div>
  <div class="video-body">
    <div class="video-desc"><p>${escapeHtml(description || "Verified source footage.")}</p></div>
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid var(--border);
                display:flex;justify-content:space-between;align-items:center">
      <a href="../../video-index.html" style="color:var(--green);text-decoration:none;font-size:12px">← All videos</a>
      <span style="font-size:10px;color:var(--text-subtle)">This site is only accessible over Tor.</span>
    </div>
  </div>
</div>
<script src="../../hls.min.js"></script>
<script>
var player = document.getElementById('hls-player');
function loadHls(url) {
  if (window.Hls && Hls.isSupported()) {
    var hls = new Hls(); hls.loadSource(url); hls.attachMedia(player);
    player._hls = hls;
  } else if (player.canPlayType('application/vnd.apple.mpegurl')) { player.src = url; }
}
function setQuality(btn, q) {
  document.querySelectorAll('.q-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  if (player._hls) { player._hls.destroy(); player._hls = null; }
  loadHls(q === 'auto' ? 'master.m3u8' : q + '/playlist.m3u8');
}
loadHls('master.m3u8');
</script>
</body>
</html>`

  writeFileSync(join(outDir, "index.html"), html, "utf8")
}

export function updateVideoIndex(publicationDir: string): void {
  const videosDir = join(publicationDir, "videos")
  if (!existsSync(videosDir)) {
    writeFileSync(join(publicationDir, "video-index.html"), buildVideoIndexHtml([]), "utf8")
    return
  }

  const entries: { id: string; title: string; date: Date; thumbExists: boolean }[] = []
  for (const id of readdirSync(videosDir)) {
    const indexPath = join(videosDir, id, "index.html")
    if (!existsSync(indexPath)) continue
    try {
      const html = readFileSync(indexPath, "utf8")
      const m = html.match(/<title>([^<]+)<\/title>/)
      entries.push({ id, title: m ? m[1] : "Untitled", date: statSync(indexPath).mtime,
        thumbExists: existsSync(join(videosDir, id, "thumbnail.jpg")) })
    } catch { /* skip */ }
  }
  entries.sort((a, b) => b.date.getTime() - a.date.getTime())
  writeFileSync(join(publicationDir, "video-index.html"), buildVideoIndexHtml(entries), "utf8")
}

function buildVideoIndexHtml(entries: { id: string; title: string; date: Date; thumbExists: boolean }[]): string {
  const VIDEO_INDEX_CSS = `
    .vitem{display:flex;gap:16px;align-items:flex-start;padding:20px 0;border-bottom:1px solid var(--border)}
    .vthumb{width:120px;height:68px;object-fit:cover;border-radius:4px;flex-shrink:0;background:var(--surface);border:1px solid var(--border)}
    .vthumb-ph{width:120px;height:68px;border-radius:4px;background:var(--surface);border:1px solid var(--border);flex-shrink:0}
    .vkicker{font-size:10px;font-weight:600;color:var(--green);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
    .vtitle{font-size:16px;font-weight:700;margin-bottom:10px;line-height:1.3}
    .vlink{font-size:12px;color:var(--green);text-decoration:none}
    .vlink:hover{text-decoration:underline}
  `
  const items = entries.map(e => `
    <div class="vitem">
      ${e.thumbExists
        ? `<img src="videos/${e.id}/thumbnail.jpg" class="vthumb" alt="" loading="lazy">`
        : `<div class="vthumb-ph"></div>`}
      <div>
        <div class="vkicker">Video Report · ${formatDate(e.date)}</div>
        <div class="vtitle">${escapeHtml(e.title)}</div>
        <a href="videos/${e.id}/index.html" class="vlink">Watch →</a>
      </div>
    </div>`).join("")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video Reports</title>
<style>${DARK_CSS}${VIDEO_INDEX_CSS}</style>
</head>
<body>
<div class="page">
  ${siteHeader("index.html", "← All reports")}
  <h1 style="font-size:22px;font-weight:800;margin-bottom:8px">Video Reports</h1>
  <p style="color:var(--text-subtle);font-size:13px;margin-bottom:28px">${entries.length} video${entries.length !== 1 ? "s" : ""} published</p>
  ${items || '<p style="color:var(--text-subtle);padding:40px 0;text-align:center">No videos published yet.</p>'}
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid var(--border)">
    <p style="font-size:10px;color:var(--text-subtle);text-align:center">This site is only accessible over Tor.</p>
  </div>
</div>
</body>
</html>`
}
