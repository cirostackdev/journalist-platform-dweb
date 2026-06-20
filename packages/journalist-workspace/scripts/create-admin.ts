/**
 * Bootstrap script to create the first admin user.
 * Usage: DATABASE_URL=postgres://... MASTER_PASSPHRASE=... bun run scripts/create-admin.ts <username> <password>
 *
 * The MASTER_PASSPHRASE must match the passphrase used when starting the workspace server.
 * The salt is read from SALT_PATH (default: /var/secure/salt).
 */
import { readFileSync, existsSync } from "fs"
import { openDb } from "../src/lib/db"
import { createAuthService } from "../src/lib/auth"
import { createSessionStore } from "../src/lib/session"
import { deriveMasterKey } from "@journalist/shared/crypto"
import type { Role } from "../src/lib/db"
import { createInterface } from "readline"

const SALT_PATH = process.env.SALT_PATH ?? "/var/secure/salt"
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://localhost/journalist_workspace"

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()) })
  })
}

async function main() {
  const [username, password] = process.argv.slice(2)
  if (!username || !password) {
    console.error("Usage: bun run scripts/create-admin.ts <username> <password>")
    process.exit(1)
  }

  if (!existsSync(SALT_PATH)) {
    console.error(`Salt file not found at ${SALT_PATH}. Start the source portal first to generate it.`)
    process.exit(1)
  }
  const salt = readFileSync(SALT_PATH)

  const passphrase = process.env.MASTER_PASSPHRASE ?? await prompt("Enter master passphrase: ")
  const masterKey = await deriveMasterKey(passphrase, salt)

  const db = await openDb(DATABASE_URL)
  const sessionStore = createSessionStore()
  const auth = createAuthService({ db, sessionStore, masterKey })

  const role: Role = "admin"
  const { userId, totpSecret } = await auth.createUser(username, password, role)

  console.log(`\n✓ Admin user created successfully.`)
  console.log(`  User ID:     ${userId}`)
  console.log(`  Username:    ${username}`)
  console.log(`  Role:        admin`)
  console.log(`\n⚠  TOTP Secret: ${totpSecret}`)
  console.log(`   Scan this in your authenticator app. It will not be shown again.\n`)

  await db.close()
}

main().catch((err) => { console.error(err.message); process.exit(1) })
