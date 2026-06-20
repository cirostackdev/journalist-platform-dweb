import { describe, test, expect } from "bun:test"
import express from "express"
import argon2 from "argon2"
import { openDb } from "../src/db"
import { deriveMasterKey, generateDEK, encryptData, encryptDEK } from "@journalist/shared/crypto"
import { createCheckinRouter } from "../src/routes/checkin"

async function buildApp() {
  const db = openDb(":memory:")
  const salt = Buffer.alloc(16, 0xbb)
  const masterKey = await deriveMasterKey("test-passphrase", salt)

  const codename = "test-alpha-bravo"
  const codenameHash = await argon2.hash(codename, {
    type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1,
  })
  const sourceId = db.insertSource(codenameHash)
  const submissionId = db.insertSubmission(sourceId, null)

  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encBody = await encryptData("Hello from journalist", dek)
  db.insertMessage(submissionId, "journalist", encBody, encDek)

  const router = createCheckinRouter({ db, masterKey })
  const app = express()
  app.use(express.json())
  app.use("/checkin", router)

  return { app, codename, submissionId }
}

describe("POST /checkin", () => {
  test("returns decrypted messages for valid codename", async () => {
    const { app, codename } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codename }),
    })
    const body = await r.json()
    server.close()
    expect(r.status).toBe(200)
    expect(body.messages[0].body).toBe("Hello from journalist")
  })

  test("returns 401 for invalid codename", async () => {
    const { app } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codename: "wrong-wrong-wrong" }),
    })
    server.close()
    expect(r.status).toBe(401)
  })

  test("allows check-in without passphrase when source has no passphrase set", async () => {
    const { app, codename } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codename }),
    })
    server.close()
    expect(r.status).toBe(200)
  })
})

describe("POST /checkin with passphrase", () => {
  async function buildAppWithPassphrase() {
    const db = openDb(":memory:")
    const salt = Buffer.alloc(16, 0xcc)
    const masterKey = await deriveMasterKey("test-passphrase", salt)

    const codename = "test-charlie-delta"
    const codenameHash = await argon2.hash(codename, {
      type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1,
    })
    const passphrase = "secure-passphrase-xyz"
    const passphraseHash = await argon2.hash(passphrase, {
      type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1,
    })
    const sourceId = db.insertSource(codenameHash, passphraseHash)
    const submissionId = db.insertSubmission(sourceId, null)

    const dek = await generateDEK()
    const encDek = await encryptDEK(dek, masterKey)
    const encBody = await encryptData("Hello from journalist", dek)
    db.insertMessage(submissionId, "journalist", encBody, encDek)

    const router = createCheckinRouter({ db, masterKey })
    const app = express()
    app.use(express.json())
    app.use("/checkin", router)

    return { app, codename, passphrase, submissionId }
  }

  test("check-in with correct passphrase succeeds", async () => {
    const { app, codename, passphrase } = await buildAppWithPassphrase()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codename, passphrase }),
    })
    const body = await r.json()
    server.close()
    expect(r.status).toBe(200)
    expect(body.messages[0].body).toBe("Hello from journalist")
  })

  test("check-in without passphrase when required returns 401", async () => {
    const { app, codename } = await buildAppWithPassphrase()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codename }),
    })
    server.close()
    expect(r.status).toBe(401)
  })

  test("check-in with wrong passphrase returns 401", async () => {
    const { app, codename } = await buildAppWithPassphrase()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codename, passphrase: "wrong-passphrase" }),
    })
    server.close()
    expect(r.status).toBe(401)
  })
})
