import { Router } from "express"
import multer from "multer"
import argon2 from "argon2"
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs"
import type { Db } from "../db"
import { generateCodename } from "../wordlist"
import { encryptData, generateDEK, encryptDEK } from "@journalist/shared/crypto"
import { writeQueueMessage } from "@journalist/shared/queue"

type SubmitRouterOptions = {
  db: Db
  masterKey: Buffer
  queueKey: Uint8Array
  queueDir: string
  uploadDir?: string
  submissionsDir?: string
}

export function createSubmitRouter(opts: SubmitRouterOptions): Router {
  const router = Router()
  const submissionsDir = opts.submissionsDir ?? "/var/secure-submissions"
  const upload = multer({
    dest: opts.uploadDir ?? "/tmp/uploads",
    limits: { fileSize: 256 * 1024 * 1024, files: 10 },
  })

  router.post("/", upload.array("files"), async (req, res) => {
    const text = req.body?.text as string | undefined
    const files = (req.files ?? []) as Express.Multer.File[]

    if (!text && files.length === 0) {
      res.status(400).json({ error: "Provide text, files, or both." })
      return
    }

    try {
      const codename = await generateCodename()
      const codenameHash = await argon2.hash(codename, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      })

      const sourceId = opts.db.insertSource(codenameHash)

      let encryptedText: string | null = null
      if (text) {
        const dek = await generateDEK()
        const encryptedDek = await encryptDEK(dek, opts.masterKey)
        encryptedText = JSON.stringify({
          dek: encryptedDek,
          body: await encryptData(text, dek),
        })
      }

      const submissionId = opts.db.insertSubmission(sourceId, encryptedText)

      // Encrypt each uploaded file and store securely; remove plaintext temp file
      if (files.length > 0) {
        const submissionDir = `${submissionsDir}/${submissionId}`
        mkdirSync(submissionDir, { recursive: true })

        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const bytes = readFileSync(file.path)
          const dek = await generateDEK()
          const encryptedContent = await encryptData(bytes.toString("base64"), dek)
          const encryptedDek = await encryptDEK(dek, opts.masterKey)

          writeFileSync(`${submissionDir}/${i}.enc`, encryptedContent, "utf8")
          writeFileSync(
            `${submissionDir}/${i}.key`,
            JSON.stringify({ encryptedDek, originalName: file.originalname }),
            "utf8"
          )
          unlinkSync(file.path)
        }
      }

      await writeQueueMessage(opts.queueDir, opts.queueKey, {
        type: "new_submission",
        submissionId,
        sourceId,
        hasText: !!text,
        fileCount: files.length,
      })

      res.status(200).json({ codename, submissionId })
    } catch (err) {
      console.error("Submit error:", err)
      res.status(500).json({ error: "Submission failed." })
    }
  })

  return router
}
