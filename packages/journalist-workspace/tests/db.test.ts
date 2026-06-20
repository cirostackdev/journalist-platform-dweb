import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { openDb, type Db } from "../src/lib/db"

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://localhost/journalist_workspace_test"
let db: Db

beforeAll(async () => {
  db = await openDb(TEST_DB_URL)
})

afterAll(async () => {
  await db.query("DROP TABLE IF EXISTS articles, case_notes, cases, users CASCADE")
  await db.close()
})

describe("schema", () => {
  test("users table exists", async () => {
    const res = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'users'"
    )
    expect(res.rows).toHaveLength(1)
  })

  test("cases table exists", async () => {
    const res = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'cases'"
    )
    expect(res.rows).toHaveLength(1)
  })
})

describe("users", () => {
  test("insertUser and getUserByUsername round-trip", async () => {
    const id = await db.insertUser("reporter1", "hash123", "enc-totp-secret", "journalist")
    expect(id).toBeString()
    const user = await db.getUserByUsername("reporter1")
    expect(user).not.toBeNull()
    expect(user!.role).toBe("journalist")
    expect(user!.argon2_hash).toBe("hash123")
  })

  test("getUserByUsername returns null for unknown user", async () => {
    const user = await db.getUserByUsername("nobody")
    expect(user).toBeNull()
  })
})

describe("cases", () => {
  test("insertCase and getCase round-trip", async () => {
    const id = await db.insertCase("sub-ref-001")
    expect(id).toBeString()
    const c = await db.getCase(id)
    expect(c).not.toBeNull()
    expect(c!.status).toBe("new")
    expect(c!.submission_ref).toBe("sub-ref-001")
  })

  test("updateCaseStatus changes status", async () => {
    const id = await db.insertCase("sub-ref-002")
    await db.updateCaseStatus(id, "active")
    const c = await db.getCase(id)
    expect(c!.status).toBe("active")
  })
})

describe("case notes", () => {
  test("insertCaseNote and getCaseNotes round-trip", async () => {
    const caseId = await db.insertCase("sub-ref-003")
    const user = await db.getUserByUsername("reporter1")
    await db.insertCaseNote(caseId, user!.id, "enc-body", "enc-dek")
    const notes = await db.getCaseNotes(caseId)
    expect(notes).toHaveLength(1)
    expect(notes[0].encrypted_body).toBe("enc-body")
  })
})

describe("articles", () => {
  test("insertArticle and getArticle round-trip", async () => {
    const caseId = await db.insertCase("sub-ref-004")
    const user = await db.getUserByUsername("reporter1")
    const id = await db.insertArticle(caseId, user!.id)
    const article = await db.getArticle(id)
    expect(article).not.toBeNull()
    expect(article!.status).toBe("draft")
  })

  test("updateArticle persists encrypted content", async () => {
    const caseId = await db.insertCase("sub-ref-005")
    const user = await db.getUserByUsername("reporter1")
    const id = await db.insertArticle(caseId, user!.id)
    await db.updateArticle(id, "enc-body", "enc-dek")
    const article = await db.getArticle(id)
    expect(article!.encrypted_body).toBe("enc-body")
  })
})
