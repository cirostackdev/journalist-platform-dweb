import { describe, test, expect } from "bun:test"
import express from "express"
import { openDb } from "../src/db"
import { deriveMasterKey, generateDEK } from "@journalist/shared/crypto"
import { createSubmitRouter } from "../src/routes/submit"

async function buildApp() {
  const db = openDb(":memory:")
  const salt = Buffer.alloc(16, 0xaa)
  const masterKey = await deriveMasterKey("test-passphrase", salt)
  const queueKey = await generateDEK()
  const router = createSubmitRouter({ db, masterKey, queueKey, queueDir: "/tmp" })
  const app = express()
  app.use(express.json())
  app.use("/submit", router)
  return { app, db }
}

describe("POST /submit", () => {
  test("returns 200 with codename on valid text submission", async () => {
    const { app } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "this is my tip" }),
    })
    const body = await r.json()
    server.close()
    expect(r.status).toBe(200)
    expect(body.codename).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
    expect(body.submissionId).toBeString()
  })

  test("returns 400 when neither text nor files provided", async () => {
    const { app } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    server.close()
    expect(r.status).toBe(400)
  })
})
