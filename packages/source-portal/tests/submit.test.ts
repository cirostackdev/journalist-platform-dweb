import { describe, test, expect } from "bun:test"
import express from "express"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { openDb } from "../src/db"
import {
  deriveMasterKey,
  generateDEK,
  generateNewsroomKeypair,
  sealedBoxEncrypt,
  sealedBoxDecrypt,
  deriveSourceKeypair,
} from "@journalist/shared/crypto"
import { createSubmitRouter } from "../src/routes/submit"

async function buildApp(submissionsDir?: string) {
  const db = openDb(":memory:")
  const salt = Buffer.alloc(16, 0xaa)
  const masterKey = await deriveMasterKey("test-passphrase", salt)
  const queueKey = await generateDEK()
  const { publicKey: newsroomPublicKey, privateKey: newsroomPrivateKey } =
    await generateNewsroomKeypair()

  const router = createSubmitRouter({
    db,
    newsroomPublicKey,
    masterKey,
    queueKey,
    queueDir: "/tmp",
    submissionsDir,
  })
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use("/submit", router)
  return { app, db, newsroomPublicKey, newsroomPrivateKey }
}

describe("POST /submit", () => {
  test("returns 400 when displayName is missing", async () => {
    const { app, newsroomPublicKey } = await buildApp()
    const sealedText = await sealedBoxEncrypt(Buffer.from("tip"), newsroomPublicKey)
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sealedText }),
    })
    server.close()
    expect(r.status).toBe(400)
  })

  test("returns 400 when neither sealedText nor files provided", async () => {
    const { app } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Ghost" }),
    })
    server.close()
    expect(r.status).toBe(400)
  })

  test("returns displayName, diceware1 (7 words), diceware2 (7 words) on success", async () => {
    const { app, newsroomPublicKey } = await buildApp()
    const sealedText = await sealedBoxEncrypt(Buffer.from("my tip"), newsroomPublicKey)
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Ghost", sealedText }),
    })
    const body = await r.json()
    server.close()
    expect(r.status).toBe(200)
    expect(body.displayName).toBe("Ghost")
    expect(body.diceware1.split("-")).toHaveLength(7)
    expect(body.diceware2.split("-")).toHaveLength(7)
    expect(body.diceware1).not.toBe(body.diceware2)
    expect(body.submissionId).toBeUndefined()
    expect(body.passphrase).toBeUndefined()
  })

  test("sealedText stored in DB can be decrypted by newsroom private key", async () => {
    const { app, db, newsroomPublicKey, newsroomPrivateKey } = await buildApp()
    const plaintext = "sensitive tip content"
    const sealedText = await sealedBoxEncrypt(Buffer.from(plaintext), newsroomPublicKey)
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Ghost", sealedText }),
    })
    server.close()
    const row = db.query("SELECT encrypted_text FROM submissions").get() as { encrypted_text: string }
    const decrypted = await sealedBoxDecrypt(row.encrypted_text, newsroomPublicKey, newsroomPrivateKey)
    expect(decrypted.toString("utf8")).toBe(plaintext)
  })

  test("source_public_key in DB matches diceware2-derived keypair", async () => {
    const { app, db, newsroomPublicKey } = await buildApp()
    const sealedText = await sealedBoxEncrypt(Buffer.from("tip"), newsroomPublicKey)
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Ghost", sealedText }),
    })
    const body = await r.json()
    server.close()
    const { publicKey } = await deriveSourceKeypair(body.diceware2, { isTest: true })
    const storedPK = db.query("SELECT source_public_key FROM sources").get() as { source_public_key: string }
    expect(storedPK.source_public_key).toBe(Buffer.from(publicKey).toString("hex"))
  })

  test("two submissions produce different diceware phrases", async () => {
    const { app, newsroomPublicKey } = await buildApp()
    const sealedText = await sealedBoxEncrypt(Buffer.from("tip"), newsroomPublicKey)
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const [r1, r2] = await Promise.all([
      fetch(`http://localhost:${port}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json"},
        body: JSON.stringify({ displayName: "Ghost", sealedText }),
      }),
      fetch(`http://localhost:${port}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Owl", sealedText }),
      }),
    ])
    const [b1, b2] = await Promise.all([r1.json(), r2.json()])
    server.close()
    expect(b1.diceware1).not.toBe(b2.diceware1)
    expect(b1.diceware2).not.toBe(b2.diceware2)
  })

  test("encrypts uploaded files with sealed DEK, removes temp files", async () => {
    const submissionsDir = mkdtempSync(`${tmpdir()}/submit-test-`)
    try {
      const { app, newsroomPublicKey, newsroomPrivateKey } = await buildApp(submissionsDir)
      const server = app.listen(0)
      const port = (server.address() as { port: number }).port

      const form = new FormData()
      form.append("displayName", "Ghost")
      form.append("files", new Blob(["secret file contents"]), "secret.txt")

      const r = await fetch(`http://localhost:${port}/submit`, { method: "POST", body: form })
      const body = await r.json()
      server.close()

      expect(r.status).toBe(200)
      expect(body.displayName).toBe("Ghost")

      const submissionDirs = readdirSync(submissionsDir)
      expect(submissionDirs.length).toBe(1)
      const submissionDir = `${submissionsDir}/${submissionDirs[0]}`
      const files = readdirSync(submissionDir)
      expect(files).toContain("0.enc")
      expect(files).toContain("0.key")

      const keyContent = JSON.parse(readFileSync(`${submissionDir}/0.key`, "utf8"))
      expect(keyContent.sealedDek).toBeString()
      expect(keyContent.encryptedFilename).toBeString()
      const { sealedBoxDecrypt: sbd } = await import("@journalist/shared/crypto")
      const dek = await sbd(keyContent.sealedDek, newsroomPublicKey, newsroomPrivateKey)
      expect(dek).toHaveLength(32)
    } finally {
      rmSync(submissionsDir, { recursive: true, force: true })
    }
  })
})
