import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { openDb } from "../src/db"
import { generateDEK } from "@journalist/shared/crypto"
import { writeQueueMessage } from "@journalist/shared/queue"
import { startReplyConsumer } from "../src/replyConsumer"

const TEST_QUEUE_DIR = `/tmp/test-reply-queue-${Date.now()}`
beforeEach(() => mkdirSync(TEST_QUEUE_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_QUEUE_DIR, { recursive: true, force: true }))

describe("reply consumer", () => {
  test("ingests journalist_reply and stores in messages table", async () => {
    const db = openDb(":memory:")
    const queueKey = await generateDEK()
    const sourceId = db.insertSource("some-hash")
    const submissionId = db.insertSubmission(sourceId, null)
    await writeQueueMessage(TEST_QUEUE_DIR, queueKey, {
      type: "journalist_reply", submissionId, encryptedBody: "enc-body", encryptedDek: "enc-dek",
    })
    const consumer = startReplyConsumer({ db, queueDir: TEST_QUEUE_DIR, queueKey, pollIntervalMs: 50 })
    await new Promise((r) => setTimeout(r, 200))
    consumer.stop()
    const messages = db.getMessages(submissionId)
    expect(messages).toHaveLength(1)
    expect(messages[0].direction).toBe("journalist")
    expect(messages[0].encrypted_body).toBe("enc-body")
  })
})
