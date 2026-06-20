import { describe, test, expect } from "bun:test"
import express from "express"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { openDb } from "../src/db"
import { deriveMasterKey, generateDEK } from "@journalist/shared/crypto"
import { createSubmitRouter } from "../src/routes/submit"

async function buildApp(submissionsDir?: string) {
  const db = openDb(":memory:")
  const salt = Buffer.alloc(16, 0xaa)
  const masterKey = await deriveMasterKey("test-passphrase", salt)
  const queueKey = await generateDEK()
  const router = createSubmitRouter({ db, masterKey, queueKey, queueDir: "/tmp", submissionsDir })
  const app = express()
  app.use(express.json())
  app.use("/submit", router)
  return { app, db }
}

describe("POST /submit", () => {
  test("returns 200 with codename and passphrase (no submissionId) on valid text submission", async () => {
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
    expect(body.submissionId).toBeUndefined()
    expect(body.passphrase).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
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

  test("two submissions produce different passphrases", async () => {
    const { app } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const [r1, r2] = await Promise.all([
      fetch(`http://localhost:${port}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "tip one" }),
      }),
      fetch(`http://localhost:${port}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "tip two" }),
      }),
    ])
    const [b1, b2] = await Promise.all([r1.json(), r2.json()])
    server.close()
    expect(b1.passphrase).not.toBe(b2.passphrase)
  })

  test("encrypts uploaded files and removes temp files", async () => {
    const submissionsDir = mkdtempSync(`${tmpdir()}/submit-test-`)
    try {
      const { app } = await buildApp(submissionsDir)
      const server = app.listen(0)
      const port = (server.address() as { port: number }).port

      const form = new FormData()
      form.append("files", new Blob(["secret file contents"]), "secret.txt")

      const r = await fetch(`http://localhost:${port}/submit`, { method: "POST", body: form })
      const body = await r.json()
      server.close()

      expect(r.status).toBe(200)
      expect(body.submissionId).toBeUndefined()
      expect(body.passphrase).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

      // submissionId is not in the response — find the created submission dir by listing
      const submissionDirs = readdirSync(submissionsDir)
      expect(submissionDirs.length).toBe(1)
      const submissionDir = `${submissionsDir}/${submissionDirs[0]}`
      const files = readdirSync(submissionDir)
      expect(files).toContain("0.enc")
      expect(files).toContain("0.key")

      const encContent = readFileSync(`${submissionDir}/0.enc`, "utf8")
      expect(encContent.length).toBeGreaterThan(0)
      expect(encContent).not.toContain("secret file contents")

      const keyContent = JSON.parse(readFileSync(`${submissionDir}/0.key`, "utf8"))
      expect(keyContent.encryptedDek).toBeString()
      expect(keyContent.encryptedFilename).toBeString()
      expect(keyContent.originalName).toBeUndefined()
    } finally {
      rmSync(submissionsDir, { recursive: true, force: true })
    }
  })
})
