import { describe, test, expect, afterEach } from "bun:test"
import { existsSync, rmSync, readFileSync } from "fs"
import { publishArticle } from "../src/lib/publish"
import { deriveMasterKey, generateDEK, encryptData, encryptDEK } from "@journalist/shared/crypto"

const TEST_PUB_DIR = `/tmp/test-publication-${Date.now()}`
afterEach(() => rmSync(TEST_PUB_DIR, { recursive: true, force: true }))

async function makeEncryptedBody(markdown: string) {
  const salt = Buffer.alloc(16, 0xdd)
  const masterKey = await deriveMasterKey("test", salt)
  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encBody = await encryptData(markdown, dek)
  return { masterKey, encBody, encDek }
}

describe("publishArticle", () => {
  test("writes an HTML file to the publication directory", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Hello\n\nThis is a **test** article.")
    await publishArticle({ articleId: "article-001", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    expect(existsSync(`${TEST_PUB_DIR}/articles/article-001.html`)).toBe(true)
  })
  test("rendered HTML contains the article content", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Investigation\n\nThe **documents** reveal...")
    await publishArticle({ articleId: "article-002", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const html = readFileSync(`${TEST_PUB_DIR}/articles/article-002.html`, "utf8")
    expect(html).toContain("<h1>Investigation</h1>")
    expect(html).toContain("<strong>documents</strong>")
  })
  test("HTML file is a complete page with DOCTYPE", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("Content")
    await publishArticle({ articleId: "article-003", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const html = readFileSync(`${TEST_PUB_DIR}/articles/article-003.html`, "utf8")
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("<html")
  })
  test("publishArticle creates or updates index.html", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Article One")
    await publishArticle({ articleId: "art-idx-001", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    expect(existsSync(`${TEST_PUB_DIR}/index.html`)).toBe(true)
  })
  test("index.html links to published articles", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Article Two")
    await publishArticle({ articleId: "art-idx-002", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const index = readFileSync(`${TEST_PUB_DIR}/index.html`, "utf8")
    expect(index).toContain("art-idx-002.html")
  })
})
