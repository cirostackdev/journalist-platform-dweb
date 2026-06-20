import { marked } from "marked"
import { writeFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"

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
  const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  const idx = stripped.indexOf("The Newsroom")
  const afterHeader = idx >= 0 ? stripped.slice(idx + 12) : stripped
  return afterHeader.replace(/^\s*Investigation\s*·[^·]*/, "").trim().slice(0, 220)
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
  ${siteHeader("/", "Published via Tor · Encrypted")}
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
  const contentHtml = await marked(markdown)

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
