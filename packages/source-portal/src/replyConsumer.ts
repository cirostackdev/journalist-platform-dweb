import { consumeQueueMessage } from "@journalist/shared/queue"
import type { Db } from "./db"

type ReplyConsumerOptions = { db: Db; queueDir: string; queueKey: Uint8Array; pollIntervalMs?: number }

export function startReplyConsumer(opts: ReplyConsumerOptions) {
  const intervalMs = opts.pollIntervalMs ?? 5_000
  let running = true
  async function poll() {
    while (running) {
      try {
        const msg = await consumeQueueMessage(opts.queueDir, opts.queueKey)
        if (msg?.type === "journalist_reply") {
          const { submissionId, boxedBody, senderPublicKey } = msg as {
            submissionId: string
            boxedBody: string
            senderPublicKey: string
          }
          opts.db.insertMessage(submissionId, "journalist", boxedBody, senderPublicKey)
        }
      } catch (err) { console.error("[reply-consumer]", err) }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  poll()
  return { stop() { running = false } }
}
