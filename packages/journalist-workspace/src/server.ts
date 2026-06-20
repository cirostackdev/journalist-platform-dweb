import { createInterface } from "readline"
import { existsSync, readFileSync, mkdirSync } from "fs"
import { deriveMasterKey } from "@journalist/shared/crypto"
import { openDb } from "./lib/db"
import { createSessionStore } from "./lib/session"
import { createQueueConsumer } from "./lib/queue-consumer"
import { initGlobals } from "./lib/globals"
import { createServer } from "http"
import next from "next"

const SALT_PATH = "/var/secure/salt"
const QUEUE_DIR = "/var/secure-queue"
const QUEUE_KEY_RAW_PATH = "/var/secure/queue.key"
const PUBLICATION_DIR = "/var/publication"
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://localhost/journalist_workspace"
const PORT = 3001

async function promptPassphrase(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => { rl.question("Enter master passphrase: ", (a) => { rl.close(); resolve(a.trim()) }) })
}

async function main() {
  mkdirSync(PUBLICATION_DIR, { recursive: true })
  mkdirSync(`${PUBLICATION_DIR}/articles`, { recursive: true })
  if (!existsSync(SALT_PATH)) { console.error(`Salt not found at ${SALT_PATH}. Start source portal first.`); process.exit(1) }
  if (!existsSync(QUEUE_KEY_RAW_PATH)) { console.error(`Queue key not found at ${QUEUE_KEY_RAW_PATH}.`); process.exit(1) }
  const salt = readFileSync(SALT_PATH)
  const passphrase = await promptPassphrase()
  const masterKey = await deriveMasterKey(passphrase, salt)
  const queueKey = new Uint8Array(readFileSync(QUEUE_KEY_RAW_PATH))
  const db = await openDb(DATABASE_URL)
  const sessionStore = createSessionStore()
  initGlobals({ db, sessionStore, masterKey, queueKey, queueDir: QUEUE_DIR, publicationDir: PUBLICATION_DIR })
  createQueueConsumer({ db, queueDir: QUEUE_DIR, queueKey })
  console.log("Queue consumer started.")
  const app = next({ dev: false, hostname: "127.0.0.1", port: PORT })
  await app.prepare()
  const handler = app.getRequestHandler()
  createServer(handler).listen(PORT, "127.0.0.1", () => { console.log(`Journalist workspace running on 127.0.0.1:${PORT}`) })
}

main().catch((err) => { console.error("Fatal startup error:", err); process.exit(1) })
