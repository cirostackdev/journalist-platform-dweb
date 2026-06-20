import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { openDb, type Db } from "../src/db"

let db: Db

beforeEach(() => {
  db = openDb(":memory:")
})

afterEach(() => {
  db.close()
})

describe("schema", () => {
  test("sources table exists", () => {
    const row = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sources'"
    ).get()
    expect(row).not.toBeNull()
  })

  test("submissions table exists", () => {
    const row = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='submissions'"
    ).get()
    expect(row).not.toBeNull()
  })

  test("messages table exists", () => {
    const row = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
    ).get()
    expect(row).not.toBeNull()
  })

  test("submission_files table exists", () => {
    const row = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='submission_files'"
    ).get()
    expect(row).not.toBeNull()
  })
})

describe("insertSource", () => {
  test("inserts a source and returns its id", () => {
    const id = db.insertSource("hashed-codename")
    expect(id).toBeString()
    expect(id.length).toBeGreaterThan(0)
  })

  test("rejects duplicate codename_hash", () => {
    db.insertSource("same-hash")
    expect(() => db.insertSource("same-hash")).toThrow()
  })
})

describe("insertSubmission", () => {
  test("inserts a submission linked to a source", () => {
    const sourceId = db.insertSource("hash-abc")
    const subId = db.insertSubmission(sourceId, "encrypted-text")
    expect(subId).toBeString()
  })
})

describe("insertMessage + getMessages", () => {
  test("stores and retrieves a message", () => {
    const sourceId = db.insertSource("hash-def")
    const subId = db.insertSubmission(sourceId, null)
    db.insertMessage(subId, "journalist", "encrypted-body", "encrypted-dek")
    const messages = db.getMessages(subId)
    expect(messages).toHaveLength(1)
    expect(messages[0].direction).toBe("journalist")
  })
})
