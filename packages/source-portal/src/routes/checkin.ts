import { Router } from "express"
import argon2 from "argon2"
import { createHmac } from "crypto"
import type { Db } from "../db"

type CheckinRouterOptions = {
  db: Db
  masterKey: Buffer   // used only for HMAC lookup
  newsroomPublicKey: Uint8Array
}

export function createCheckinRouter(opts: CheckinRouterOptions): Router {
  const router = Router()

  const authFail = async (res: any) => {
    await new Promise((r) => setTimeout(r, 500))
    res.status(401).json({ error: "Invalid credentials." })
  }

  router.post("/", async (req, res) => {
    const { diceware1 } = req.body ?? {}

    if (!diceware1 || typeof diceware1 !== "string") {
      res.status(400).json({ error: "diceware1 required" })
      return
    }

    try {
      const hmac = createHmac("sha256", opts.masterKey).update(diceware1).digest("hex")
      const source = opts.db.getSourceByHmac(hmac)

      if (!source) return authFail(res)

      const codeOk = await argon2.verify(source.codename_hash, diceware1)
      if (!codeOk) return authFail(res)

      const submissions = opts.db
        .query("SELECT id FROM submissions WHERE source_id = ?")
        .all(source.id) as { id: string }[]

      const messages: { direction: string; ciphertext: string; senderPublicKey: string; created_at: number }[] = []

      for (const sub of submissions) {
        const msgs = opts.db.getMessages(sub.id)
        for (const msg of msgs) {
          if (msg.direction !== "journalist") continue
          messages.push({
            direction: msg.direction,
            ciphertext: msg.encrypted_body,
            senderPublicKey: msg.sender_public_key,
            created_at: msg.created_at,
          })
        }
      }

      // Handle optional follow-up message from source
      const { followUpMessage } = req.body ?? {}
      if (followUpMessage && typeof followUpMessage === "string" && followUpMessage.trim().length > 0) {
        // Find first submission to attach the follow-up to
        // (sources always have at least one submission after check-in auth)
        const firstSub = submissions[0]
        if (firstSub) {
          const { sealedBoxEncrypt } = await import("@journalist/shared/crypto")
          const sealedBody = await sealedBoxEncrypt(
            Buffer.from(followUpMessage.trim(), "utf8"),
            opts.newsroomPublicKey
          )
          // Store with direction='source', senderPublicKey='' (anonymous source, no keypair stored)
          opts.db.insertMessage(firstSub.id, "source", sealedBody, "")
        }
      }

      res.status(200).json({ messages })
    } catch (err) {
      console.error("Checkin error:", err)
      res.status(500).json({ error: "Check-in failed." })
    }
  })

  return router
}
