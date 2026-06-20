import { consumeQueueMessage } from "@journalist/shared/queue"
import type { Db } from "./db"

type QueueConsumerOptions = { db: Db; queueDir: string; queueKey: Uint8Array; pollIntervalMs?: number }

/** Validate that a new_submission message has the expected shape. */
function isValidNewSubmission(msg: unknown): msg is { type: "new_submission"; submissionId: string } {
  if (typeof msg !== "object" || msg === null) return false
  const m = msg as Record<string, unknown>
  return (
    m.type === "new_submission" &&
    typeof m.submissionId === "string" &&
    m.submissionId.length > 0
  )
}

export function createQueueConsumer(opts: QueueConsumerOptions) {
  const intervalMs = opts.pollIntervalMs ?? 5_000
  let running = true

  async function poll() {
    while (running) {
      try {
        const msg = await consumeQueueMessage(opts.queueDir, opts.queueKey)
        if (msg?.type === "new_submission") {
          if (!isValidNewSubmission(msg)) {
            console.warn("[queue-consumer] Dropping malformed new_submission message:", msg)
          } else {
            try {
              await opts.db.insertCase(msg.submissionId)
            } catch (err: unknown) {
              if ((err as { code?: string }).code !== "23505") throw err
            }
          }
        }
      } catch (err) { console.error("[queue-consumer]", err) }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }

  poll()
  return { stop() { running = false } }
}
