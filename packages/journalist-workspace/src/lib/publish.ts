import { marked } from "marked"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"

export async function publishArticle(opts: {
  articleId: string; encryptedBody: string; encryptedDek: string
  masterKey: Buffer; publicationDir: string
}): Promise<void> {
  const dek = await decryptDEK(opts.encryptedDek, opts.masterKey)
  const bodyBuf = await decryptData(opts.encryptedBody, dek)
  const contentHtml = await marked(bodyBuf.toString("utf8"))
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Article</title>
<style>body{max-width:800px;margin:2rem auto;padding:0 1rem;font-family:Georgia,serif;line-height:1.6}h1,h2,h3{font-family:sans-serif}</style>
</head><body>${contentHtml}</body></html>`
  const articlesDir = join(opts.publicationDir, "articles")
  mkdirSync(articlesDir, { recursive: true })
  writeFileSync(join(articlesDir, `${opts.articleId}.html`), html, "utf8")
}
