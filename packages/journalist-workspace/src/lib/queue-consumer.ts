import { consumeQueueMessage } from "@journalist/shared/queue"
import type { Db } from "./db"

type QueueConsumerOptions = { db: Db; queueDir: string; queueKey: Uint8Array; pollIntervalMs?: number }

export function createQueueConsumer(opts: QueueConsumerOptions) {
  const intervalMs = opts.pollIntervalMs ?? 5_000
  let running = true

  async function poll() {
    while (running) {
      try {
        const msg = await consumeQueueMessage(opts.queueDir, opts.queueKey)
        if (msg?.type === "new_submission") {
          try {
            await opts.db.insertCase(msg.submissionId as string)
          } catch (err: unknown) {
            if ((err as { code?: string }).code !== "23505") throw err
          }
        }
      } catch (err) { console.error("[queue-consumer]", err) }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }

  poll()
  return { stop() { running = false } }
}
