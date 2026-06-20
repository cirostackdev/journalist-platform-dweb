import { Router } from "express"
import argon2 from "argon2"
import { createHmac } from "crypto"
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
    const passphrase = req.body?.passphrase as string | undefined

    if (!codename || typeof codename !== "string") {
      res.status(400).json({ error: "codename required" })
      return
    }

    try {
      // Fast path: HMAC lookup (O(1))
      const codenameHmac = createHmac("sha256", opts.masterKey).update(codename).digest("hex")
      let source = opts.db.getSourceByHmac(codenameHmac)

      // Slow fallback for legacy rows without codename_hmac (O(N))
      if (!source) {
        const sources = opts.db.query(
          "SELECT id, codename_hash, passphrase_hash FROM sources WHERE codename_hmac IS NULL"
        ).all() as { id: string; codename_hash: string; passphrase_hash: string | null }[]
        for (const s of sources) {
          if (await argon2.verify(s.codename_hash, codename)) {
            source = s as any
            break
          }
        }
      }

      if (!source) {
        await new Promise((r) => setTimeout(r, 500))
        res.status(401).json({ error: "Invalid codename." })
        return
      }

      // For the fast path (source found by HMAC), still do argon2 verify to confirm
      if (!await argon2.verify(source.codename_hash, codename)) {
        await new Promise((r) => setTimeout(r, 500))
        res.status(401).json({ error: "Invalid codename." })
        return
      }

      // Verify passphrase if source has one set
      if (source.passphrase_hash) {
        if (!passphrase?.trim()) {
          res.status(401).json({ error: "Passphrase required." })
          return
        }
        const passphraseOk = await argon2.verify(source.passphrase_hash, passphrase)
        if (!passphraseOk) {
          res.status(401).json({ error: "Invalid passphrase." })
          return
        }
      }

      const submissions = opts.db.query(
        "SELECT id FROM submissions WHERE source_id = ?"
      ).all(source.id) as { id: string }[]

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
