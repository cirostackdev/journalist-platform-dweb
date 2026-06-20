import { marked } from "marked"
import { writeFileSync, mkdirSync, readdirSync } from "fs"
import { join } from "path"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"

export function updateIndex(publicationDir: string): void {
  const articlesDir = join(publicationDir, "articles")
  mkdirSync(articlesDir, { recursive: true })

  const files = readdirSync(articlesDir)
    .filter((f) => f.endsWith(".html"))
    .sort()

  const links = files
    .map((f) => `<li><a href="articles/${f}">${f.replace(".html", "")}</a></li>`)
    .join("\n    ")

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Published Articles</title>
  <style>
    body { max-width: 800px; margin: 2rem auto; padding: 0 1rem; font-family: Georgia, serif; line-height: 1.6; }
    h1 { font-family: sans-serif; }
    ul { padding-left: 1.5rem; }
    li { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>Published Articles</h1>
  <ul>
    ${links || "<li>No articles published yet.</li>"}
  </ul>
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
  const contentHtml = await marked(bodyBuf.toString("utf8"))

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Article</title>
  <style>
    body { max-width: 800px; margin: 2rem auto; padding: 0 1rem; font-family: Georgia, serif; line-height: 1.6; }
    h1, h2, h3 { font-family: sans-serif; }
  </style>
</head>
<body>
${contentHtml}
</body>
</html>`

  const articlesDir = join(opts.publicationDir, "articles")
  mkdirSync(articlesDir, { recursive: true })
  writeFileSync(join(articlesDir, `${opts.articleId}.html`), html, "utf8")
  updateIndex(opts.publicationDir)
}
