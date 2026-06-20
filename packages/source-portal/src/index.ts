import express from "express"
import { createInterface } from "readline"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { randomBytes, createHash } from "crypto"
import { join } from "path"
import { deriveMasterKey, generateDEK } from "@journalist/shared/crypto"
import { openDb } from "./db"
import { startReplyConsumer } from "./replyConsumer"
import { createSubmitRouter } from "./routes/submit"
import { createCheckinRouter } from "./routes/checkin"
import { createRateLimiter } from "./middleware/rateLimit"

const SALT_PATH = "/var/secure/salt"
const DB_PATH = "/var/secure/source-portal.db"
const TO_WORKSPACE_QUEUE_DIR = "/var/secure-queue/to-workspace"
const TO_PORTAL_QUEUE_DIR = "/var/secure-queue/to-portal"
const QUEUE_KEY_RAW_PATH = "/var/secure/queue.key"
const PORT = 3000

async function promptPassphrase(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question("Enter master passphrase: ", (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main() {
  mkdirSync("/var/secure", { recursive: true })
  mkdirSync(TO_WORKSPACE_QUEUE_DIR, { recursive: true })
  mkdirSync(TO_PORTAL_QUEUE_DIR, { recursive: true })

  let salt: Buffer
  if (existsSync(SALT_PATH)) {
    salt = readFileSync(SALT_PATH)
  } else {
    salt = Buffer.from(randomBytes(16))
    writeFileSync(SALT_PATH, salt, { mode: 0o600 })
    console.log("Generated new salt.")
  }

  const passphrase = await promptPassphrase()
  const masterKey = await deriveMasterKey(passphrase, salt)
  const newsroomPubKeyHex = process.env.NEWSROOM_PUBLIC_KEY_HEX
  if (!newsroomPubKeyHex) {
    console.error("NEWSROOM_PUBLIC_KEY_HEX env var is required. Run: bun scripts/generate-keypair.ts")
    process.exit(1)
  }
  const newsroomPublicKey = new Uint8Array(Buffer.from(newsroomPubKeyHex, "hex"))
  const keyFingerprint = createHash("sha256").update(masterKey).digest("hex").slice(0, 12)
  console.log(`Master key fingerprint: ${keyFingerprint} — verify this matches the other service.`)

  let queueKey: Uint8Array
  if (existsSync(QUEUE_KEY_RAW_PATH)) {
    queueKey = new Uint8Array(readFileSync(QUEUE_KEY_RAW_PATH))
  } else {
    queueKey = await generateDEK()
    writeFileSync(QUEUE_KEY_RAW_PATH, Buffer.from(queueKey), { mode: 0o600 })
    console.log("Generated new queue key. Copy /var/secure/queue.key to journalist workspace.")
  }

  const db = openDb(DB_PATH)
  startReplyConsumer({ db, queueDir: TO_PORTAL_QUEUE_DIR, queueKey })
  const submitLimiter = createRateLimiter({ maxRequests: 5, windowMs: 60_000 })
  const checkinLimiter = createRateLimiter({
    maxRequests: 10,
    windowMs: 60_000,
    keyExtractor: (req) => {
      const diceware1 = req.body?.diceware1
      if (typeof diceware1 === "string" && diceware1.length > 0) {
        return createHash("sha256").update(diceware1).digest("hex")
      }
      return req.ip ?? "unknown"
    },
  })

  const app = express()
  app.use(express.json({ limit: "1mb" }))
  app.disable("x-powered-by")

  const PUBLIC_DIR = join(import.meta.dir, "..", "public")
  app.get("/", (_req, res) => res.sendFile(join(PUBLIC_DIR, "index.html")))
  app.get("/checkin", (_req, res) => res.sendFile(join(PUBLIC_DIR, "checkin.html")))
  app.use(express.static(PUBLIC_DIR))

  app.get("/pubkey", (_req, res) => {
    res.json({ publicKey: newsroomPubKeyHex })
  })

  app.use("/submit", submitLimiter, createSubmitRouter({
    db,
    newsroomPublicKey,
    masterKey,
    queueKey,
    queueDir: TO_WORKSPACE_QUEUE_DIR,
  }))
  app.use("/checkin", checkinLimiter, createCheckinRouter({ db, masterKey, newsroomPublicKey }))
  app.get("/health", (_req, res) => res.json({ ok: true }))

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Source portal running on 127.0.0.1:${PORT}`)
  })
}

main().catch((err) => {
  console.error("Fatal startup error:", err)
  process.exit(1)
})
