import { Router } from "express"
import multer from "multer"
import argon2 from "argon2"
import { createHmac } from "crypto"
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs"
import { join } from "path"
import type { Db } from "../db"
import { generateDiceware } from "../wordlist"
import {
  generateDEK,
  encryptData,
  deriveSourceKeypair,
  sealedBoxEncrypt,
} from "@journalist/shared/crypto"
import { writeQueueMessage } from "@journalist/shared/queue"
import { stripMetadata } from "../stripMetadata"

type SubmitRouterOptions = {
  db: Db
  newsroomPublicKey: Uint8Array
  masterKey: Buffer           // still needed for HMAC codename index
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
    const displayName = (req.body?.displayName as string | undefined)?.trim()
    const sealedText = req.body?.sealedText as string | undefined
    const files = (req.files ?? []) as Express.Multer.File[]

    if (!displayName) {
      res.status(400).json({ error: "displayName is required." })
      return
    }
    if (!sealedText && files.length === 0) {
      res.status(400).json({ error: "Provide a message, files, or both." })
      return
    }

    try {
      const diceware1 = await generateDiceware()
      const diceware1Hash = await argon2.hash(diceware1, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      })
      const diceware1Hmac = createHmac("sha256", opts.masterKey)
        .update(diceware1)
        .digest("hex")

      const diceware2 = await generateDiceware()
      const { publicKey: sourcePK } = await deriveSourceKeypair(diceware2)
      const sourcePKHex = Buffer.from(sourcePK).toString("hex")

      const sourceId = opts.db.insertSource(
        diceware1Hash,
        diceware1Hmac,
        displayName,
        sourcePKHex,
      )

      const submissionId = opts.db.insertSubmission(sourceId, sealedText ?? null)

      const submissionsDir = opts.submissionsDir ?? "/var/secure-submissions"
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const submissionDir = join(submissionsDir, submissionId)
        mkdirSync(submissionDir, { recursive: true })

        const fileBytes = readFileSync(file.path)

        // Strip metadata before encryption
        const { data: cleanBytes, stripped, warning } = await stripMetadata(fileBytes, file.originalname)
        if (warning) console.warn(`[submit] File ${i} (${file.originalname}): ${warning}`)
        const bytesToEncrypt = cleanBytes

        const dek = await generateDEK()
        const encContent = await encryptData(bytesToEncrypt, dek)
        const filePath = join(submissionDir, `${i}.enc`)
        writeFileSync(filePath, encContent, "utf8")

        const sealedDek = await sealedBoxEncrypt(Buffer.from(dek), opts.newsroomPublicKey)
        const encFilename = await encryptData(file.originalname, dek)

        writeFileSync(
          join(submissionDir, `${i}.key`),
          JSON.stringify({ sealedDek, encryptedFilename: encFilename }),
          "utf8"
        )
        opts.db.insertSubmissionFile(submissionId, encFilename, sealedDek, filePath)
        unlinkSync(file.path)
      }

      await writeQueueMessage(opts.queueDir, opts.queueKey, {
        type: "new_submission",
        submissionId,
        sourceId,
        hasText: !!sealedText,
        fileCount: files.length,
        metadataStripped: files.length > 0,
      })

      res.status(200).json({ displayName, diceware1, diceware2 })
    } catch (err) {
      console.error("Submit error:", err)
      res.status(500).json({ error: "Submission failed." })
    }
  })

  return router
}
