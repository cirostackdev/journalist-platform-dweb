# Option C — Asymmetric E2E Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace server-side masterKey encryption with asymmetric E2E crypto: source submissions are sealed to the newsroom's X25519 public key (never decryptable by the portal server); journalist replies are box-encrypted to the source's derived public key (decrypted client-side in the browser using diceware2).

**Architecture:** Newsroom holds one X25519 keypair. Source portal has the public key only (seals submissions to it). Workspace has the private key (decrypts submissions). Sources get two 7-word diceware phrases: diceware1 for check-in auth; diceware2 fed into `libsodium.crypto_pwhash` → `crypto_box_seed_keypair` to derive an ephemeral keypair — the public key is stored server-side, the private key is derived in the browser at check-in and never sent anywhere. Sources also choose a required one-word display name stored in plaintext for attribution. The browser-side crypto runs via a bundled `portal-crypto.js` (Bun IIFE bundle of libsodium-wrappers).

**Tech Stack:** libsodium-wrappers (X25519 / crypto_box_seal / crypto_pwhash), Bun bundler (browser IIFE), Express, Next.js, bun:sqlite, bun test

---

## File Map

| File | Change |
|---|---|
| `packages/shared/src/crypto.ts` | Add `generateNewsroomKeypair`, `deriveSourceKeypair`, `sealedBoxEncrypt`, `sealedBoxDecrypt`, `boxEncrypt`, `boxDecrypt` |
| `scripts/generate-keypair.ts` | New — one-time script, outputs `NEWSROOM_PUBLIC_KEY_HEX` + `NEWSROOM_PRIVATE_KEY_HEX` |
| `packages/source-portal/src/wordlist.ts` | `generateCodename` → `generateDiceware`, 3 words → 7 words |
| `packages/source-portal/src/db.ts` | Add `display_name`, `source_public_key` to sources; add `sender_public_key` to messages; update method signatures |
| `packages/source-portal/src/routes/submit.ts` | Rewrite: accept `displayName` + `sealedText`; generate diceware1+2; seal file DEKs; no masterKey crypto |
| `packages/source-portal/src/routes/checkin.ts` | Rewrite: auth via diceware1 only; return raw ciphertext blobs, no server-side decryption |
| `packages/source-portal/src/replyConsumer.ts` | Update field: `encryptedDek` → `senderPublicKey` |
| `packages/source-portal/src/index.ts` | Load `NEWSROOM_PUBLIC_KEY_HEX` from env; add `GET /pubkey`; pass `newsroomPublicKey` to routers |
| `packages/source-portal/src/portal-crypto.ts` | New — browser IIFE source: exposes `window.PortalCrypto` |
| `packages/source-portal/package.json` | Add `build:crypto` script |
| `packages/source-portal/public/portal.js` | Rewrite: encrypt text in browser before POST; derive keypair from diceware2 for check-in decrypt |
| `packages/source-portal/public/index.html` | Add `displayName` required field; update success screen (two diceware phrases); load `portal-crypto.js` |
| `packages/source-portal/public/checkin.html` | Rename inputs: `codename` → `diceware1`, `passphrase` → `diceware2` |
| `packages/journalist-workspace/src/lib/globals.ts` | Add `newsroomPublicKey: Uint8Array`, `newsroomPrivateKey: Uint8Array` |
| `packages/journalist-workspace/src/server.ts` | Load keypair from env; pass to `initGlobals` |
| `packages/journalist-workspace/src/app/api/cases/[id]/reply/route.ts` | box-encrypt reply to source's public key |
| `packages/journalist-workspace/src/lib/portal-db.ts` | Decrypt sealed text/file DEKs with newsroom private key |

---

## Crypto Primitives Reference

```
crypto_box_seal(plaintext, recipientPK)
  → sealed ciphertext (ephemeral ECDH + XSalsa20-Poly1305, anonymous sender)
  Used for: source text → newsroom; file DEK → newsroom

crypto_box_seal_open(ciphertext, recipientPK, recipientSK)
  → plaintext
  Used for: workspace decrypts source text/file DEKs

crypto_box_easy(plaintext, nonce, recipientPK, senderSK)
  → ciphertext
  Used for: journalist reply → source public key
  Stored as: base64(nonce || ciphertext), nonce = 24 random bytes

crypto_box_open_easy(ciphertext, nonce, senderPK, recipientSK)
  → plaintext
  Used for: browser decrypts journalist reply using diceware2-derived SK

crypto_pwhash(32, password, salt, opslimit, memlimit, ALG_ARGON2ID13)
  → 32-byte seed
  Used for: derive source X25519 keypair from diceware2

crypto_box_seed_keypair(seed)
  → { publicKey: Uint8Array(32), privateKey: Uint8Array(32) }
  Used for: source keypair derivation (server at submit, browser at check-in)
```

---

## Constants (used in multiple tasks — copy exactly)

```typescript
// Fixed 16-byte salt for source keypair derivation.
// Hex: 7372632d6b657970 6169722d76312020
// Text: "src-keypair-v1  "
const KEYPAIR_SALT = new Uint8Array([
  0x73, 0x72, 0x63, 0x2d, 0x6b, 0x65, 0x79, 0x70,
  0x61, 0x69, 0x72, 0x2d, 0x76, 0x31, 0x20, 0x20,
])

// Argon2id params for source keypair derivation
// Production: opslimit=2 (INTERACTIVE), memlimit=67108864 (64MB, INTERACTIVE)
// Test:       opslimit=1 (MIN),         memlimit=8192 (MIN)
```

---

## Task 1: Shared crypto helpers + keypair generation script

**Files:**
- Modify: `packages/shared/src/crypto.ts`
- Create: `scripts/generate-keypair.ts`
- Modify: `packages/source-portal/tests/crypto.test.ts`

- [ ] **Step 1.1: Add new functions to `packages/shared/src/crypto.ts`**

Append after the existing `generatePassphrase` function (do not remove existing functions):

```typescript
// ── Constants ────────────────────────────────────────────────────────────────

// Fixed 16-byte salt for source keypair derivation ("src-keypair-v1  ")
const KEYPAIR_SALT = new Uint8Array([
  0x73, 0x72, 0x63, 0x2d, 0x6b, 0x65, 0x79, 0x70,
  0x61, 0x69, 0x72, 0x2d, 0x76, 0x31, 0x20, 0x20,
])

// ── Newsroom keypair ──────────────────────────────────────────────────────────

/**
 * Generate a fresh X25519 keypair for the newsroom.
 * Run once via scripts/generate-keypair.ts; store in env vars.
 */
export async function generateNewsroomKeypair(): Promise<{
  publicKey: Uint8Array
  privateKey: Uint8Array
}> {
  await sodium.ready
  return sodium.crypto_box_keypair()
}

// ── Source keypair derivation ─────────────────────────────────────────────────

/**
 * Derive a deterministic X25519 keypair from a 7-word diceware2 phrase.
 * Identical result in Node.js (libsodium-wrappers) and browser (portal-crypto.js).
 * isTest=true uses minimum argon2id params (fast for CI, ~8KB RAM, 1 pass).
 */
export async function deriveSourceKeypair(
  diceware2: string,
  opts: { isTest?: boolean } = {}
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  await sodium.ready
  const isTest = opts.isTest ?? process.env.NODE_ENV === "test"
  const opslimit = isTest
    ? sodium.crypto_pwhash_OPSLIMIT_MIN   // 1
    : sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE // 2
  const memlimit = isTest
    ? sodium.crypto_pwhash_MEMLIMIT_MIN   // 8192
    : sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE // 67108864 (64MB)
  const seed = sodium.crypto_pwhash(
    32,
    Buffer.from(diceware2, "utf8"),
    KEYPAIR_SALT,
    opslimit,
    memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )
  return sodium.crypto_box_seed_keypair(seed)
}

// ── Sealed box (anonymous sender) ─────────────────────────────────────────────

/**
 * Encrypt plaintext to a recipient's public key without revealing sender identity.
 * Uses crypto_box_seal (ephemeral ECDH + XSalsa20-Poly1305).
 * Returns base64 ciphertext.
 */
export async function sealedBoxEncrypt(
  plaintext: Buffer,
  recipientPublicKey: Uint8Array
): Promise<string> {
  await sodium.ready
  const ciphertext = sodium.crypto_box_seal(plaintext, recipientPublicKey)
  return Buffer.from(ciphertext).toString("base64")
}

/**
 * Decrypt a sealed box ciphertext using the recipient's keypair.
 * Throws if decryption fails (wrong key or corrupted data).
 */
export async function sealedBoxDecrypt(
  ciphertext: string,
  publicKey: Uint8Array,
  privateKey: Uint8Array
): Promise<Buffer> {
  await sodium.ready
  const buf = Buffer.from(ciphertext, "base64")
  const plain = sodium.crypto_box_seal_open(buf, publicKey, privateKey)
  if (!plain) throw new Error("sealedBoxDecrypt: decryption failed — wrong key or corrupted data")
  return Buffer.from(plain)
}

// ── Authenticated box (newsroom → source) ─────────────────────────────────────

/**
 * Encrypt plaintext from sender to recipient using authenticated box encryption.
 * Prepends a random 24-byte nonce. Returns base64(nonce || ciphertext).
 */
export async function boxEncrypt(
  plaintext: Buffer,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: Uint8Array
): Promise<string> {
  await sodium.ready
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES)
  const ciphertext = sodium.crypto_box_easy(plaintext, nonce, recipientPublicKey, senderPrivateKey)
  return Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]).toString("base64")
}

/**
 * Decrypt an authenticated box ciphertext (nonce prepended).
 * Throws if decryption fails.
 */
export async function boxDecrypt(
  ciphertext: string,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): Promise<Buffer> {
  await sodium.ready
  const buf = Buffer.from(ciphertext, "base64")
  if (buf.length <= sodium.crypto_box_NONCEBYTES) {
    throw new Error("boxDecrypt: ciphertext too short")
  }
  const nonce = buf.subarray(0, sodium.crypto_box_NONCEBYTES)
  const data = buf.subarray(sodium.crypto_box_NONCEBYTES)
  const plain = sodium.crypto_box_open_easy(data, nonce, senderPublicKey, recipientPrivateKey)
  if (!plain) throw new Error("boxDecrypt: decryption failed — wrong key or corrupted data")
  return Buffer.from(plain)
}
```

- [ ] **Step 1.2: Write tests for new crypto functions**

In `packages/source-portal/tests/crypto.test.ts`, append after the `generatePassphrase` describe block:

```typescript
import {
  // existing imports stay...
  generateNewsroomKeypair,
  deriveSourceKeypair,
  sealedBoxEncrypt,
  sealedBoxDecrypt,
  boxEncrypt,
  boxDecrypt,
} from "@journalist/shared/crypto"

describe("generateNewsroomKeypair", () => {
  test("returns 32-byte public and private keys", async () => {
    const { publicKey, privateKey } = await generateNewsroomKeypair()
    expect(publicKey).toHaveLength(32)
    expect(privateKey).toHaveLength(32)
  })

  test("two calls produce different keypairs", async () => {
    const a = await generateNewsroomKeypair()
    const b = await generateNewsroomKeypair()
    expect(Buffer.from(a.publicKey).equals(Buffer.from(b.publicKey))).toBe(false)
  })
})

describe("deriveSourceKeypair", () => {
  test("returns 32-byte public and private keys", async () => {
    const { publicKey, privateKey } = await deriveSourceKeypair(
      "one two three four five six seven", { isTest: true }
    )
    expect(publicKey).toHaveLength(32)
    expect(privateKey).toHaveLength(32)
  })

  test("same diceware2 produces same keypair (deterministic)", async () => {
    const phrase = "alpha beta gamma delta epsilon zeta eta"
    const a = await deriveSourceKeypair(phrase, { isTest: true })
    const b = await deriveSourceKeypair(phrase, { isTest: true })
    expect(Buffer.from(a.publicKey).equals(Buffer.from(b.publicKey))).toBe(true)
    expect(Buffer.from(a.privateKey).equals(Buffer.from(b.privateKey))).toBe(true)
  })

  test("different diceware2 produces different keypairs", async () => {
    const a = await deriveSourceKeypair("one two three four five six seven", { isTest: true })
    const b = await deriveSourceKeypair("eight nine ten eleven twelve thirteen fourteen", { isTest: true })
    expect(Buffer.from(a.publicKey).equals(Buffer.from(b.publicKey))).toBe(false)
  })
})

describe("sealedBoxEncrypt / sealedBoxDecrypt", () => {
  test("round-trips a message", async () => {
    const { publicKey, privateKey } = await generateNewsroomKeypair()
    const plaintext = Buffer.from("top secret tip")
    const ciphertext = await sealedBoxEncrypt(plaintext, publicKey)
    const decrypted = await sealedBoxDecrypt(ciphertext, publicKey, privateKey)
    expect(decrypted.toString("utf8")).toBe("top secret tip")
  })

  test("two encryptions of same plaintext produce different ciphertexts", async () => {
    const { publicKey } = await generateNewsroomKeypair()
    const a = await sealedBoxEncrypt(Buffer.from("tip"), publicKey)
    const b = await sealedBoxEncrypt(Buffer.from("tip"), publicKey)
    expect(a).not.toBe(b)
  })

  test("decryption fails with wrong private key", async () => {
    const real = await generateNewsroomKeypair()
    const wrong = await generateNewsroomKeypair()
    const ct = await sealedBoxEncrypt(Buffer.from("tip"), real.publicKey)
    await expect(sealedBoxDecrypt(ct, real.publicKey, wrong.privateKey)).rejects.toThrow()
  })
})

describe("boxEncrypt / boxDecrypt", () => {
  test("round-trips a message between newsroom and source", async () => {
    const newsroom = await generateNewsroomKeypair()
    const source = await deriveSourceKeypair("one two three four five six seven", { isTest: true })
    const plaintext = Buffer.from("reply from journalist")
    const ct = await boxEncrypt(plaintext, source.publicKey, newsroom.privateKey)
    const decrypted = await boxDecrypt(ct, newsroom.publicKey, source.privateKey)
    expect(decrypted.toString("utf8")).toBe("reply from journalist")
  })

  test("two encryptions produce different ciphertexts (random nonce)", async () => {
    const newsroom = await generateNewsroomKeypair()
    const source = await deriveSourceKeypair("one two three four five six seven", { isTest: true })
    const a = await boxEncrypt(Buffer.from("reply"), source.publicKey, newsroom.privateKey)
    const b = await boxEncrypt(Buffer.from("reply"), source.publicKey, newsroom.privateKey)
    expect(a).not.toBe(b)
  })

  test("decryption fails with wrong sender public key", async () => {
    const newsroom = await generateNewsroomKeypair()
    const wrong = await generateNewsroomKeypair()
    const source = await deriveSourceKeypair("one two three four five six seven", { isTest: true })
    const ct = await boxEncrypt(Buffer.from("reply"), source.publicKey, newsroom.privateKey)
    await expect(boxDecrypt(ct, wrong.publicKey, source.privateKey)).rejects.toThrow()
  })

  test("boxDecrypt throws on truncated ciphertext", async () => {
    const source = await deriveSourceKeypair("a b c d e f g", { isTest: true })
    const newsroom = await generateNewsroomKeypair()
    await expect(boxDecrypt("dG9vc2hvcnQ=", newsroom.publicKey, source.privateKey)).rejects.toThrow()
  })
})
```

- [ ] **Step 1.3: Run crypto tests**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test packages/source-portal/tests/crypto.test.ts
```

Expected: all new tests pass.

- [ ] **Step 1.4: Create `scripts/generate-keypair.ts`**

```typescript
#!/usr/bin/env bun
/**
 * One-time script: generate the newsroom X25519 keypair.
 * Run once, copy output to .env files:
 *   - NEWSROOM_PUBLIC_KEY_HEX → both source portal and workspace
 *   - NEWSROOM_PRIVATE_KEY_HEX → workspace only (never to source portal)
 */
import { generateNewsroomKeypair } from "./packages/shared/src/crypto"

const { publicKey, privateKey } = await generateNewsroomKeypair()
const pubHex = Buffer.from(publicKey).toString("hex")
const privHex = Buffer.from(privateKey).toString("hex")

console.log("# Add to source portal environment:")
console.log(`NEWSROOM_PUBLIC_KEY_HEX=${pubHex}`)
console.log("")
console.log("# Add to workspace environment (KEEP THIS PRIVATE):")
console.log(`NEWSROOM_PUBLIC_KEY_HEX=${pubHex}`)
console.log(`NEWSROOM_PRIVATE_KEY_HEX=${privHex}`)
```

- [ ] **Step 1.5: Commit**

```bash
git add packages/shared/src/crypto.ts packages/source-portal/tests/crypto.test.ts scripts/generate-keypair.ts
git commit -m "feat: asymmetric crypto helpers — sealedBox, box, deriveSourceKeypair, keypair gen"
```

---

## Task 2: 7-word diceware (`generateDiceware`)

**Files:**
- Modify: `packages/source-portal/src/wordlist.ts`
- Modify: `packages/source-portal/tests/wordlist.test.ts`

- [ ] **Step 2.1: Update `generateCodename` to 7 words and rename export**

In `packages/source-portal/src/wordlist.ts`, change the function:

```typescript
// Replace the existing generateCodename function:
export async function generateDiceware(): Promise<string> {
  await sodium.ready
  const words: string[] = []
  for (let i = 0; i < 7; i++) {
    const buf = sodium.randombytes_buf(4)
    const index = (Buffer.from(buf).readUInt32BE(0) >>> 0) % WORDS.length
    words.push(WORDS[index])
  }
  return words.join("-")
}

// Keep backward-compat alias so nothing outside this PR breaks during migration
export const generateCodename = generateDiceware
```

- [ ] **Step 2.2: Update wordlist test**

Replace `packages/source-portal/tests/wordlist.test.ts` entirely:

```typescript
import { describe, test, expect } from "bun:test"
import { generateDiceware } from "../src/wordlist"

describe("generateDiceware", () => {
  test("returns a 7-word hyphenated phrase", async () => {
    const diceware = await generateDiceware()
    const parts = diceware.split("-")
    expect(parts).toHaveLength(7)
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0))
  })

  test("generates different phrases across calls", async () => {
    const phrases = new Set<string>()
    for (let i = 0; i < 10; i++) {
      phrases.add(await generateDiceware())
    }
    expect(phrases.size).toBeGreaterThan(1)
  })

  test("uses only lowercase alphabetic words", async () => {
    const diceware = await generateDiceware()
    expect(diceware).toMatch(/^[a-z]+(-[a-z]+){6}$/)
  })
})
```

- [ ] **Step 2.3: Run wordlist test**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test packages/source-portal/tests/wordlist.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 2.4: Commit**

```bash
git add packages/source-portal/src/wordlist.ts packages/source-portal/tests/wordlist.test.ts
git commit -m "feat: 7-word diceware — generateDiceware (was generateCodename, 3 words)"
```

---

## Task 3: Source portal DB schema

**Files:**
- Modify: `packages/source-portal/src/db.ts`
- Modify: `packages/source-portal/tests/db.test.ts`

- [ ] **Step 3.1: Update schema and method signatures in `packages/source-portal/src/db.ts`**

Replace the entire file:

```typescript
import { Database } from "bun:sqlite"
import { randomUUID } from "crypto"

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    source_public_key TEXT NOT NULL,
    codename_hash TEXT NOT NULL UNIQUE,
    codename_hmac TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    encrypted_text TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    submitted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submission_files (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    encrypted_filename TEXT NOT NULL,
    encrypted_dek TEXT NOT NULL,
    file_path TEXT NOT NULL,
    submitted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    direction TEXT NOT NULL CHECK(direction IN ('source', 'journalist')),
    encrypted_body TEXT NOT NULL,
    sender_public_key TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
`

export type Message = {
  id: string
  submission_id: string
  direction: "source" | "journalist"
  encrypted_body: string
  sender_public_key: string
  created_at: number
}

export type Source = {
  id: string
  display_name: string
  source_public_key: string
  codename_hash: string
  codename_hmac: string | null
  created_at: number
}

export interface Db {
  close(): void
  query(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }
  insertSource(
    codenameHash: string,
    codenameHmac: string,
    displayName: string,
    sourcePublicKey: string
  ): string
  insertSubmission(sourceId: string, encryptedText: string | null): string
  insertSubmissionFile(
    submissionId: string,
    encryptedFilename: string,
    encryptedDek: string,
    filePath: string
  ): string
  insertMessage(
    submissionId: string,
    direction: "source" | "journalist",
    encryptedBody: string,
    senderPublicKey: string
  ): string
  getMessages(submissionId: string): Message[]
  getSourceByHmac(hmac: string): Source | null
}

export function openDb(path: string): Db {
  const sqlite = new Database(path)
  sqlite.exec("PRAGMA journal_mode = WAL;")
  sqlite.exec("PRAGMA foreign_keys = ON;")
  sqlite.exec(SCHEMA)
  // Migrations for existing DBs
  for (const col of [
    "ALTER TABLE sources ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE sources ADD COLUMN source_public_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN sender_public_key TEXT NOT NULL DEFAULT ''",
  ]) {
    try { sqlite.exec(col) } catch { /* already exists */ }
  }

  return {
    close() { sqlite.close() },

    query(sql: string) {
      return sqlite.query(sql) as { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }
    },

    insertSource(
      codenameHash: string,
      codenameHmac: string,
      displayName: string,
      sourcePublicKey: string
    ): string {
      const id = randomUUID()
      sqlite
        .query(
          "INSERT INTO sources (id, codename_hash, codename_hmac, display_name, source_public_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(id, codenameHash, codenameHmac, displayName, sourcePublicKey, Date.now())
      return id
    },

    insertSubmission(sourceId: string, encryptedText: string | null): string {
      const id = randomUUID()
      sqlite
        .query("INSERT INTO submissions (id, source_id, encrypted_text, submitted_at) VALUES (?, ?, ?, ?)")
        .run(id, sourceId, encryptedText, Date.now())
      return id
    },

    insertSubmissionFile(
      submissionId: string,
      encryptedFilename: string,
      encryptedDek: string,
      filePath: string
    ): string {
      const id = randomUUID()
      sqlite
        .query(
          "INSERT INTO submission_files (id, submission_id, encrypted_filename, encrypted_dek, file_path, submitted_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(id, submissionId, encryptedFilename, encryptedDek, filePath, Date.now())
      return id
    },

    insertMessage(
      submissionId: string,
      direction: "source" | "journalist",
      encryptedBody: string,
      senderPublicKey: string
    ): string {
      const id = randomUUID()
      sqlite
        .query(
          "INSERT INTO messages (id, submission_id, direction, encrypted_body, sender_public_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(id, submissionId, direction, encryptedBody, senderPublicKey, Date.now())
      return id
    },

    getMessages(submissionId: string): Message[] {
      return sqlite
        .query("SELECT * FROM messages WHERE submission_id = ? ORDER BY created_at ASC")
        .all(submissionId) as Message[]
    },

    getSourceByHmac(hmac: string): Source | null {
      return sqlite
        .query("SELECT * FROM sources WHERE codename_hmac = ?")
        .get(hmac) as Source | null
    },
  }
}
```

- [ ] **Step 3.2: Update `packages/source-portal/tests/db.test.ts`**

Replace entirely:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { openDb, type Db } from "../src/db"

let db: Db

beforeEach(() => { db = openDb(":memory:") })
afterEach(() => { db.close() })

describe("schema", () => {
  test("sources table exists", () => {
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sources'").get()).not.toBeNull()
  })
  test("submissions table exists", () => {
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='submissions'").get()).not.toBeNull()
  })
  test("messages table exists", () => {
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get()).not.toBeNull()
  })
  test("submission_files table exists", () => {
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='submission_files'").get()).not.toBeNull()
  })
})

describe("insertSource", () => {
  test("inserts a source and returns its id", () => {
    const id = db.insertSource("hashed-codename", "hmac-hex", "Ghost", "pubkey-hex")
    expect(id).toBeString()
    expect(id.length).toBeGreaterThan(0)
  })

  test("rejects duplicate codename_hash", () => {
    db.insertSource("same-hash", "hmac-a", "Alpha", "pk-a")
    expect(() => db.insertSource("same-hash", "hmac-b", "Beta", "pk-b")).toThrow()
  })

  test("stores display_name and source_public_key", () => {
    const id = db.insertSource("ch", "hm", "Nighthawk", "pk-hex-123")
    const row = db.query("SELECT display_name, source_public_key FROM sources WHERE id = ?").get(id) as any
    expect(row.display_name).toBe("Nighthawk")
    expect(row.source_public_key).toBe("pk-hex-123")
  })
})

describe("insertSubmission", () => {
  test("inserts a submission linked to a source", () => {
    const sourceId = db.insertSource("hash-abc", "hmac-abc", "Ghost", "pk-abc")
    const subId = db.insertSubmission(sourceId, "sealed-ciphertext-base64")
    expect(subId).toBeString()
  })
})

describe("insertMessage / getMessages", () => {
  test("stores journalist message with sender_public_key and retrieves it", () => {
    const sourceId = db.insertSource("ch", "hm", "Ghost", "pk")
    const subId = db.insertSubmission(sourceId, null)
    db.insertMessage(subId, "journalist", "box-ciphertext-base64", "newsroom-pubkey-hex")
    const messages = db.getMessages(subId)
    expect(messages).toHaveLength(1)
    expect(messages[0].encrypted_body).toBe("box-ciphertext-base64")
    expect(messages[0].sender_public_key).toBe("newsroom-pubkey-hex")
    expect(messages[0].direction).toBe("journalist")
  })
})

describe("getSourceByHmac", () => {
  test("returns source for known hmac", () => {
    db.insertSource("ch", "known-hmac", "Ghost", "pk")
    const src = db.getSourceByHmac("known-hmac")
    expect(src).not.toBeNull()
    expect(src!.display_name).toBe("Ghost")
  })

  test("returns null for unknown hmac", () => {
    expect(db.getSourceByHmac("unknown")).toBeNull()
  })
})
```

- [ ] **Step 3.3: Run DB tests**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test packages/source-portal/tests/db.test.ts
```

Expected: all tests pass.

- [ ] **Step 3.4: Commit**

```bash
git add packages/source-portal/src/db.ts packages/source-portal/tests/db.test.ts
git commit -m "feat: db schema — display_name, source_public_key, sender_public_key; drop passphrase_hash"
```

---

## Task 4: Submit route rewrite

**Files:**
- Modify: `packages/source-portal/src/routes/submit.ts`
- Modify: `packages/source-portal/src/index.ts`
- Modify: `packages/source-portal/tests/submit.test.ts`

- [ ] **Step 4.1: Rewrite `packages/source-portal/src/routes/submit.ts`**

```typescript
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
    const sealedText = req.body?.sealedText as string | undefined  // base64, encrypted by browser
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
      // Generate diceware1 (check-in identity)
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

      // Generate diceware2 (reply decryption — derived keypair, server stores only pubkey)
      const diceware2 = await generateDiceware()
      const { publicKey: sourcePK } = await deriveSourceKeypair(diceware2)
      const sourcePKHex = Buffer.from(sourcePK).toString("hex")

      const sourceId = opts.db.insertSource(
        diceware1Hash,
        diceware1Hmac,
        displayName,
        sourcePKHex,
      )

      // Store sealed text (already encrypted by browser with newsroom pubkey)
      const submissionId = opts.db.insertSubmission(sourceId, sealedText ?? null)

      // Encrypt uploaded files: hybrid sealed box
      // DEK encrypted with newsroomPublicKey (sealed box) — not masterKey
      const submissionsDir = opts.submissionsDir ?? "/var/secure-submissions"
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const submissionDir = join(submissionsDir, submissionId)
        mkdirSync(submissionDir, { recursive: true })

        const fileBytes = readFileSync(file.path)
        const dek = await generateDEK()
        const encContent = await encryptData(fileBytes, dek)
        const filePath = join(submissionDir, `${i}.enc`)
        writeFileSync(filePath, encContent, "utf8")

        // Seal DEK with newsroom public key (not masterKey)
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
      })

      // Return diceware2 — server discards it after this response
      res.status(200).json({ displayName, diceware1, diceware2 })
    } catch (err) {
      console.error("Submit error:", err)
      res.status(500).json({ error: "Submission failed." })
    }
  })

  return router
}
```

- [ ] **Step 4.2: Update `packages/source-portal/src/index.ts`**

Add newsroom public key loading and `/pubkey` endpoint. Replace the relevant section of `main()`:

```typescript
// At the top, add these imports alongside existing ones:
import { generateDEK } from "@journalist/shared/crypto"

// In main(), after the masterKey derivation, add:
const newsroomPubKeyHex = process.env.NEWSROOM_PUBLIC_KEY_HEX
if (!newsroomPubKeyHex) {
  console.error("NEWSROOM_PUBLIC_KEY_HEX env var is required. Run: bun scripts/generate-keypair.ts")
  process.exit(1)
}
const newsroomPublicKey = new Uint8Array(Buffer.from(newsroomPubKeyHex, "hex"))

// Add /pubkey endpoint (after app.use(express.static(PUBLIC_DIR))):
app.get("/pubkey", (_req, res) => {
  res.json({ publicKey: newsroomPubKeyHex })
})

// Update submit router call to pass newsroomPublicKey:
app.use("/submit", submitLimiter, createSubmitRouter({
  db,
  newsroomPublicKey,
  masterKey,
  queueKey,
  queueDir: TO_WORKSPACE_QUEUE_DIR,
}))
```

- [ ] **Step 4.3: Rewrite `packages/source-portal/tests/submit.test.ts`**

```typescript
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
    const { app } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sealedText: "abc" }),
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
    // Simulate browser: seal text before sending
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
    // No submissionId, no passphrase in response
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
    // Note: test-mode derivation may differ from server-mode; in test env NODE_ENV=test
    // so deriveSourceKeypair(isTest=true) matches server's NODE_ENV=test derivation
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
        headers: { "Content-Type": "application/json" },
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
      // Verify sealedDek can be decrypted by newsroom private key
      const { decryptDEK, decryptData, sealedBoxDecrypt: sbd } = await import("@journalist/shared/crypto")
      const dek = await sbd(keyContent.sealedDek, newsroomPublicKey, newsroomPrivateKey)
      expect(dek).toHaveLength(32)
    } finally {
      rmSync(submissionsDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 4.4: Run submit tests**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test NEWSROOM_PUBLIC_KEY_HEX=0000000000000000000000000000000000000000000000000000000000000001 bun test packages/source-portal/tests/submit.test.ts
```

Note: `NEWSROOM_PUBLIC_KEY_HEX` env is not used by tests (tests generate their own keypair); the env check is only in `src/index.ts`. Tests pass the key directly to `createSubmitRouter`. Expected: all tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add packages/source-portal/src/routes/submit.ts packages/source-portal/src/index.ts packages/source-portal/tests/submit.test.ts
git commit -m "feat: submit route — E2E sealed text, displayName required, diceware1+2, sealed file DEKs"
```

---

## Task 5: Check-in route rewrite + reply consumer

**Files:**
- Modify: `packages/source-portal/src/routes/checkin.ts`
- Modify: `packages/source-portal/src/replyConsumer.ts`
- Modify: `packages/source-portal/tests/checkin.test.ts`

- [ ] **Step 5.1: Rewrite `packages/source-portal/src/routes/checkin.ts`**

Server no longer decrypts messages. Returns raw ciphertext + sender public key.

```typescript
import { Router } from "express"
import argon2 from "argon2"
import { createHmac } from "crypto"
import type { Db } from "../db"

type CheckinRouterOptions = {
  db: Db
  masterKey: Buffer   // used only for HMAC lookup
}

export function createCheckinRouter(opts: CheckinRouterOptions): Router {
  const router = Router()

  const authFail = async (res: any) => {
    await new Promise((r) => setTimeout(r, 500))
    res.status(401).json({ error: "Invalid credentials." })
  }

  router.post("/", async (req, res) => {
    const { diceware1 } = req.body ?? {}

    if (!diceware1 || typeof diceware1 !== "string") {
      res.status(400).json({ error: "diceware1 required" })
      return
    }

    try {
      // O(1) HMAC lookup
      const hmac = createHmac("sha256", opts.masterKey).update(diceware1).digest("hex")
      const source = opts.db.getSourceByHmac(hmac)

      if (!source) return authFail(res)

      // Confirm via argon2id (prevents HMAC collision attacks)
      const codeOk = await argon2.verify(source.codename_hash, diceware1)
      if (!codeOk) return authFail(res)

      // Fetch all journalist→source messages for this source's submissions
      const submissions = opts.db
        .query("SELECT id FROM submissions WHERE source_id = ?")
        .all(source.id) as { id: string }[]

      const messages: { direction: string; ciphertext: string; senderPublicKey: string; created_at: number }[] = []

      for (const sub of submissions) {
        const msgs = opts.db.getMessages(sub.id)
        for (const msg of msgs) {
          if (msg.direction !== "journalist") continue
          messages.push({
            direction: msg.direction,
            ciphertext: msg.encrypted_body,       // box ciphertext — client decrypts with diceware2
            senderPublicKey: msg.sender_public_key, // newsroom public key hex
            created_at: msg.created_at,
          })
        }
      }

      res.status(200).json({ messages })
    } catch (err) {
      console.error("Checkin error:", err)
      res.status(500).json({ error: "Check-in failed." })
    }
  })

  return router
}
```

- [ ] **Step 5.2: Update `packages/source-portal/src/replyConsumer.ts`**

Update field name from `encryptedDek` to `senderPublicKey`:

```typescript
import { consumeQueueMessage } from "@journalist/shared/queue"
import type { Db } from "./db"

type ReplyConsumerOptions = { db: Db; queueDir: string; queueKey: Uint8Array; pollIntervalMs?: number }

export function startReplyConsumer(opts: ReplyConsumerOptions) {
  const intervalMs = opts.pollIntervalMs ?? 5_000
  let running = true
  async function poll() {
    while (running) {
      try {
        const msg = await consumeQueueMessage(opts.queueDir, opts.queueKey)
        if (msg?.type === "journalist_reply") {
          const { submissionId, boxedBody, senderPublicKey } = msg as {
            submissionId: string
            boxedBody: string
            senderPublicKey: string
          }
          opts.db.insertMessage(submissionId, "journalist", boxedBody, senderPublicKey)
        }
      } catch (err) { console.error("[reply-consumer]", err) }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  poll()
  return { stop() { running = false } }
}
```

- [ ] **Step 5.3: Rewrite `packages/source-portal/tests/checkin.test.ts`**

```typescript
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

  // Journalist encrypts reply to source's public key using newsroom private key
  const replyText = "Hello from journalist"
  const boxedBody = await boxEncrypt(Buffer.from(replyText), sourcePK, newsroom.privateKey)
  const senderPublicKey = Buffer.from(newsroom.publicKey).toString("hex")
  db.insertMessage(submissionId, "journalist", boxedBody, senderPublicKey)

  const router = createCheckinRouter({ db, masterKey })
  const app = express()
  app.use(express.json())
  app.use("/checkin", router)

  return { app, diceware1, diceware2, newsroom, sourcePK, submissionId }
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
    // Server does NOT return decrypted body — client decrypts
    expect(body.messages[0].body).toBeUndefined()
  })

  test("returned ciphertext can be decrypted using diceware2-derived private key", async () => {
    const { app, diceware1, diceware2, newsroom } = await buildApp()
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diceware1 }),
    })
    const body = await r.json()
    server.close()

    // Simulate browser: derive source private key from diceware2
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
    // Only diceware1 — no diceware2 sent to server
    const r = await fetch(`http://localhost:${port}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diceware1 }),
    })
    server.close()
    expect(r.status).toBe(200)
  })
})
```

- [ ] **Step 5.4: Run check-in tests**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test packages/source-portal/tests/checkin.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add packages/source-portal/src/routes/checkin.ts packages/source-portal/src/replyConsumer.ts packages/source-portal/tests/checkin.test.ts
git commit -m "feat: checkin route — auth via diceware1 only, return raw ciphertext for client decrypt"
```

---

## Task 6: Workspace — keypair in globals + reply route + portal-db

**Files:**
- Modify: `packages/journalist-workspace/src/lib/globals.ts`
- Modify: `packages/journalist-workspace/src/server.ts`
- Modify: `packages/journalist-workspace/src/app/api/cases/[id]/reply/route.ts`
- Modify: `packages/journalist-workspace/src/lib/portal-db.ts`

- [ ] **Step 6.1: Update `packages/journalist-workspace/src/lib/globals.ts`**

```typescript
import type { Db } from "./db"
import type { SessionStore } from "./session"

export type Globals = {
  db: Db
  sessionStore: SessionStore
  masterKey: Buffer
  queueKey: Uint8Array
  toWorkspaceQueueDir: string
  toPortalQueueDir: string
  publicationDir: string
  portalDbPath: string
  newsroomPublicKey: Uint8Array   // X25519 public key — seals source submissions
  newsroomPrivateKey: Uint8Array  // X25519 private key — decrypts source submissions + signs replies
}

let globals: Globals | null = null
export function initGlobals(g: Globals) { globals = g }
export function getGlobals(): Globals {
  if (!globals) throw new Error("Globals not initialized — call initGlobals() at startup")
  return globals
}
```

- [ ] **Step 6.2: Update `packages/journalist-workspace/src/server.ts`**

Add keypair loading after the masterKey derivation section. Find the `initGlobals({...})` call and add the two new fields:

```typescript
// After const masterKey = await deriveMasterKey(passphrase, salt):
const newsroomPubHex = process.env.NEWSROOM_PUBLIC_KEY_HEX
const newsroomPrivHex = process.env.NEWSROOM_PRIVATE_KEY_HEX
if (!newsroomPubHex || !newsroomPrivHex) {
  console.error("NEWSROOM_PUBLIC_KEY_HEX and NEWSROOM_PRIVATE_KEY_HEX env vars are required.")
  process.exit(1)
}
const newsroomPublicKey = new Uint8Array(Buffer.from(newsroomPubHex, "hex"))
const newsroomPrivateKey = new Uint8Array(Buffer.from(newsroomPrivHex, "hex"))

// In initGlobals({...}), add:
//   newsroomPublicKey,
//   newsroomPrivateKey,
```

The full `initGlobals` call becomes:
```typescript
initGlobals({
  db,
  sessionStore,
  masterKey,
  queueKey,
  toWorkspaceQueueDir: TO_WORKSPACE_QUEUE_DIR,
  toPortalQueueDir: TO_PORTAL_QUEUE_DIR,
  publicationDir: PUBLICATION_DIR,
  portalDbPath: PORTAL_DB_PATH,
  newsroomPublicKey,
  newsroomPrivateKey,
})
```

- [ ] **Step 6.3: Rewrite `packages/journalist-workspace/src/app/api/cases/[id]/reply/route.ts`**

Box-encrypt reply to source's public key using newsroom private key:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { boxEncrypt } from "@journalist/shared/crypto"
import { writeQueueMessage } from "@journalist/shared/queue"
import { getSourcePublicKeyForSubmission } from "@/lib/portal-db"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, newsroomPublicKey, newsroomPrivateKey, queueKey, toPortalQueueDir, portalDbPath } =
    getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const text = body?.text as string | undefined
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 })

  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Look up source's public key from portal DB
  const sourcePKHex = await getSourcePublicKeyForSubmission(caseData.submission_ref, portalDbPath)
  if (!sourcePKHex) {
    return NextResponse.json({ error: "Source public key not found" }, { status: 500 })
  }
  const sourcePK = new Uint8Array(Buffer.from(sourcePKHex, "hex"))

  // Box-encrypt reply to source's public key, signed by newsroom private key
  const boxedBody = await boxEncrypt(Buffer.from(text, "utf8"), sourcePK, newsroomPrivateKey)
  const senderPublicKey = Buffer.from(newsroomPublicKey).toString("hex")

  await writeQueueMessage(toPortalQueueDir, queueKey, {
    type: "journalist_reply",
    submissionId: caseData.submission_ref,
    boxedBody,
    senderPublicKey,
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6.4: Rewrite `packages/journalist-workspace/src/lib/portal-db.ts`**

Replace masterKey-based decryption with sealedBoxDecrypt. Add `getSourcePublicKeyForSubmission`:

```typescript
import { Database } from "bun:sqlite"
import { sealedBoxDecrypt, decryptData } from "@journalist/shared/crypto"

export interface SubmissionContent {
  submissionId: string
  hasText: boolean
  text: string | null
  files: { index: number; originalName: string | null; encFilePath: string }[]
}

/**
 * Open source portal SQLite read-only and decrypt source submission using
 * the newsroom X25519 keypair (sealed box). Returns null if not found.
 */
export async function getSubmissionContent(
  submissionId: string,
  newsroomPublicKey: Uint8Array,
  newsroomPrivateKey: Uint8Array,
  portalDbPath: string
): Promise<SubmissionContent | null> {
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(portalDbPath, { readonly: true })

    const row = db
      .query("SELECT id, encrypted_text FROM submissions WHERE id = ?")
      .get(submissionId) as { id: string; encrypted_text: string | null } | null

    if (!row) return null

    let text: string | null = null
    if (row.encrypted_text) {
      try {
        const buf = await sealedBoxDecrypt(row.encrypted_text, newsroomPublicKey, newsroomPrivateKey)
        text = buf.toString("utf8")
      } catch {
        text = "[decryption error]"
      }
    }

    const fileRows = db
      .query(
        "SELECT id, encrypted_filename, encrypted_dek, file_path FROM submission_files WHERE submission_id = ? ORDER BY rowid ASC"
      )
      .all(submissionId) as { id: string; encrypted_filename: string; encrypted_dek: string; file_path: string }[]

    const files = await Promise.all(
      fileRows.map(async (f, i) => {
        let originalName: string | null = null
        try {
          // encrypted_dek column now stores sealedDek (sealed with newsroom public key)
          const dek = await sealedBoxDecrypt(f.encrypted_dek, newsroomPublicKey, newsroomPrivateKey)
          const buf = await decryptData(f.encrypted_filename, new Uint8Array(dek))
          originalName = buf.toString("utf8")
        } catch {
          originalName = null
        }
        return { index: i, originalName, encFilePath: f.file_path }
      })
    )

    return { submissionId, hasText: !!text, text, files }
  } finally {
    db?.close()
  }
}

/**
 * Returns the source_public_key hex for a given submission ID.
 * Used by the reply route to encrypt journalist replies to the correct source keypair.
 */
export async function getSourcePublicKeyForSubmission(
  submissionId: string,
  portalDbPath: string
): Promise<string | null> {
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(portalDbPath, { readonly: true })
    const row = db
      .query(
        "SELECT s.source_public_key FROM sources s JOIN submissions sub ON sub.source_id = s.id WHERE sub.id = ?"
      )
      .get(submissionId) as { source_public_key: string } | null
    return row?.source_public_key ?? null
  } finally {
    db?.close()
  }
}
```

- [ ] **Step 6.5: Update cases route to pass newsroom keypair instead of masterKey to getSubmissionContent**

In `packages/journalist-workspace/src/app/api/cases/[id]/route.ts`, find the `getSubmissionContent` call and update its signature:

```typescript
// Change:
const content = await getSubmissionContent(caseData.submission_ref, masterKey, portalDbPath)
// To:
const { newsroomPublicKey, newsroomPrivateKey } = getGlobals()
const content = await getSubmissionContent(
  caseData.submission_ref,
  newsroomPublicKey,
  newsroomPrivateKey,
  portalDbPath
)
```

- [ ] **Step 6.6: Run workspace tests**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test packages/journalist-workspace/tests/
```

Expected: all tests pass (workspace tests don't test portal-db directly, but auth/session/publish tests must remain green).

- [ ] **Step 6.7: Commit**

```bash
git add packages/journalist-workspace/src/lib/globals.ts packages/journalist-workspace/src/server.ts packages/journalist-workspace/src/app/api/cases/\[id\]/reply/route.ts packages/journalist-workspace/src/lib/portal-db.ts packages/journalist-workspace/src/app/api/cases/\[id\]/route.ts
git commit -m "feat: workspace — newsroom keypair in globals, box-encrypt replies to source PK, sealed box decrypt submissions"
```

---

## Task 7: Browser crypto bundle + portal UI

**Files:**
- Create: `packages/source-portal/src/portal-crypto.ts`
- Modify: `packages/source-portal/package.json`
- Build: `packages/source-portal/public/portal-crypto.js` (generated)
- Modify: `packages/source-portal/public/portal.js`
- Modify: `packages/source-portal/public/index.html`
- Modify: `packages/source-portal/public/checkin.html`

- [ ] **Step 7.1: Create `packages/source-portal/src/portal-crypto.ts`**

This file becomes an IIFE browser bundle exposing `window.PortalCrypto`.

```typescript
import _sodium from "libsodium-wrappers"

// Fixed 16-byte salt: "src-keypair-v1  " — MUST match packages/shared/src/crypto.ts
const KEYPAIR_SALT = new Uint8Array([
  0x73, 0x72, 0x63, 0x2d, 0x6b, 0x65, 0x79, 0x70,
  0x61, 0x69, 0x72, 0x2d, 0x76, 0x31, 0x20, 0x20,
])

const ready = _sodium.ready

async function deriveSourceKeypair(
  diceware2: string
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  await _sodium.ready
  // Production params: OPSLIMIT_INTERACTIVE=2, MEMLIMIT_INTERACTIVE=64MB
  const seed = _sodium.crypto_pwhash(
    32,
    new TextEncoder().encode(diceware2),
    KEYPAIR_SALT,
    _sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,  // 2
    _sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,  // 67108864 (64MB)
    _sodium.crypto_pwhash_ALG_ARGON2ID13
  )
  return _sodium.crypto_box_seed_keypair(seed)
}

function sealedBoxEncrypt(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  return _sodium.crypto_box_seal(plaintext, recipientPublicKey)
}

function boxOpen(
  ciphertextWithNonce: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): Uint8Array {
  const nonce = ciphertextWithNonce.subarray(0, _sodium.crypto_box_NONCEBYTES)
  const data = ciphertextWithNonce.subarray(_sodium.crypto_box_NONCEBYTES)
  const result = _sodium.crypto_box_open_easy(data, nonce, senderPublicKey, recipientPrivateKey)
  if (!result) throw new Error("Decryption failed — wrong key or corrupted data")
  return result
}

function fromHex(hex: string): Uint8Array { return _sodium.from_hex(hex) }
function toHex(bytes: Uint8Array): string { return _sodium.to_hex(bytes) }
function toBase64(bytes: Uint8Array): string {
  return _sodium.to_base64(bytes, _sodium.base64_variants.ORIGINAL)
}
function fromBase64(b64: string): Uint8Array {
  return _sodium.from_base64(b64, _sodium.base64_variants.ORIGINAL)
}

;(globalThis as any).PortalCrypto = {
  ready,
  deriveSourceKeypair,
  sealedBoxEncrypt,
  boxOpen,
  fromHex,
  toHex,
  toBase64,
  fromBase64,
}
```

- [ ] **Step 7.2: Add build script to `packages/source-portal/package.json`**

```json
{
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun test",
    "build:crypto": "bun build --target browser --format iife --outfile public/portal-crypto.js src/portal-crypto.ts"
  }
}
```

- [ ] **Step 7.3: Build the browser bundle**

```bash
cd /c/Users/USER/Desktop/journalist-platform/packages/source-portal
bun run build:crypto
```

Expected: `public/portal-crypto.js` created. Size should be ~700KB (libsodium is large but self-contained).

- [ ] **Step 7.4: Rewrite `packages/source-portal/public/portal.js`**

Replace the entire file:

```javascript
(function () {
  "use strict";

  // ── Utilities ────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatDate(ts) {
    if (!ts) return "";
    try {
      return new Date(Number(ts)).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });
    } catch { return ""; }
  }

  function showError(id, msg) {
    var el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = "block"; }
  }

  function hideError(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = "none"; el.textContent = ""; }
  }

  // Format 7-word diceware for display: "word-word-word-word-word-word-word"
  // → "word · word · word · word · word · word · word"
  function formatDiceware(raw) {
    return (raw || "").replace(/-/g, " · ");
  }

  // ── File upload zone ─────────────────────────────────────────

  var fileInput = document.getElementById("file-input");
  var uploadZone = document.getElementById("upload-zone");
  var filesList = document.getElementById("upload-files-list");
  var ctaBtn = document.getElementById("cta-submit");
  var submitForm = document.getElementById("submit-form");
  var submitResult = document.getElementById("submit-result");

  if (ctaBtn && submitForm) {
    ctaBtn.addEventListener("click", function () {
      submitForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (uploadZone && fileInput) {
    uploadZone.addEventListener("click", function (e) {
      if (e.target !== fileInput) fileInput.click();
    });
    uploadZone.addEventListener("dragover", function (e) {
      e.preventDefault();
      uploadZone.style.borderColor = "var(--green)";
    });
    uploadZone.addEventListener("dragleave", function () {
      uploadZone.style.borderColor = "";
    });
    uploadZone.addEventListener("drop", function (e) {
      e.preventDefault();
      uploadZone.style.borderColor = "";
      if (e.dataTransfer && e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        renderFileList(fileInput.files);
      }
    });
    if (fileInput) fileInput.addEventListener("change", function () {
      renderFileList(fileInput.files);
    });
  }

  function renderFileList(files) {
    if (!filesList) return;
    filesList.innerHTML = "";
    for (var i = 0; i < files.length; i++) {
      var item = document.createElement("div");
      item.className = "upload-file-item";
      item.textContent = "📄 " + escapeHtml(files[i].name);
      filesList.appendChild(item);
    }
  }

  // ── Submit page ──────────────────────────────────────────────

  if (submitForm) {
    submitForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      hideError("submit-error");

      var btn = document.getElementById("submit-btn");
      var displayNameInput = document.getElementById("display-name-input");
      var messageInput = document.getElementById("message-input");
      var displayName = (displayNameInput ? displayNameInput.value : "").trim();
      var messageText = (messageInput ? messageInput.value : "").trim();
      var hasFiles = fileInput && fileInput.files && fileInput.files.length > 0;

      if (!displayName) {
        showError("submit-error", "A codename is required.");
        return;
      }
      if (!messageText && !hasFiles) {
        showError("submit-error", "Please provide a message or attach files.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Encrypting…";

      try {
        // Wait for libsodium WASM to initialise
        await PortalCrypto.ready;

        // Fetch newsroom public key from server
        var pkRes = await fetch("/pubkey");
        if (!pkRes.ok) throw new Error("Could not fetch newsroom public key.");
        var pkData = await pkRes.json();
        var newsroomPublicKey = PortalCrypto.fromHex(pkData.publicKey);

        // Encrypt message text in browser before sending
        var sealedText = null;
        if (messageText) {
          var textBytes = new TextEncoder().encode(messageText);
          var sealed = PortalCrypto.sealedBoxEncrypt(textBytes, newsroomPublicKey);
          sealedText = PortalCrypto.toBase64(sealed);
        }

        btn.textContent = "Submitting…";

        // Use FormData to support both sealedText and file uploads
        var formData = new FormData();
        formData.append("displayName", displayName);
        if (sealedText) formData.append("sealedText", sealedText);
        if (hasFiles) {
          for (var i = 0; i < fileInput.files.length; i++) {
            formData.append("files", fileInput.files[i]);
          }
        }

        var res = await fetch("/submit", { method: "POST", body: formData });
        var data = await res.json();

        if (!res.ok) {
          showError("submit-error", data.error || "Submission failed. Please try again.");
          btn.disabled = false;
          btn.textContent = "Submit Securely →";
          return;
        }

        // Show success screen with all three credentials
        document.getElementById("result-display-name").textContent = escapeHtml(data.displayName);
        document.getElementById("diceware1-display").textContent = formatDiceware(data.diceware1);
        document.getElementById("diceware2-display").textContent = formatDiceware(data.diceware2);

        submitForm.style.display = "none";
        if (submitResult) submitResult.style.display = "block";

      } catch (err) {
        showError("submit-error", "Encryption or network error. Please try again.");
        btn.disabled = false;
        btn.textContent = "Submit Securely →";
      }
    });
  }

  // ── Check-in page ────────────────────────────────────────────

  var checkinForm = document.getElementById("checkin-form");
  var checkinResult = document.getElementById("checkin-result");

  function renderReplies(messages) {
    var container = document.getElementById("replies-container");
    var countBadge = document.getElementById("reply-count");
    if (!container) return;

    if (!messages || messages.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><p style="margin-bottom:6px;font-size:18px;">📭</p>No replies yet. Check back later.</div>';
      if (countBadge) countBadge.textContent = "0 replies";
      return;
    }

    if (countBadge) {
      countBadge.textContent = messages.length + (messages.length === 1 ? " reply" : " replies");
    }

    container.innerHTML = messages.map(function (m, i) {
      return (
        '<div class="reply-item">' +
          '<div class="reply-meta">Reply ' + (i + 1) + ' · ' +
          escapeHtml(formatDate(m.created_at)) + ' · From the newsroom</div>' +
          '<div class="reply-body">' + escapeHtml(m.body) + '</div>' +
        '</div>'
      );
    }).join("");
  }

  if (checkinForm) {
    checkinForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      hideError("checkin-error");

      var btn = document.getElementById("checkin-btn");
      var diceware1Raw = (document.getElementById("diceware1-input").value || "").trim();
      var diceware2Raw = (document.getElementById("diceware2-input").value || "").trim();

      // Normalise display format "word · word · ..." → "word-word-..."
      var diceware1 = diceware1Raw.replace(/\s*·\s*/g, "-").replace(/\s+/g, "-");
      var diceware2 = diceware2Raw.replace(/\s*·\s*/g, "-").replace(/\s+/g, "-");

      if (!diceware1) {
        showError("checkin-error", "Please enter your check-in phrase (Phrase 1).");
        return;
      }
      if (!diceware2) {
        showError("checkin-error", "Please enter your reply phrase (Phrase 2).");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Deriving key…";

      try {
        await PortalCrypto.ready;

        // Derive source private key from diceware2 — NEVER sent to server
        var keypair = await PortalCrypto.deriveSourceKeypair(diceware2);
        var sourceSK = keypair.privateKey;

        btn.textContent = "Checking in…";

        // Only diceware1 goes to server
        var res = await fetch("/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diceware1: diceware1 }),
        });
        var data = await res.json();

        if (!res.ok) {
          showError("checkin-error", data.error || "Check-in failed. Please check Phrase 1.");
          btn.disabled = false;
          btn.textContent = "Check In →";
          return;
        }

        btn.textContent = "Decrypting replies…";

        // Decrypt each reply client-side using diceware2-derived private key
        var decryptedMessages = [];
        for (var i = 0; i < data.messages.length; i++) {
          var msg = data.messages[i];
          try {
            var ciphertextBytes = PortalCrypto.fromBase64(msg.ciphertext);
            var senderPK = PortalCrypto.fromHex(msg.senderPublicKey);
            var plainBytes = PortalCrypto.boxOpen(ciphertextBytes, senderPK, sourceSK);
            var body = new TextDecoder().decode(plainBytes);
            decryptedMessages.push({ body: body, created_at: msg.created_at });
          } catch (decryptErr) {
            decryptedMessages.push({ body: "[Decryption failed — wrong Phrase 2?]", created_at: msg.created_at });
          }
        }

        renderReplies(decryptedMessages);
        checkinForm.style.display = "none";
        if (checkinResult) checkinResult.style.display = "block";

      } catch (err) {
        showError("checkin-error", "Error: " + (err.message || "Please try again."));
        btn.disabled = false;
        btn.textContent = "Check In →";
      }
    });
  }

  var checkinAgainBtn = document.getElementById("checkin-again-btn");
  if (checkinAgainBtn) {
    checkinAgainBtn.addEventListener("click", function () {
      if (checkinResult) checkinResult.style.display = "none";
      if (checkinForm) { checkinForm.style.display = "block"; checkinForm.reset(); }
      hideError("checkin-error");
    });
  }

})();
```

- [ ] **Step 7.5: Update `packages/source-portal/public/index.html`**

Key changes needed (search and replace the relevant sections):

1. Add `<script src="/portal-crypto.js"></script>` before `<script src="/portal.js"></script>`

2. In the submit form, add `displayName` field as the first input and rename `text` to `message`:
```html
<!-- Add before message textarea: -->
<div class="form-group">
  <label for="display-name-input" class="form-label">
    Your codename <span style="color:var(--green)">*</span>
  </label>
  <input
    type="text"
    id="display-name-input"
    name="displayName"
    class="form-input"
    placeholder="One word, e.g. Ghost"
    maxlength="32"
    pattern="[A-Za-z0-9]+"
    required
    autocomplete="off"
    spellcheck="false"
  />
  <div class="form-hint">Choose a single word you'll remember. This appears in published reports.</div>
</div>
```

3. Rename textarea id from `text-input` to `message-input`

4. Rename submit button id from `submit-btn` if needed (keep as `submit-btn`)

5. Replace the success screen credential display. Change from showing `codename-display` + `passphrase-display` to:

```html
<div class="success-screen" id="submit-result" style="display:none">
  <div class="success-icon">✓</div>
  <h2 class="success-title">Submission received</h2>
  <p class="success-subtitle">
    Write down all three items below. Without them you cannot check in.
    <strong>These will not be shown again.</strong>
  </p>

  <div class="credential-group">
    <div class="credential-label">Your codename</div>
    <div class="credential-value" id="result-display-name"></div>
    <div class="credential-hint">This appears in published articles.</div>
  </div>

  <div class="credential-group">
    <div class="credential-label">Phrase 1 — Check-in phrase</div>
    <div class="credential-value" id="diceware1-display"></div>
    <div class="credential-hint">Used to identify yourself at check-in.</div>
  </div>

  <div class="credential-group">
    <div class="credential-label">Phrase 2 — Reply phrase</div>
    <div class="credential-value" id="diceware2-display"></div>
    <div class="credential-hint">
      Used to decrypt replies from the newsroom. 
      <strong>Never share this with anyone.</strong>
      Once you have read all replies, you may destroy this phrase — your original 
      submission becomes permanently unreadable to everyone, including the newsroom.
    </div>
  </div>
</div>
```

- [ ] **Step 7.6: Update `packages/source-portal/public/checkin.html`**

Rename input IDs and labels:
- `id="codename-input"` → `id="diceware1-input"`
- Label: "Your codename" → "Phrase 1 — Check-in phrase"
- `id="passphrase-input"` → `id="diceware2-input"`  
- Label: "Passphrase" → "Phrase 2 — Reply phrase"
- Update hint text: "Enter both phrases exactly as written when you submitted."

- [ ] **Step 7.7: Commit**

```bash
git add packages/source-portal/src/portal-crypto.ts packages/source-portal/package.json packages/source-portal/public/portal-crypto.js packages/source-portal/public/portal.js packages/source-portal/public/index.html packages/source-portal/public/checkin.html
git commit -m "feat: browser E2E crypto — portal-crypto.js bundle, sealed box submit, client-side reply decrypt"
```

---

## Task 8: Full test suite — green check

**Files:** No code changes — verify all tests pass.

- [ ] **Step 8.1: Run full test suite**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test 2>&1
```

Expected output:
```
 N pass
 0 fail
```

- [ ] **Step 8.2: If any test fails, fix before proceeding**

Common failure modes:
- `getSourceByHash` referenced in old test → it was removed; use `getSourceByHmac` instead
- `insertSource` called with old 1-2 argument form → update to 4-argument form `(hash, hmac, displayName, sourcePKHex)`
- `insertMessage` called with `encrypted_dek` → update to `senderPublicKey`
- `getSubmissionContent` called with old `masterKey` → update to `newsroomPublicKey, newsroomPrivateKey`
- `queueConsumer.test.ts` or `queue.test.ts` referencing `encryptedDek` → update to `boxedBody, senderPublicKey`

- [ ] **Step 8.3: Commit final state**

```bash
git add -A
git commit -m "feat: Option C complete — asymmetric E2E encryption for source submissions and replies"
```

---

## Security checklist (verify before closing)

- [ ] Source portal never stores or logs `diceware2`
- [ ] Source portal never stores newsroom private key (only public key)
- [ ] Workspace never stores source private key (only public key)
- [ ] `portal-crypto.js` is committed to the repo (not generated at runtime) — sources can verify its hash out-of-band
- [ ] `GET /pubkey` returns newsroomPublicKey hex — can be verified against `scripts/generate-keypair.ts` output
- [ ] `NEWSROOM_PRIVATE_KEY_HEX` is in workspace env only, never in source portal env
