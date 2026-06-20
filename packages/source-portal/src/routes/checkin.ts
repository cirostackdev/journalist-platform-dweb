import { Router } from "express"
import argon2 from "argon2"
import type { Db } from "../db"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"

type CheckinRouterOptions = {
  db: Db
  masterKey: Buffer
}

export function createCheckinRouter(opts: CheckinRouterOptions): Router {
  const router = Router()

  router.post("/", async (req, res) => {
    const { codename } = req.body ?? {}

    if (!codename || typeof codename !== "string") {
      res.status(400).json({ error: "codename required" })
      return
    }

    try {
      const sources = opts.db.query(
        "SELECT id, codename_hash FROM sources"
      ).all() as { id: string; codename_hash: string }[]

      let sourceId: string | null = null
      for (const source of sources) {
        if (await argon2.verify(source.codename_hash, codename)) {
          sourceId = source.id
          break
        }
      }

      if (!sourceId) {
        await new Promise((r) => setTimeout(r, 500))
        res.status(401).json({ error: "Invalid codename." })
        return
      }

      const submissions = opts.db.query(
        "SELECT id FROM submissions WHERE source_id = ?"
      ).all(sourceId) as { id: string }[]

      const decryptedMessages: { direction: string; body: string; created_at: number }[] = []

      for (const sub of submissions) {
        const messages = opts.db.getMessages(sub.id)
        for (const msg of messages) {
          if (msg.direction !== "journalist") continue
          const dek = await decryptDEK(msg.encrypted_dek, opts.masterKey)
          const body = await decryptData(msg.encrypted_body, dek)
          decryptedMessages.push({
            direction: msg.direction,
            body: body.toString("utf8"),
            created_at: msg.created_at,
          })
        }
      }

      res.status(200).json({ messages: decryptedMessages })
    } catch (err) {
      console.error("Checkin error:", err)
      res.status(500).json({ error: "Check-in failed." })
    }
  })

  return router
}
