import { describe, test, expect } from "bun:test"
import express from "express"
import argon2 from "argon2"
import { createHmac } from "crypto"
import { openDb } from "../src/db"
import {
  deriveMasterKey,
  generateNewsroomKeypair,
  deriveSourceKeypair,
  boxEncrypt,
  boxDecrypt,
  sealedBoxDecrypt,
} from "@journalist/shared/crypto"
import { createCheckinRouter } from "../src/routes/checkin"

async function buildApp() {
  const db = openDb(":memory:")
  const salt = Buffer.alloc(16, 0xbb)
  const masterKey = await deriveMasterKey("test-passphrase", salt)
  const newsroom = await generateNewsroomKeypair()

  const diceware1 = "alpha-beta-gamma-delta-epsilon-zeta-eta"
  const diceware2 = "one-two-three-four-five-six-seven"
  const diceware1Hash = await argon2.hash(diceware1, {
    type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1,
  })
  const diceware1Hmac = createHmac("sha256", masterKey).update(diceware1).digest("hex")
  const { publicKey: sourcePK } = await deriveSourceKeypair(diceware2, { isTest: true })
  const sourcePKHex = Buffer.from(sourcePK).toString("hex")

  const sourceId = db.insertSource(diceware1Hash, diceware1Hmac, "Ghost", sourcePKHex)
  const submissionId = db.insertSubmission(sourceId, null)

  const replyText = "Hello from journalist"
  const boxedBody = await boxEncrypt(Buffer.from(replyText), sourcePK, newsroom.privateKey)
  const senderPublicKey = Buffer.from(newsroom.publicKey).toString("hex")
  db.insertMessage(submissionId, "journalist", boxedBody, senderPublicKey)

  const router = createCheckinRouter({ db, masterKey, newsroomPublicKey: newsroom.publicKey })
  const app = express()
  app.use(express.json())
  app.use("/checkin", router)

  return { app, db, diceware1, diceware2, newsroom, sourcePK, submissionId }
}

describe("POST /checkin", () => {
  test("returns 400 when diceware1 is missing", async () => {
    const { app } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    server.close()
    expect(r.status).toBe(400)
  })

  test("returns 401 for wrong diceware1", async () => {
    const { app } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diceware1: "wrong-wrong-wrong-wrong-wrong-wrong-wrong" }),
    })
    server.close()
    expect(r.status).toBe(401)
  })

  test("returns raw ciphertext blobs for valid diceware1", async () => {
    const { app, diceware1 } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diceware1 }),
    })
    const body = await r.json()
    server.close()
    expect(r.status).toBe(200)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].ciphertext).toBeString()
    expect(body.messages[0].senderPublicKey).toBeString()
    expect(body.messages[0].body).toBeUndefined()
  })

  test("returned ciphertext can be decrypted using diceware2-derived private key", async () => {
    const { app, diceware1, diceware2 } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diceware1 }),
    })
    const body = await r.json()
    server.close()

    const { privateKey: sourceSK } = await deriveSourceKeypair(diceware2, { isTest: true })
    const msg = body.messages[0]
    const senderPK = Buffer.from(msg.senderPublicKey, "hex")
    const decrypted = await boxDecrypt(msg.ciphertext, senderPK, sourceSK)
    expect(decrypted.toString("utf8")).toBe("Hello from journalist")
  })

  test("diceware2 is never required by the server (auth uses diceware1 only)", async () => {
    const { app, diceware1 } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diceware1 }),
    })
    server.close()
    expect(r.status).toBe(200)
  })

  test("stores follow-up message sealed with newsroom public key", async () => {
    const { app, diceware1, newsroom, submissionId, db } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diceware1, followUpMessage: "Extra context from source." }),
    })
    server.close()
    expect(r.status).toBe(200)

    // Verify the message was stored with direction='source'
    const stored = db
      .query("SELECT encrypted_body, direction FROM messages WHERE submission_id = ? AND direction = 'source'")
      .all(submissionId) as { encrypted_body: string; direction: string }[]
    expect(stored).toHaveLength(1)

    // Verify decryptability
    const decrypted = await sealedBoxDecrypt(stored[0].encrypted_body, newsroom.publicKey, newsroom.privateKey)
    expect(decrypted.toString("utf8")).toBe("Extra context from source.")
  })

  test("ignores empty follow-up message", async () => {
    const { app, diceware1, submissionId, db } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diceware1, followUpMessage: "   " }),
    })
    server.close()
    expect(r.status).toBe(200)

    const stored = db
      .query("SELECT id FROM messages WHERE submission_id = ? AND direction = 'source'")
      .all(submissionId)
    expect(stored).toHaveLength(0)
  })
})
