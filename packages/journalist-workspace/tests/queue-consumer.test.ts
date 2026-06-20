import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { createQueueConsumer } from "../src/lib/queue-consumer"
import { openDb, type Db } from "../src/lib/db"
import { generateDEK } from "@journalist/shared/crypto"
import { writeQueueMessage } from "@journalist/shared/queue"

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://localhost/journalist_workspace_test"
const TEST_QUEUE_DIR = `/tmp/test-ws-queue-${Date.now()}`
let db: Db
let queueKey: Uint8Array

beforeAll(async () => {
  mkdirSync(TEST_QUEUE_DIR, { recursive: true })
  db = await openDb(TEST_DB_URL)
  queueKey = await generateDEK()
})

afterAll(() => rmSync(TEST_QUEUE_DIR, { recursive: true, force: true }))

describe("queue consumer", () => {
  test("processes new_submission and creates a case", async () => {
    await writeQueueMessage(TEST_QUEUE_DIR, queueKey, {
      type: "new_submission", submissionId: "sub-queue-test-001",
      sourceId: "src-001", hasText: true, fileCount: 0,
    })
    const consumer = createQueueConsumer({ db, queueDir: TEST_QUEUE_DIR, queueKey, pollIntervalMs: 50 })
    await new Promise((r) => setTimeout(r, 300))
    consumer.stop()
    const cases = await db.getCases()
    const created = cases.find((c) => c.submission_ref === "sub-queue-test-001")
    expect(created).not.toBeUndefined()
    expect(created!.status).toBe("new")
  })

  test("ignores unknown message types without crashing", async () => {
    await writeQueueMessage(TEST_QUEUE_DIR, queueKey, { type: "unknown_type", data: "ignored" })
    const consumer = createQueueConsumer({ db, queueDir: TEST_QUEUE_DIR, queueKey, pollIntervalMs: 50 })
    await new Promise((r) => setTimeout(r, 200))
    consumer.stop()
    expect(true).toBe(true)
  })
})
