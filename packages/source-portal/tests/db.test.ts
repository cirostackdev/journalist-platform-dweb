import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { openDb, type Db } from "../src/db"

let db: Db

beforeEach(() => { db = openDb(":memory:") })
afterEach(() => { db.close() })

describe("schema", () => {
  test("sources table exists", () => {
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sources'").get()).not.toBeNull()
  })
  test("submissions table exists", () => {
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='submissions'").get()).not.toBeNull()
  })
  test("messages table exists", () => {
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get()).not.toBeNull()
  })
  test("submission_files table exists", () => {
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='submission_files'").get()).not.toBeNull()
  })
})

describe("insertSource", () => {
  test("inserts a source and returns its id", () => {
    const id = db.insertSource("hashed-codename", "hmac-hex", "Ghost", "pubkey-hex")
    expect(id).toBeString()
    expect(id.length).toBeGreaterThan(0)
  })

  test("rejects duplicate codename_hash", () => {
    db.insertSource("same-hash", "hmac-a", "Alpha", "pk-a")
    expect(() => db.insertSource("same-hash", "hmac-b", "Beta", "pk-b")).toThrow()
  })

  test("stores display_name and source_public_key", () => {
    const id = db.insertSource("ch", "hm", "Nighthawk", "pk-hex-123")
    const row = db.query("SELECT display_name, source_public_key FROM sources WHERE id = ?").get(id) as any
    expect(row.display_name).toBe("Nighthawk")
    expect(row.source_public_key).toBe("pk-hex-123")
  })
})

describe("insertSubmission", () => {
  test("inserts a submission linked to a source", () => {
    const sourceId = db.insertSource("hash-abc", "hmac-abc", "Ghost", "pk-abc")
    const subId = db.insertSubmission(sourceId, "sealed-ciphertext-base64")
    expect(subId).toBeString()
  })
})

describe("insertMessage / getMessages", () => {
  test("stores journalist message with sender_public_key and retrieves it", () => {
    const sourceId = db.insertSource("ch", "hm", "Ghost", "pk")
    const subId = db.insertSubmission(sourceId, null)
    db.insertMessage(subId, "journalist", "box-ciphertext-base64", "newsroom-pubkey-hex")
    const messages = db.getMessages(subId)
    expect(messages).toHaveLength(1)
    expect(messages[0].encrypted_body).toBe("box-ciphertext-base64")
    expect(messages[0].sender_public_key).toBe("newsroom-pubkey-hex")
    expect(messages[0].direction).toBe("journalist")
  })
})

describe("getSourceByHmac", () => {
  test("returns source for known hmac", () => {
    db.insertSource("ch", "known-hmac", "Ghost", "pk")
    const src = db.getSourceByHmac("known-hmac")
    expect(src).not.toBeNull()
    expect(src!.display_name).toBe("Ghost")
  })

  test("returns null for unknown hmac", () => {
    expect(db.getSourceByHmac("unknown")).toBeNull()
  })
})
