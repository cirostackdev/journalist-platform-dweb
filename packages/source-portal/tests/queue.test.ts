import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, readdirSync } from "fs"
import { writeQueueMessage, readQueueMessages, consumeQueueMessage } from "@journalist/shared/queue"
import { generateDEK } from "@journalist/shared/crypto"

const TEST_QUEUE_DIR = `/tmp/test-queue-${Date.now()}`

beforeEach(() => {
  mkdirSync(TEST_QUEUE_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_QUEUE_DIR, { recursive: true, force: true })
})

describe("writeQueueMessage + readQueueMessages", () => {
  test("writes an encrypted file that can be read back", async () => {
    const queueKey = await generateDEK()
    const payload = { type: "submission", submissionId: "abc-123", sourceId: "src-456" }

    await writeQueueMessage(TEST_QUEUE_DIR, queueKey, payload)

    const files = readdirSync(TEST_QUEUE_DIR)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/\.msg$/)
  })

  test("decrypts and returns original payload", async () => {
    const queueKey = await generateDEK()
    const payload = { type: "submission", submissionId: "xyz-789" }

    await writeQueueMessage(TEST_QUEUE_DIR, queueKey, payload)
    const messages = await readQueueMessages(TEST_QUEUE_DIR, queueKey)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject(payload)
  })

  test("wrong key cannot read message", async () => {
    const queueKey = await generateDEK()
    const wrongKey = await generateDEK()
    await writeQueueMessage(TEST_QUEUE_DIR, queueKey, { type: "test" })

    await expect(readQueueMessages(TEST_QUEUE_DIR, wrongKey)).rejects.toThrow()
  })
})

describe("consumeQueueMessage", () => {
  test("returns null when queue is empty", async () => {
    const queueKey = await generateDEK()
    const result = await consumeQueueMessage(TEST_QUEUE_DIR, queueKey)
    expect(result).toBeNull()
  })

  test("reads and deletes the message file", async () => {
    const queueKey = await generateDEK()
    await writeQueueMessage(TEST_QUEUE_DIR, queueKey, { type: "test" })

    const result = await consumeQueueMessage(TEST_QUEUE_DIR, queueKey)
    expect(result).not.toBeNull()
    expect(readdirSync(TEST_QUEUE_DIR)).toHaveLength(0)
  })
})
