import { Router } from "express"
import multer from "multer"
import argon2 from "argon2"
import { createHmac } from "crypto"
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs"
import { join } from "path"
import type { Db } from "../db"
import { generateCodename } from "../wordlist"
import { encryptData, generateDEK, encryptDEK, generatePassphrase } from "@journalist/shared/crypto"
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
  mkdirSync(opts.uploadDir ?? "/var/secure/upload-tmp", { recursive: true })
  const router = Router()
  const upload = multer({
    dest: opts.uploadDir ?? "/var/secure/upload-tmp",
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

      // Auto-generate passphrase — sources do not choose their own
      const passphrase = generatePassphrase()
      const passphraseHash = await argon2.hash(passphrase, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      })

      const codenameHmac = createHmac("sha256", opts.masterKey).update(codename).digest("hex")
      const sourceId = opts.db.insertSource(codenameHash, passphraseHash, codenameHmac)

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

      // Encrypt uploaded files
      const submissionsDir = opts.submissionsDir ?? "/var/secure-submissions"
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const submissionDir = join(submissionsDir, submissionId)
        mkdirSync(submissionDir, { recursive: true })
        const bytes = readFileSync(file.path)
        const dek = await generateDEK()
        const encDek = await encryptDEK(dek, opts.masterKey)
        const encContent = await encryptData(bytes, dek)
        const filePath = join(submissionDir, `${i}.enc`)
        writeFileSync(filePath, encContent, "utf8")
        const encFilename = await encryptData(file.originalname, dek)
        writeFileSync(
          join(submissionDir, `${i}.key`),
          JSON.stringify({ encryptedDek: encDek, encryptedFilename: encFilename }),
          "utf8"
        )
        opts.db.insertSubmissionFile(
          submissionId,
          encFilename,
          encDek,
          filePath
        )
        unlinkSync(file.path)
      }

      await writeQueueMessage(opts.queueDir, opts.queueKey, {
        type: "new_submission",
        submissionId,
        sourceId,
        hasText: !!text,
        fileCount: files.length,
      })

      res.status(200).json({ codename, passphrase })
    } catch (err) {
      console.error("Submit error:", err)
      res.status(500).json({ error: "Submission failed." })
    }
  })

  return router
}
