import { describe, test, expect, afterEach } from "bun:test"
import { existsSync, rmSync, readFileSync } from "fs"
import { publishArticle, updateIndex } from "../src/lib/publish"
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

  test("article HTML has DOCTYPE and dark background", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Test\n\nContent")
    await publishArticle({ articleId: "article-003", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const html = readFileSync(`${TEST_PUB_DIR}/articles/article-003.html`, "utf8")
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("#060B14")
    expect(html).toContain("The Newsroom")
  })

  test("article HTML contains reading progress bar", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Progress\n\nTest")
    await publishArticle({ articleId: "article-004", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const html = readFileSync(`${TEST_PUB_DIR}/articles/article-004.html`, "utf8")
    expect(html).toContain("progress")
    expect(html).toContain("scroll")
  })

  test("article HTML links back to index", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Back Link\n\nTest")
    await publishArticle({ articleId: "article-005", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const html = readFileSync(`${TEST_PUB_DIR}/articles/article-005.html`, "utf8")
    expect(html).toContain("../index.html")
  })

  test("publishArticle creates index.html", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Index Test")
    await publishArticle({ articleId: "art-idx-001", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    expect(existsSync(`${TEST_PUB_DIR}/index.html`)).toBe(true)
  })

  test("index.html links to published articles", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Article Two")
    await publishArticle({ articleId: "art-idx-002", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const index = readFileSync(`${TEST_PUB_DIR}/index.html`, "utf8")
    expect(index).toContain("art-idx-002.html")
  })

  test("index.html has dark background and DOCTYPE", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Dark Index")
    await publishArticle({ articleId: "art-idx-003", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const index = readFileSync(`${TEST_PUB_DIR}/index.html`, "utf8")
    expect(index).toContain("<!DOCTYPE html>")
    expect(index).toContain("#060B14")
  })

  test("index.html shows article title extracted from markdown h1", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# The Secret Files\n\nContent here.")
    await publishArticle({ articleId: "art-title-001", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    const index = readFileSync(`${TEST_PUB_DIR}/index.html`, "utf8")
    expect(index).toContain("The Secret Files")
  })
})

describe("updateIndex", () => {
  test("generates index from existing article files", async () => {
    const { masterKey, encBody, encDek } = await makeEncryptedBody("# Report Alpha\n\nSome content.")
    await publishArticle({ articleId: "report-alpha", encryptedBody: encBody, encryptedDek: encDek, masterKey, publicationDir: TEST_PUB_DIR })
    updateIndex(TEST_PUB_DIR)
    const index = readFileSync(`${TEST_PUB_DIR}/index.html`, "utf8")
    expect(index).toContain("report-alpha.html")
  })
})
