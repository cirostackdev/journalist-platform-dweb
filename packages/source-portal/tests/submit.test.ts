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

  test("encrypts uploaded files and removes temp files", async () => {
    const submissionsDir = mkdtempSync(`${tmpdir()}/submit-test-`)
    try {
      const { app } = await buildApp(submissionsDir)
      const server = app.listen(0)
      const port = (server.address() as { port: number }).port

      const form = new FormData()
      form.append("files", new Blob(["secret file contents"]), "secret.txt")

      const r = await fetch(`http://localhost:${port}/submit`, {
        method: "POST",
        body: form,
      })
      const body = await r.json()
      server.close()

      expect(r.status).toBe(200)
      expect(body.submissionId).toBeString()

      // Verify encrypted files were written under submissionsDir
      const submissionDir = `${submissionsDir}/${body.submissionId}`
      const files = readdirSync(submissionDir)
      expect(files).toContain("0.enc")
      expect(files).toContain("0.key")

      // Verify .enc content is a non-empty base64 string (not plaintext)
      const encContent = readFileSync(`${submissionDir}/0.enc`, "utf8")
      expect(encContent.length).toBeGreaterThan(0)
      expect(encContent).not.toContain("secret file contents")

      // Verify .key sidecar has expected structure
      const keyContent = JSON.parse(readFileSync(`${submissionDir}/0.key`, "utf8"))
      expect(keyContent.encryptedDek).toBeString()
      expect(keyContent.originalName).toBe("secret.txt")
    } finally {
      rmSync(submissionsDir, { recursive: true, force: true })
    }
  })
})
