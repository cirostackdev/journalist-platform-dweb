# Video Upload & Publishing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add end-to-end video support — sources submit encrypted video evidence (≤2 GB), journalists upload their own footage, editors/admins publish HLS video reports to the publication site.

**Architecture:** Encrypt-at-upload, transcode-at-publish. Source portal stream-encrypts via libsodium `crypto_secretstream_xchacha20poly1305` (magic-header format for large files, single-shot for small). Workspace transcodes to HLS (1080p/720p/480p) with ffmpeg only at publish time. Publication site gets standalone video report pages with hls.js (bundled locally, no CDN).

**Tech Stack:** libsodium-wrappers-sumo (secretstream), ffmpeg (system), hls.js@1.6.16 (already installed at `node_modules/.bun/hls.js@1.6.16`), bun:test, Express, Next.js, Postgres

---

## Constants & shared values (copy exactly into each task)

```typescript
// Magic header that marks secretstream-encrypted files (4 bytes)
const SECRET_STREAM_MAGIC = Buffer.from([0x00, 0x53, 0x45, 0x43]) // "\x00SEC"

// Chunk size for secretstream encryption (4 MB plaintext per chunk)
const CHUNK_SIZE = 4 * 1024 * 1024

// Files >= this size use secretstream; smaller files use single-shot encryptData
const STREAM_THRESHOLD = 64 * 1024 * 1024 // 64 MB
```

---

## File Map

| File | Action |
|---|---|
| `packages/shared/src/crypto.ts` | Add `encryptStreamToFile`, `decryptStreamToWritable`, `isSecretStream` |
| `packages/source-portal/src/stripMetadata.ts` | Add video path (ffmpeg metadata strip) |
| `packages/source-portal/src/routes/submit.ts` | 2 GB limit; secretstream for large files |
| `packages/journalist-workspace/src/lib/db.ts` | `videos` table + CRUD |
| `packages/journalist-workspace/src/app/api/videos/route.ts` | New — list + create |
| `packages/journalist-workspace/src/app/api/videos/upload/route.ts` | New — journalist file upload |
| `packages/journalist-workspace/src/app/api/videos/[id]/route.ts` | New — get/put/delete |
| `packages/journalist-workspace/src/app/api/videos/[id]/stream/route.ts` | New — decrypt + stream |
| `packages/journalist-workspace/src/app/api/videos/[id]/publish/route.ts` | New — trigger transcode |
| `packages/journalist-workspace/src/app/api/videos/[id]/retract/route.ts` | New — remove from publication |
| `packages/journalist-workspace/src/app/api/cases/[id]/files/[index]/stream/route.ts` | New — stream case file |
| `packages/journalist-workspace/src/lib/transcode.ts` | New — ffmpeg HLS pipeline |
| `packages/journalist-workspace/src/lib/publish.ts` | Add `publishVideoReport`, `updateVideoIndex`; update `updateIndex` nav |
| `packages/journalist-workspace/src/app/videos/page.tsx` | New — video library UI |
| `packages/journalist-workspace/src/lib/globals.ts` | No change needed (newsroomPublicKey/PrivateKey already there) |
| `publication/hls.min.js` | New — copy from node_modules, committed static asset |

---

## Task 1: Streaming crypto helpers

**Files:**
- Modify: `packages/shared/src/crypto.ts`
- Modify: `packages/source-portal/tests/crypto.test.ts`

**Context:** libsodium-wrappers-sumo is already imported in `packages/shared/src/crypto.ts` as `sodiumSumo`. The secretstream API:
- `sodiumSumo.crypto_secretstream_xchacha20poly1305_KEYBYTES` = 32
- `sodiumSumo.crypto_secretstream_xchacha20poly1305_HEADERBYTES` = 24
- `sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE` = 0
- `sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_FINAL` = 3
- `init_push(key)` → `{ state, header }`
- `push(state, chunk, null, tag)` → ciphertext chunk
- `init_pull(header, key)` → state
- `pull(state, ctChunk, null)` → `{ message, tag }` (throws if auth fails)

Read the current end of `packages/shared/src/crypto.ts` first to see the last existing function, then append.

- [ ] **Step 1.1: Append streaming crypto functions to `packages/shared/src/crypto.ts`**

Add these imports at the top of the file (alongside existing ones):
```typescript
import { createReadStream, createWriteStream, openSync, readSync, closeSync, writeSync } from "fs"
import type { Writable } from "stream"
```

Then append after the last existing function (`boxDecrypt`):

```typescript
// ── Secretstream (large file streaming encryption) ────────────────────────────

const SECRET_STREAM_MAGIC = Buffer.from([0x00, 0x53, 0x45, 0x43]) // "\x00SEC"
const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB plaintext chunks

/**
 * Returns true if the file at `filePath` was encrypted with encryptStreamToFile.
 * Reads only the first 4 bytes (the magic header).
 */
export function isSecretStream(filePath: string): boolean {
  try {
    const fd = openSync(filePath, "r")
    const buf = Buffer.alloc(4)
    readSync(fd, buf, 0, 4, 0)
    closeSync(fd)
    return buf.equals(SECRET_STREAM_MAGIC)
  } catch {
    return false
  }
}

/**
 * Stream-encrypt a file using libsodium crypto_secretstream_xchacha20poly1305.
 * Output format: [4-byte magic][24-byte header][encrypted chunks...]
 * Each plaintext chunk is CHUNK_SIZE bytes (last chunk may be smaller).
 */
export async function encryptStreamToFile(
  sourcePath: string,
  destPath: string,
  key: Uint8Array
): Promise<void> {
  await sodiumSumo.ready
  const { state, header } = sodiumSumo.crypto_secretstream_xchacha20poly1305_init_push(key)
  const out = createWriteStream(destPath)

  await new Promise<void>((resolve, reject) => {
    out.on("error", reject)

    // Write magic + header first
    out.write(SECRET_STREAM_MAGIC)
    out.write(Buffer.from(header))

    const inStream = createReadStream(sourcePath, { highWaterMark: CHUNK_SIZE })
    const chunks: Buffer[] = []
    let totalRead = 0

    inStream.on("error", reject)
    inStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
      totalRead += chunk.length
    })
    inStream.on("end", () => {
      try {
        // Encrypt all chunks; last chunk gets TAG_FINAL
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1
          const tag = isLast
            ? sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_FINAL
            : sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
          const ct = sodiumSumo.crypto_secretstream_xchacha20poly1305_push(
            state, chunks[i], null, tag
          )
          // Write 4-byte length prefix + ciphertext
          const lenBuf = Buffer.alloc(4)
          lenBuf.writeUInt32BE(ct.length, 0)
          out.write(lenBuf)
          out.write(Buffer.from(ct))
        }
        out.end()
      } catch (err) {
        reject(err)
      }
    })
  })
}

/**
 * Stream-decrypt a file created by encryptStreamToFile, writing plaintext to `dest`.
 * Throws if the magic header is missing or any chunk fails authentication.
 */
export async function decryptStreamToWritable(
  sourcePath: string,
  dest: Writable,
  key: Uint8Array
): Promise<void> {
  await sodiumSumo.ready

  const fd = openSync(sourcePath, "r")
  try {
    // Read and verify magic (4 bytes)
    const magic = Buffer.alloc(4)
    readSync(fd, magic, 0, 4, 0)
    if (!magic.equals(SECRET_STREAM_MAGIC)) {
      throw new Error("decryptStreamToWritable: not a secretstream file")
    }

    // Read header (24 bytes)
    const header = Buffer.alloc(sodiumSumo.crypto_secretstream_xchacha20poly1305_HEADERBYTES)
    readSync(fd, header, 0, header.length, 4)
    const state = sodiumSumo.crypto_secretstream_xchacha20poly1305_init_pull(header, key)

    let offset = 4 + header.length

    await new Promise<void>((resolve, reject) => {
      dest.on("error", reject)

      function readNextChunk() {
        try {
          // Read 4-byte length prefix
          const lenBuf = Buffer.alloc(4)
          const bytesRead = readSync(fd, lenBuf, 0, 4, offset)
          if (bytesRead === 0) { dest.end(); resolve(); return }
          offset += 4
          const ctLen = lenBuf.readUInt32BE(0)

          // Read ciphertext chunk
          const ct = Buffer.alloc(ctLen)
          readSync(fd, ct, 0, ctLen, offset)
          offset += ctLen

          const result = sodiumSumo.crypto_secretstream_xchacha20poly1305_pull(state, ct, null)
          if (!result) throw new Error("decryptStreamToWritable: authentication failed")
          const { message, tag } = result

          if (message.length > 0) {
            dest.write(Buffer.from(message), (err) => {
              if (err) { reject(err); return }
              if (tag === sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
                dest.end(); resolve()
              } else {
                readNextChunk()
              }
            })
          } else {
            if (tag === sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
              dest.end(); resolve()
            } else {
              readNextChunk()
            }
          }
        } catch (err) {
          reject(err)
        }
      }

      readNextChunk()
    })
  } finally {
    closeSync(fd)
  }
}
```

- [ ] **Step 1.2: Add tests to `packages/source-portal/tests/crypto.test.ts`**

Append after the last `boxDecrypt` describe block. Import `mkdtempSync`, `writeFileSync`, `readFileSync`, `rmSync` from `"fs"` and `tmpdir` from `"os"` at the top.

Also import:
```typescript
import {
  // existing imports ...
  encryptStreamToFile,
  decryptStreamToWritable,
  isSecretStream,
} from "@journalist/shared/crypto"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { PassThrough } from "stream"
```

Tests to append:

```typescript
describe("isSecretStream", () => {
  test("returns true for secretstream files", async () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const { publicKey } = await generateNewsroomKeypair()
      const key = publicKey.slice(0, 32) // use first 32 bytes as key
      const src = `${dir}/plain.bin`
      const enc = `${dir}/enc.bin`
      writeFileSync(src, Buffer.from("hello world"))
      await encryptStreamToFile(src, enc, key)
      expect(isSecretStream(enc)).toBe(true)
    } finally { rmSync(dir, { recursive: true }) }
  })

  test("returns false for non-secretstream files", () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const f = `${dir}/plain.bin`
      writeFileSync(f, Buffer.from("just some bytes"))
      expect(isSecretStream(f)).toBe(false)
    } finally { rmSync(dir, { recursive: true }) }
  })
})

describe("encryptStreamToFile / decryptStreamToWritable", () => {
  test("round-trips a small file", async () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const { publicKey } = await generateNewsroomKeypair()
      const key = publicKey.slice(0, 32)
      const src = `${dir}/plain.txt`
      const enc = `${dir}/enc.bin`
      const plaintext = Buffer.from("round trip test data 🔐")
      writeFileSync(src, plaintext)
      await encryptStreamToFile(src, enc, key)

      const out = new PassThrough()
      const chunks: Buffer[] = []
      out.on("data", (c: Buffer) => chunks.push(c))
      await decryptStreamToWritable(enc, out, key)
      expect(Buffer.concat(chunks).equals(plaintext)).toBe(true)
    } finally { rmSync(dir, { recursive: true }) }
  })

  test("round-trips a multi-chunk file (>4 MB)", async () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const { publicKey } = await generateNewsroomKeypair()
      const key = publicKey.slice(0, 32)
      const src = `${dir}/big.bin`
      const enc = `${dir}/big.enc`
      const bigData = Buffer.alloc(5 * 1024 * 1024, 0xab) // 5 MB of 0xab bytes
      writeFileSync(src, bigData)
      await encryptStreamToFile(src, enc, key)

      const out = new PassThrough()
      const chunks: Buffer[] = []
      out.on("data", (c: Buffer) => chunks.push(c))
      await decryptStreamToWritable(enc, out, key)
      const result = Buffer.concat(chunks)
      expect(result.length).toBe(bigData.length)
      expect(result.equals(bigData)).toBe(true)
    } finally { rmSync(dir, { recursive: true }) }
  })

  test("decryption fails with wrong key", async () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const { publicKey: key1 } = await generateNewsroomKeypair()
      const { publicKey: key2 } = await generateNewsroomKeypair()
      const src = `${dir}/plain.bin`
      const enc = `${dir}/enc.bin`
      writeFileSync(src, Buffer.from("secret data"))
      await encryptStreamToFile(src, enc, key1.slice(0, 32))

      const out = new PassThrough()
      await expect(decryptStreamToWritable(enc, out, key2.slice(0, 32))).rejects.toThrow()
    } finally { rmSync(dir, { recursive: true }) }
  })

  test("decryption throws on non-secretstream file", async () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const { publicKey } = await generateNewsroomKeypair()
      const key = publicKey.slice(0, 32)
      const f = `${dir}/plain.bin`
      writeFileSync(f, Buffer.from("not encrypted"))
      const out = new PassThrough()
      await expect(decryptStreamToWritable(f, out, key)).rejects.toThrow("not a secretstream file")
    } finally { rmSync(dir, { recursive: true }) }
  })
})
```

- [ ] **Step 1.3: Run tests**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test packages/source-portal/tests/crypto.test.ts 2>&1 | tail -8
```

Expected: all new tests pass. Total tests in that file should be ~30 (existing 19 + 7 new).

- [ ] **Step 1.4: Commit**

```bash
cd /c/Users/USER/Desktop/journalist-platform
git add packages/shared/src/crypto.ts packages/source-portal/tests/crypto.test.ts
git commit -m "feat: secretstream helpers — encryptStreamToFile, decryptStreamToWritable, isSecretStream"
```

---

## Task 2: Video metadata stripping + source portal upload changes

**Files:**
- Modify: `packages/source-portal/src/stripMetadata.ts`
- Modify: `packages/source-portal/src/routes/submit.ts`
- Modify: `packages/source-portal/tests/submit.test.ts`

**Context:**
- `stripMetadata.ts` already handles images (sharp) and office files (warning). Add video path.
- `submit.ts` currently calls `readFileSync(file.path)` then `encryptData`. For files ≥ 64 MB, use `encryptStreamToFile` instead. The file is written to disk by multer already (not in memory).
- Multer limit: change `fileSize: 256 * 1024 * 1024` to `fileSize: 2 * 1024 * 1024 * 1024`.
- ffmpeg may not be installed in test environment — strip code must handle absence gracefully.

- [ ] **Step 2.1: Add video stripping to `packages/source-portal/src/stripMetadata.ts`**

Read the current file first, then add the video path. Add after the `OFFICE_EXTENSIONS` set:

```typescript
import { spawnSync } from "child_process"
import { writeFileSync, unlinkSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { randomBytes } from "crypto"

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mts", ".ts", ".wmv", ".flv",
])

function isFfmpegAvailable(): boolean {
  try {
    const result = spawnSync("ffmpeg", ["-version"], { timeout: 3000 })
    return result.status === 0
  } catch {
    return false
  }
}
```

Then inside `stripMetadata`, add the video case BEFORE the office case:

```typescript
  if (VIDEO_EXTENSIONS.has(ext)) {
    if (!isFfmpegAvailable()) {
      return {
        data,
        stripped: false,
        warning: `Video file (${ext}) — ffmpeg not available, metadata NOT stripped. Install ffmpeg on the server.`,
      }
    }
    // Write to temp file, strip with ffmpeg, read back
    const id = randomBytes(8).toString("hex")
    const inPath = join(tmpdir(), `strip-in-${id}${ext}`)
    const outPath = join(tmpdir(), `strip-out-${id}.mp4`)
    try {
      writeFileSync(inPath, data)
      const result = spawnSync("ffmpeg", [
        "-i", inPath,
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-c:v", "copy",
        "-c:a", "copy",
        "-y",
        outPath,
      ], { timeout: 120_000 })
      if (result.status !== 0) {
        return {
          data,
          stripped: false,
          warning: `ffmpeg failed to strip video metadata (exit ${result.status}). Original stored.`,
        }
      }
      const { readFileSync: rfs } = await import("fs")
      const stripped = rfs(outPath)
      return { data: stripped, stripped: true }
    } finally {
      try { unlinkSync(inPath) } catch {}
      try { if (existsSync(outPath)) unlinkSync(outPath) } catch {}
    }
  }
```

**Note:** the `spawnSync` approach buffers the entire video in memory for the return value. For large videos this is acceptable because `data` (the input) is already in memory at this call site. If memory becomes a concern in future, switch to streaming ffmpeg.

- [ ] **Step 2.2: Update `packages/source-portal/src/routes/submit.ts`**

Read the current file. Make three changes:

**Change A — multer limit:**
```typescript
// Before:
limits: { fileSize: 256 * 1024 * 1024, files: 10 },
// After:
limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 10 },
```

**Change B — add imports at top of file:**
```typescript
import { statSync } from "fs"
import { encryptStreamToFile, isSecretStream } from "@journalist/shared/crypto"
```

**Change C — use secretstream for large files:**

Find this block in the file upload loop:
```typescript
const fileBytes = readFileSync(file.path)
// Strip metadata before encryption
const { data: cleanBytes, stripped, warning } = await stripMetadata(fileBytes, file.originalname)
if (warning) console.warn(`[submit] File ${i} (${file.originalname}): ${warning}`)
const bytesToEncrypt = cleanBytes
```

Replace with:
```typescript
const STREAM_THRESHOLD = 64 * 1024 * 1024 // 64 MB
const fileSize = statSync(file.path).size
let bytesToEncrypt: Buffer
let usedStream = false

if (fileSize >= STREAM_THRESHOLD) {
  // Large file: strip metadata in-place via temp file, then stream-encrypt
  const fileBytes = readFileSync(file.path)
  const { data: cleanBytes, stripped, warning } = await stripMetadata(fileBytes, file.originalname)
  if (warning) console.warn(`[submit] File ${i} (${file.originalname}): ${warning}`)
  // Write clean bytes back to a temp file for stream encryption
  writeFileSync(file.path + ".clean", cleanBytes)
  bytesToEncrypt = cleanBytes // kept for size check only
  usedStream = true
} else {
  const fileBytes = readFileSync(file.path)
  const { data: cleanBytes, stripped, warning } = await stripMetadata(fileBytes, file.originalname)
  if (warning) console.warn(`[submit] File ${i} (${file.originalname}): ${warning}`)
  bytesToEncrypt = cleanBytes
}
```

Then find where `encryptData(bytesToEncrypt, dek)` and `writeFileSync(filePath, encContent, "utf8")` are called. Replace that block:

```typescript
let encContent: string
if (usedStream) {
  // Stream-encrypt the cleaned temp file directly to destination
  const dekBytes = new Uint8Array(dek)
  await encryptStreamToFile(file.path + ".clean", filePath, dekBytes)
  unlinkSync(file.path + ".clean")
  encContent = "__stream__" // sentinel — not used; file already written
} else {
  encContent = await encryptData(bytesToEncrypt, dek)
  writeFileSync(filePath, encContent, "utf8")
}
```

**Note:** When `usedStream = true`, the file is already written by `encryptStreamToFile`. The existing `writeFileSync(filePath, encContent, "utf8")` must NOT run for stream files — the replacement above handles this.

- [ ] **Step 2.3: Run tests**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test packages/source-portal/tests/submit.test.ts 2>&1 | tail -8
```

Expected: all 7 existing submit tests pass.

- [ ] **Step 2.4: Commit**

```bash
cd /c/Users/USER/Desktop/journalist-platform
git add packages/source-portal/src/stripMetadata.ts packages/source-portal/src/routes/submit.ts
git commit -m "feat: video metadata strip (ffmpeg) + 2 GB upload limit + secretstream for large files"
```

---

## Task 3: Workspace DB — videos table + CRUD

**Files:**
- Modify: `packages/journalist-workspace/src/lib/db.ts`
- Modify: `packages/journalist-workspace/tests/db.test.ts`

**Context:** The Db interface and implementation use Postgres (pool queries). Pattern: `pool.query(SQL, [params])` returns `{ rows }`. Read the existing `insertArticle` and `getArticle` implementations as the pattern to follow.

- [ ] **Step 3.1: Add Video type + methods to `packages/journalist-workspace/src/lib/db.ts`**

Read the current file. Add the `Video` type and extend the `Db` interface and implementation.

**Add type after `ArticleStatus`:**
```typescript
export type VideoStatus = "draft" | "processing" | "published"

export type Video = {
  id: string
  title_enc: string
  title_dek: string
  desc_enc: string | null
  desc_dek: string | null
  source_type: "submission" | "upload"
  submission_id: string | null
  file_index: number | null
  upload_path: string | null
  upload_dek: string | null
  duration_secs: number | null
  status: VideoStatus
  published_at: Date | null
  created_by: string
  created_at: Date
}
```

**Add to CREATE TABLE block in SCHEMA (after articles table):**
```sql
CREATE TABLE IF NOT EXISTS videos (
  id            TEXT PRIMARY KEY,
  title_enc     TEXT NOT NULL,
  title_dek     TEXT NOT NULL,
  desc_enc      TEXT,
  desc_dek      TEXT,
  source_type   TEXT NOT NULL CHECK(source_type IN ('submission','upload')),
  submission_id TEXT,
  file_index    INTEGER,
  upload_path   TEXT,
  upload_dek    TEXT,
  duration_secs INTEGER,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft','processing','published')),
  published_at  TIMESTAMPTZ,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Add to Db interface:**
```typescript
insertVideo(opts: {
  titleEnc: string; titleDek: string
  descEnc?: string | null; descDek?: string | null
  sourceType: "submission" | "upload"
  submissionId?: string | null; fileIndex?: number | null
  uploadPath?: string | null; uploadDek?: string | null
  durationSecs?: number | null
  createdBy: string
}): Promise<string>
getVideo(id: string): Promise<Video | null>
getVideos(filter?: { createdBy?: string }): Promise<Video[]>
updateVideo(id: string, titleEnc: string, titleDek: string, descEnc: string | null, descDek: string | null): Promise<void>
updateVideoStatus(id: string, status: VideoStatus, publishedAt?: Date | null): Promise<void>
deleteVideo(id: string): Promise<void>
```

**Add implementations (after `deleteArticle`):**
```typescript
async insertVideo(opts) {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO videos (id,title_enc,title_dek,desc_enc,desc_dek,source_type,
      submission_id,file_index,upload_path,upload_dek,duration_secs,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, opts.titleEnc, opts.titleDek, opts.descEnc ?? null, opts.descDek ?? null,
     opts.sourceType, opts.submissionId ?? null, opts.fileIndex ?? null,
     opts.uploadPath ?? null, opts.uploadDek ?? null, opts.durationSecs ?? null,
     opts.createdBy]
  )
  return id
},
async getVideo(id) {
  const res = await pool.query("SELECT * FROM videos WHERE id = $1", [id])
  return (res.rows[0] as Video) ?? null
},
async getVideos(filter) {
  if (filter?.createdBy) {
    const res = await pool.query("SELECT * FROM videos WHERE created_by = $1 ORDER BY created_at DESC", [filter.createdBy])
    return res.rows as Video[]
  }
  const res = await pool.query("SELECT * FROM videos ORDER BY created_at DESC")
  return res.rows as Video[]
},
async updateVideo(id, titleEnc, titleDek, descEnc, descDek) {
  await pool.query(
    "UPDATE videos SET title_enc=$1,title_dek=$2,desc_enc=$3,desc_dek=$4 WHERE id=$5",
    [titleEnc, titleDek, descEnc, descDek, id]
  )
},
async updateVideoStatus(id, status, publishedAt) {
  await pool.query(
    "UPDATE videos SET status=$1, published_at=$2 WHERE id=$3",
    [status, publishedAt ?? null, id]
  )
},
async deleteVideo(id) {
  await pool.query("DELETE FROM videos WHERE id = $1", [id])
},
```

- [ ] **Step 3.2: Add video DB tests to `packages/journalist-workspace/tests/db.test.ts`**

Read the current test file. Add to the `afterAll` cleanup:
```typescript
await db.query("DROP TABLE IF EXISTS videos, articles, case_notes, cases, users CASCADE")
```

Then append a new describe block before the final `}`:

```typescript
describe("videos table", () => {
  let userId: string

  beforeAll(async () => {
    // Create a user to satisfy the created_by FK
    userId = await db.insertUser("videouser", "hash", "enc", "journalist")
  })

  test("videos table exists", async () => {
    const res = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'videos'"
    )
    expect(res.rows).toHaveLength(1)
  })

  test("insertVideo / getVideo round-trip", async () => {
    const id = await db.insertVideo({
      titleEnc: "enc-title", titleDek: "dek-title",
      sourceType: "upload", uploadPath: "/var/secure-videos/test.enc",
      uploadDek: "sealed-dek", createdBy: userId,
    })
    const video = await db.getVideo(id)
    expect(video).not.toBeNull()
    expect(video!.title_enc).toBe("enc-title")
    expect(video!.source_type).toBe("upload")
    expect(video!.status).toBe("draft")
  })

  test("getVideos filters by createdBy", async () => {
    const id = await db.insertVideo({
      titleEnc: "e", titleDek: "d", sourceType: "upload",
      uploadPath: "/p", uploadDek: "dk", createdBy: userId,
    })
    const all = await db.getVideos()
    const own = await db.getVideos({ createdBy: userId })
    expect(all.length).toBeGreaterThanOrEqual(own.length)
    expect(own.some(v => v.id === id)).toBe(true)
  })

  test("updateVideoStatus changes status to processing then published", async () => {
    const id = await db.insertVideo({
      titleEnc: "e", titleDek: "d", sourceType: "upload",
      uploadPath: "/p", uploadDek: "dk", createdBy: userId,
    })
    await db.updateVideoStatus(id, "processing")
    const v1 = await db.getVideo(id)
    expect(v1!.status).toBe("processing")

    const now = new Date()
    await db.updateVideoStatus(id, "published", now)
    const v2 = await db.getVideo(id)
    expect(v2!.status).toBe("published")
    expect(v2!.published_at).not.toBeNull()
  })

  test("deleteVideo removes the row", async () => {
    const id = await db.insertVideo({
      titleEnc: "e", titleDek: "d", sourceType: "upload",
      uploadPath: "/p", uploadDek: "dk", createdBy: userId,
    })
    await db.deleteVideo(id)
    expect(await db.getVideo(id)).toBeNull()
  })
})
```

- [ ] **Step 3.3: Run tests**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test packages/journalist-workspace/tests/db.test.ts 2>&1 | tail -8
```

Expected: all tests pass including the 5 new video tests.

- [ ] **Step 3.4: Commit**

```bash
cd /c/Users/USER/Desktop/journalist-platform
git add packages/journalist-workspace/src/lib/db.ts packages/journalist-workspace/tests/db.test.ts
git commit -m "feat: videos table — DB schema + CRUD methods"
```

---

## Task 4: Case file stream endpoint

**Files:**
- Create: `packages/journalist-workspace/src/app/api/cases/[id]/files/[index]/stream/route.ts`
- Modify: `packages/journalist-workspace/src/lib/portal-db.ts`

**Context:**
- `portal-db.ts` has `getFileForDownload(submissionId, fileIndex, portalDbPath)` returning `{ encFilePath, sealedDek, encryptedFilename }`
- Existing download route (`[index]/route.ts`) reads the encrypted file via `readFileSync` + `decryptData`. The stream route uses `decryptStreamToWritable` for secretstream files and the existing `decryptData` for legacy files.
- The DEK is a sealed box; decrypt with `sealedBoxDecrypt(sealedDek, newsroomPublicKey, newsroomPrivateKey)` → 32-byte raw key.

- [ ] **Step 4.1: Add `getMimeType` helper to `packages/journalist-workspace/src/lib/portal-db.ts`**

Append to the end of `portal-db.ts`:

```typescript
const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska", ".webm": "video/webm", ".m4v": "video/mp4",
  ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv",
}
const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg", ".aac": "audio/aac", ".wav": "audio/wav", ".ogg": "audio/ogg",
}

export function getMimeType(filename: string | null): string {
  if (!filename) return "application/octet-stream"
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ""
  return VIDEO_MIME[ext] ?? AUDIO_MIME[ext] ?? "application/octet-stream"
}
```

- [ ] **Step 4.2: Create `packages/journalist-workspace/src/app/api/cases/[id]/files/[index]/stream/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createReadStream } from "fs"
import { PassThrough } from "stream"
import { getGlobals } from "@/lib/globals"
import { sealedBoxDecrypt, decryptData, isSecretStream, decryptStreamToWritable } from "@journalist/shared/crypto"
import { getFileForDownload, getMimeType } from "@/lib/portal-db"
import { canAccessCase } from "@/lib/caseAccess"
import { ReadableStream as WebReadableStream } from "stream/web"

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; index: string } }
) {
  const { db, sessionStore, newsroomPublicKey, newsroomPrivateKey, portalDbPath } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const fileIndex = parseInt(params.index, 10)
  if (isNaN(fileIndex) || fileIndex < 0) {
    return NextResponse.json({ error: "Invalid file index" }, { status: 400 })
  }

  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canAccessCase(session, caseData)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const fileInfo = await getFileForDownload(caseData.submission_ref, fileIndex, portalDbPath)
  if (!fileInfo) return NextResponse.json({ error: "File not found" }, { status: 404 })

  try {
    const dek = await sealedBoxDecrypt(fileInfo.sealedDek, newsroomPublicKey, newsroomPrivateKey)
    const mimeType = getMimeType(fileInfo.originalName)

    if (isSecretStream(fileInfo.encFilePath)) {
      // Large file: stream-decrypt on the fly
      const pass = new PassThrough()
      decryptStreamToWritable(fileInfo.encFilePath, pass, new Uint8Array(dek)).catch(err => {
        console.error("[stream]", err)
        pass.destroy(err)
      })
      const webStream = new WebReadableStream({
        start(controller) {
          pass.on("data", (chunk: Buffer) => controller.enqueue(chunk))
          pass.on("end", () => controller.close())
          pass.on("error", (err) => controller.error(err))
        },
      })
      return new NextResponse(webStream as any, {
        headers: { "Content-Type": mimeType, "Cache-Control": "no-store" },
      })
    } else {
      // Small/legacy file: single-shot decrypt
      const { readFileSync } = await import("fs")
      const encContent = readFileSync(fileInfo.encFilePath, "utf8")
      const plaintext = await decryptData(encContent, new Uint8Array(dek))
      return new NextResponse(plaintext, {
        headers: { "Content-Type": mimeType, "Content-Length": String(plaintext.length), "Cache-Control": "no-store" },
      })
    }
  } catch (err) {
    console.error("[stream] decrypt error:", err)
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 })
  }
}
```

- [ ] **Step 4.3: Run full test suite**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test 2>&1 | tail -6
```

Expected: all tests pass (stream route has no unit tests — it's integration-level).

- [ ] **Step 4.4: Commit**

```bash
cd /c/Users/USER/Desktop/journalist-platform
git add "packages/journalist-workspace/src/app/api/cases/[id]/files/[index]/stream/route.ts" packages/journalist-workspace/src/lib/portal-db.ts
git commit -m "feat: case file stream endpoint — decrypt-and-stream for workspace video playback"
```

---

## Task 5: Video API routes

**Files:**
- Create: `packages/journalist-workspace/src/app/api/videos/route.ts`
- Create: `packages/journalist-workspace/src/app/api/videos/upload/route.ts`
- Create: `packages/journalist-workspace/src/app/api/videos/[id]/route.ts`
- Create: `packages/journalist-workspace/src/app/api/videos/[id]/stream/route.ts`
- Create: `packages/journalist-workspace/src/app/api/videos/[id]/retract/route.ts`

**Context:** All routes follow the established pattern: get session from cookie, check role, call db methods. `masterKey` is available in globals for title/desc encryption. Use `generateDEK` + `encryptDEK` + `encryptData` for title/description (same as notes).

- [ ] **Step 5.1: Create `packages/journalist-workspace/src/app/api/videos/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData, decryptDEK, decryptData } from "@journalist/shared/crypto"

export async function GET(req: NextRequest) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const filter = session.role === "journalist" ? { createdBy: session.userId } : undefined
  const videos = await db.getVideos(filter)

  const decrypted = await Promise.all(videos.map(async (v) => {
    let title = "[encrypted]"
    let description: string | null = null
    try {
      const dek = await decryptDEK(v.title_dek, masterKey)
      title = (await decryptData(v.title_enc, dek)).toString("utf8")
      if (v.desc_enc && v.desc_dek) {
        const dek2 = await decryptDEK(v.desc_dek, masterKey)
        description = (await decryptData(v.desc_enc, dek2)).toString("utf8")
      }
    } catch { /* keep defaults */ }
    return {
      id: v.id, title, description, sourceType: v.source_type,
      durationSecs: v.duration_secs, status: v.status,
      publishedAt: v.published_at, createdBy: v.created_by, createdAt: v.created_at,
    }
  }))

  return NextResponse.json(decrypted)
}

export async function POST(req: NextRequest) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const { title, description, sourceType, submissionId, fileIndex } = body ?? {}
  if (!title || !sourceType) {
    return NextResponse.json({ error: "title and sourceType required" }, { status: 400 })
  }
  if (sourceType === "submission" && (submissionId == null || fileIndex == null)) {
    return NextResponse.json({ error: "submissionId and fileIndex required for source_type=submission" }, { status: 400 })
  }

  const titleDek = await generateDEK()
  const titleEnc = await encryptData(title, titleDek)
  const titleDekEnc = await encryptDEK(titleDek, masterKey)

  let descEnc: string | null = null
  let descDekEnc: string | null = null
  if (description) {
    const descDek = await generateDEK()
    descEnc = await encryptData(description, descDek)
    descDekEnc = await encryptDEK(descDek, masterKey)
  }

  const id = await db.insertVideo({
    titleEnc, titleDek: titleDekEnc,
    descEnc, descDek: descDekEnc,
    sourceType, submissionId: submissionId ?? null, fileIndex: fileIndex ?? null,
    createdBy: session.userId,
  })

  return NextResponse.json({ id }, { status: 201 })
}
```

- [ ] **Step 5.2: Create `packages/journalist-workspace/src/app/api/videos/upload/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { writeFileSync, mkdirSync } from "fs"
import { randomUUID } from "crypto"
import { join } from "path"
import { getGlobals } from "@/lib/globals"
import { generateDEK, sealedBoxEncrypt, encryptStreamToFile } from "@journalist/shared/crypto"
import { isSecretStream } from "@journalist/shared/crypto"

const UPLOAD_DIR = process.env.VIDEO_UPLOAD_DIR ?? "/var/secure-videos"
const STREAM_THRESHOLD = 64 * 1024 * 1024

export async function POST(req: NextRequest) {
  const { db, sessionStore, newsroomPublicKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const contentType = req.headers.get("content-type") ?? ""
  if (!contentType.startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "file field required" }, { status: 400 })

  mkdirSync(UPLOAD_DIR, { recursive: true })
  const videoId = randomUUID()
  const encPath = join(UPLOAD_DIR, `${videoId}.enc`)
  const tmpPath = join(UPLOAD_DIR, `${videoId}.tmp`)

  // Write raw bytes to tmp
  const bytes = Buffer.from(await file.arrayBuffer())
  writeFileSync(tmpPath, bytes)

  // Generate DEK, encrypt file
  const dek = await generateDEK()
  const sealedDek = await sealedBoxEncrypt(Buffer.from(dek), newsroomPublicKey)

  if (bytes.length >= STREAM_THRESHOLD) {
    await encryptStreamToFile(tmpPath, encPath, dek)
  } else {
    const { encryptData } = await import("@journalist/shared/crypto")
    const enc = await encryptData(bytes, dek)
    writeFileSync(encPath, enc, "utf8")
  }

  // Clean up tmp
  const { unlinkSync } = await import("fs")
  try { unlinkSync(tmpPath) } catch {}

  // Insert a draft video record with upload info only (title set separately via PUT)
  const { generateDEK: gd2, encryptDEK, encryptData } = await import("@journalist/shared/crypto")
  const placeholderTitle = `Untitled upload — ${new Date().toISOString()}`
  const { masterKey } = getGlobals()
  const titleDek = await gd2()
  const titleEnc = await encryptData(placeholderTitle, titleDek)
  const titleDekEnc = await encryptDEK(titleDek, masterKey)

  const id = await db.insertVideo({
    titleEnc, titleDek: titleDekEnc,
    sourceType: "upload", uploadPath: encPath, uploadDek: sealedDek,
    createdBy: session.userId,
  })

  return NextResponse.json({ id }, { status: 201 })
}
```

- [ ] **Step 5.3: Create `packages/journalist-workspace/src/app/api/videos/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData, decryptDEK, decryptData } from "@journalist/shared/crypto"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role === "journalist" && video.created_by !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let title = "[encrypted]"
  let description: string | null = null
  try {
    const dek = await decryptDEK(video.title_dek, masterKey)
    title = (await decryptData(video.title_enc, dek)).toString("utf8")
    if (video.desc_enc && video.desc_dek) {
      const dek2 = await decryptDEK(video.desc_dek, masterKey)
      description = (await decryptData(video.desc_enc, dek2)).toString("utf8")
    }
  } catch {}

  return NextResponse.json({
    id: video.id, title, description, sourceType: video.source_type,
    submissionId: video.submission_id, fileIndex: video.file_index,
    durationSecs: video.duration_secs, status: video.status,
    publishedAt: video.published_at, createdBy: video.created_by, createdAt: video.created_at,
  })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role === "journalist" && video.created_by !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const { title, description } = body ?? {}
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 })

  const titleDek = await generateDEK()
  const titleEnc = await encryptData(title, titleDek)
  const titleDekEnc = await encryptDEK(titleDek, masterKey)

  let descEnc: string | null = null
  let descDekEnc: string | null = null
  if (description) {
    const dDek = await generateDEK()
    descEnc = await encryptData(description, dDek)
    descDekEnc = await encryptDEK(dDek, masterKey)
  }

  await db.updateVideo(params.id, titleEnc, titleDekEnc, descEnc, descDekEnc)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (video.status === "published") {
    return NextResponse.json({ error: "Cannot delete a published video. Use retract first." }, { status: 423 })
  }
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (session.role === "journalist" && video.created_by !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Delete uploaded file from disk if present
  if (video.upload_path) {
    try { (await import("fs")).unlinkSync(video.upload_path) } catch {}
  }
  await db.deleteVideo(params.id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5.4: Create `packages/journalist-workspace/src/app/api/videos/[id]/stream/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { PassThrough } from "stream"
import { getGlobals } from "@/lib/globals"
import {
  sealedBoxDecrypt, decryptData,
  isSecretStream, decryptStreamToWritable,
} from "@journalist/shared/crypto"
import { getMimeType } from "@/lib/portal-db"
import { ReadableStream as WebReadableStream } from "stream/web"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, newsroomPublicKey, newsroomPrivateKey, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role === "journalist" && video.created_by !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Determine file path and DEK source
  let filePath: string
  let dek: Buffer
  if (video.source_type === "upload") {
    if (!video.upload_path || !video.upload_dek) {
      return NextResponse.json({ error: "Upload file not found" }, { status: 404 })
    }
    filePath = video.upload_path
    dek = await sealedBoxDecrypt(video.upload_dek, newsroomPublicKey, newsroomPrivateKey)
  } else {
    return NextResponse.json({ error: "Use /api/cases/[id]/files/[index]/stream for source submissions" }, { status: 400 })
  }

  const mimeType = getMimeType(filePath)

  try {
    if (isSecretStream(filePath)) {
      const pass = new PassThrough()
      decryptStreamToWritable(filePath, pass, new Uint8Array(dek)).catch(err => pass.destroy(err))
      const webStream = new WebReadableStream({
        start(controller) {
          pass.on("data", (chunk: Buffer) => controller.enqueue(chunk))
          pass.on("end", () => controller.close())
          pass.on("error", (err) => controller.error(err))
        },
      })
      return new NextResponse(webStream as any, {
        headers: { "Content-Type": mimeType, "Cache-Control": "no-store" },
      })
    } else {
      const { readFileSync } = await import("fs")
      const enc = readFileSync(filePath, "utf8")
      const plain = await decryptData(enc, new Uint8Array(dek))
      return new NextResponse(plain, {
        headers: { "Content-Type": mimeType, "Content-Length": String(plain.length), "Cache-Control": "no-store" },
      })
    }
  } catch (err) {
    console.error("[video stream]", err)
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 })
  }
}
```

- [ ] **Step 5.5: Create `packages/journalist-workspace/src/app/api/videos/[id]/retract/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { getGlobals } from "@/lib/globals"
import { updateVideoIndex } from "@/lib/publish"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, publicationDir } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "journalist") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (video.status !== "published") {
    return NextResponse.json({ error: "Only published videos can be retracted." }, { status: 400 })
  }

  // Remove publication directory
  const pubDir = join(publicationDir, "videos", params.id)
  if (existsSync(pubDir)) rmSync(pubDir, { recursive: true, force: true })

  // Rebuild video index
  updateVideoIndex(publicationDir)

  await db.updateVideoStatus(params.id, "draft", null)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5.6: Run full test suite**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test 2>&1 | tail -6
```

Expected: all tests pass.

- [ ] **Step 5.7: Commit**

```bash
cd /c/Users/USER/Desktop/journalist-platform
git add packages/journalist-workspace/src/app/api/videos/
git commit -m "feat: video API routes — list, create, upload, get, put, delete, stream, retract"
```

---

## Task 6: Transcode + publish pipeline + publication HTML

**Files:**
- Create: `packages/journalist-workspace/src/lib/transcode.ts`
- Create: `packages/journalist-workspace/src/app/api/videos/[id]/publish/route.ts`
- Modify: `packages/journalist-workspace/src/lib/publish.ts`
- Create: `publication/hls.min.js` (copy from node_modules)

**Context:**
- `publish.ts` exports `updateIndex(publicationDir)` and `publishArticle(opts)`. It has a `siteHeader(rightHref, rightLabel)` helper and CSS constants `DARK_CSS`.
- hls.min.js is at `node_modules/.bun/hls.js@1.6.16/node_modules/hls.js/dist/hls.min.js` (531 KB).
- `globals.ts` has `publicationDir: string`.
- `decryptStreamToWritable` sends plaintext to a Node.js `Writable`. ffmpeg can read from stdin (`-i pipe:0`).

- [ ] **Step 6.1: Copy hls.min.js to publication directory**

```bash
mkdir -p /c/Users/USER/Desktop/journalist-platform/publication
cp "/c/Users/USER/Desktop/journalist-platform/node_modules/.bun/hls.js@1.6.16/node_modules/hls.js/dist/hls.min.js" /c/Users/USER/Desktop/journalist-platform/publication/hls.min.js
```

Verify:
```bash
ls -lh /c/Users/USER/Desktop/journalist-platform/publication/hls.min.js
```

Expected: `531K hls.min.js`

- [ ] **Step 6.2: Create `packages/journalist-workspace/src/lib/transcode.ts`**

```typescript
import { execFile } from "child_process"
import { promisify } from "util"
import { mkdirSync, existsSync, writeFileSync } from "fs"
import { join } from "path"
import { PassThrough } from "stream"
import type { Globals } from "./globals"
import {
  sealedBoxDecrypt, decryptStreamToWritable,
  decryptData, isSecretStream,
} from "@journalist/shared/crypto"
import { getFileForDownload } from "./portal-db"

const execFileAsync = promisify(execFile)

export function isFfmpegAvailable(): boolean {
  try {
    const { spawnSync } = require("child_process")
    const r = spawnSync("ffmpeg", ["-version"], { timeout: 3000 })
    return r.status === 0
  } catch { return false }
}

type TranscodeResult = { ok: true } | { ok: false; error: string }

/**
 * Decrypt the video source and pipe it to ffmpeg via stdin.
 * Returns a PassThrough that feeds plaintext to ffmpeg.
 */
async function buildDecryptStream(
  video: { source_type: string; upload_path: string | null; upload_dek: string | null; submission_id: string | null; file_index: number | null },
  globals: Globals
): Promise<PassThrough> {
  const { newsroomPublicKey, newsroomPrivateKey, portalDbPath } = globals
  const pass = new PassThrough()

  if (video.source_type === "upload") {
    if (!video.upload_path || !video.upload_dek) throw new Error("Missing upload_path or upload_dek")
    const dek = await sealedBoxDecrypt(video.upload_dek, newsroomPublicKey, newsroomPrivateKey)
    if (isSecretStream(video.upload_path)) {
      decryptStreamToWritable(video.upload_path, pass, new Uint8Array(dek)).catch(err => pass.destroy(err))
    } else {
      const { readFileSync } = await import("fs")
      const enc = readFileSync(video.upload_path, "utf8")
      const plain = await decryptData(enc, new Uint8Array(dek))
      pass.end(plain)
    }
  } else {
    // source submission
    if (video.submission_id == null || video.file_index == null) throw new Error("Missing submission_id or file_index")
    const fileInfo = await getFileForDownload(video.submission_id, video.file_index, portalDbPath)
    if (!fileInfo) throw new Error("Source file not found in portal DB")
    const dek = await sealedBoxDecrypt(fileInfo.sealedDek, newsroomPublicKey, newsroomPrivateKey)
    if (isSecretStream(fileInfo.encFilePath)) {
      decryptStreamToWritable(fileInfo.encFilePath, pass, new Uint8Array(dek)).catch(err => pass.destroy(err))
    } else {
      const { readFileSync } = await import("fs")
      const enc = readFileSync(fileInfo.encFilePath, "utf8")
      const plain = await decryptData(enc, new Uint8Array(dek))
      pass.end(plain)
    }
  }
  return pass
}

/**
 * Transcode a video to HLS (1080p/720p/480p) and write to publicationDir/videos/[id]/
 * Also extracts a thumbnail and writes master.m3u8.
 */
export async function transcodeToHls(
  videoId: string,
  video: { source_type: string; upload_path: string | null; upload_dek: string | null; submission_id: string | null; file_index: number | null },
  globals: Globals
): Promise<TranscodeResult> {
  const outDir = join(globals.publicationDir, "videos", videoId)
  mkdirSync(join(outDir, "1080p"), { recursive: true })
  mkdirSync(join(outDir, "720p"), { recursive: true })
  mkdirSync(join(outDir, "480p"), { recursive: true })

  // Build decrypt stream → ffmpeg stdin
  const decryptStream = await buildDecryptStream(video as any, globals)

  // Single ffmpeg pass with filter_complex for all three resolutions
  const ffmpeg = require("child_process").spawn("ffmpeg", [
    "-i", "pipe:0",
    "-filter_complex",
    "[0:v]split=3[v1][v2][v3]; [v1]scale=-2:1080[out1080]; [v2]scale=-2:720[out720]; [v3]scale=-2:480[out480]",
    // 1080p
    "-map", "[out1080]", "-map", "0:a?",
    "-c:v:0", "libx264", "-b:v:0", "4000k", "-maxrate:v:0", "4400k", "-bufsize:v:0", "8800k",
    "-c:a:0", "aac", "-b:a:0", "128k",
    "-hls_time", "4", "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(outDir, "1080p", "seg%03d.ts"),
    join(outDir, "1080p", "playlist.m3u8"),
    // 720p
    "-map", "[out720]", "-map", "0:a?",
    "-c:v:1", "libx264", "-b:v:1", "2000k", "-maxrate:v:1", "2200k", "-bufsize:v:1", "4400k",
    "-c:a:1", "aac", "-b:a:1", "128k",
    "-hls_time", "4", "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(outDir, "720p", "seg%03d.ts"),
    join(outDir, "720p", "playlist.m3u8"),
    // 480p
    "-map", "[out480]", "-map", "0:a?",
    "-c:v:2", "libx264", "-b:v:2", "800k", "-maxrate:v:2", "880k", "-bufsize:v:2", "1760k",
    "-c:a:2", "aac", "-b:a:2", "96k",
    "-hls_time", "4", "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(outDir, "480p", "seg%03d.ts"),
    join(outDir, "480p", "playlist.m3u8"),
  ], { stdio: ["pipe", "pipe", "pipe"] })

  decryptStream.pipe(ffmpeg.stdin)

  await new Promise<void>((resolve, reject) => {
    ffmpeg.on("close", (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
    ffmpeg.on("error", reject)
  })

  // Write master playlist
  const master = [
    "#EXTM3U",
    "",
    "#EXT-X-STREAM-INF:BANDWIDTH=4128000,RESOLUTION=1920x1080,NAME=\"1080p\"",
    "1080p/playlist.m3u8",
    "",
    "#EXT-X-STREAM-INF:BANDWIDTH=2128000,RESOLUTION=1280x720,NAME=\"720p\"",
    "720p/playlist.m3u8",
    "",
    "#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=854x480,NAME=\"480p\"",
    "480p/playlist.m3u8",
  ].join("\n")
  writeFileSync(join(outDir, "master.m3u8"), master)

  // Extract thumbnail from second decrypt stream (at 3-second mark)
  try {
    const thumbStream = await buildDecryptStream(video as any, globals)
    const thumbFfmpeg = require("child_process").spawn("ffmpeg", [
      "-i", "pipe:0",
      "-ss", "00:00:03",
      "-vframes", "1",
      "-q:v", "3",
      "-y",
      join(outDir, "thumbnail.jpg"),
    ], { stdio: ["pipe", "pipe", "pipe"] })
    thumbStream.pipe(thumbFfmpeg.stdin)
    await new Promise<void>((resolve) => {
      thumbFfmpeg.on("close", () => resolve()) // non-fatal if thumbnail fails
    })
  } catch (err) {
    console.warn("[transcode] thumbnail extraction failed:", err)
  }

  return { ok: true }
}
```

- [ ] **Step 6.3: Add `publishVideoReport` and `updateVideoIndex` to `packages/journalist-workspace/src/lib/publish.ts`**

Read the current publish.ts. Note the existing `DARK_CSS`, `siteHeader()`, `formatDate()` helpers. Append after the `publishArticle` function:

```typescript
// ── Video report publication ───────────────────────────────────────────────

const VIDEO_CSS = `
  .video-hero{position:relative;background:#000;width:100%;aspect-ratio:16/9;overflow:hidden;margin-bottom:0}
  .video-hero video,.video-hero #hls-player{width:100%;height:100%;display:block}
  .video-overlay{position:absolute;bottom:0;left:0;right:0;padding:20px 28px;
    background:linear-gradient(to top,rgba(6,11,20,.95) 0%,transparent 100%)}
  .video-kicker{font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;
    letter-spacing:.12em;margin-bottom:8px}
  .video-title{font-size:24px;font-weight:800;line-height:1.2;letter-spacing:-.02em;
    text-shadow:0 2px 8px rgba(0,0,0,.8)}
  .quality-bar{display:flex;align-items:center;justify-content:space-between;
    padding:10px 28px;background:var(--surface);border-bottom:1px solid var(--border);
    font-size:11px;margin-bottom:0}
  .quality-badge{display:flex;align-items:center;gap:6px;color:var(--green)}
  .quality-dot{width:6px;height:6px;border-radius:50%;background:var(--green)}
  .quality-btns{display:flex;gap:6px}
  .q-btn{padding:3px 10px;border:1px solid var(--border);border-radius:4px;
    color:var(--text-muted);cursor:pointer;background:transparent;font-size:10px}
  .q-btn.active,.q-btn:hover{border-color:var(--green);color:var(--green)}
  .video-body{padding:28px 28px 60px;max-width:680px;margin:0 auto}
  .video-desc{font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.8;color:#CBD5E1}
  .video-desc p:first-child{font-size:18px;border-left:3px solid var(--green);
    padding-left:16px;margin-bottom:1.5em;color:#E2E8F0}
`

export function publishVideoReport(opts: {
  videoId: string
  title: string
  description: string
  publicationDir: string
  publishDate: Date
}): void {
  const { videoId, title, description, publicationDir, publishDate } = opts
  const dateStr = formatDate(publishDate)
  const outDir = `${publicationDir}/videos/${videoId}`
  const thumbnailExists = require("fs").existsSync(`${outDir}/thumbnail.jpg`)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DARK_CSS}${VIDEO_CSS}</style>
</head>
<body>
<div class="page" style="padding:0;max-width:100%">
  ${siteHeader("../../index.html", "← All reports")}
  <div class="video-hero">
    <video id="hls-player" controls${thumbnailExists ? ` poster="thumbnail.jpg"` : ""}></video>
    <div class="video-overlay">
      <div class="video-kicker">Video Report · Investigation · ${dateStr}</div>
      <div class="video-title">${escapeHtml(title)}</div>
    </div>
  </div>
  <div class="quality-bar">
    <div class="quality-badge">
      <div class="quality-dot"></div>
      <span>Verified source footage</span>
      <span style="color:var(--border-2)">·</span>
      <span style="color:var(--text-subtle)">Metadata stripped</span>
    </div>
    <div class="quality-btns">
      <button class="q-btn active" onclick="setQuality('auto')">Auto</button>
      <button class="q-btn" onclick="setQuality('1080p')">1080p</button>
      <button class="q-btn" onclick="setQuality('720p')">720p</button>
      <button class="q-btn" onclick="setQuality('480p')">480p</button>
    </div>
  </div>
  <div class="video-body">
    <div class="video-desc"><p>${escapeHtml(description)}</p></div>
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid var(--border);
                display:flex;justify-content:space-between;align-items:center">
      <a href="../../video-index.html" style="color:var(--green);text-decoration:none;font-size:12px">← All videos</a>
      <span style="font-size:10px;color:var(--text-subtle)">This site is only accessible over Tor.</span>
    </div>
  </div>
</div>
<script src="../../hls.min.js"></script>
<script>
var player = document.getElementById('hls-player');
var src = 'master.m3u8';
var quality = 'auto';
function loadHls(url) {
  if (window.Hls && Hls.isSupported()) {
    var hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(player);
  } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
    player.src = url;
  }
}
function setQuality(q) {
  quality = q;
  document.querySelectorAll('.q-btn').forEach(function(b){ b.classList.remove('active'); });
  event.target.classList.add('active');
  var url = q === 'auto' ? 'master.m3u8' : q + '/playlist.m3u8';
  loadHls(url);
}
loadHls(src);
</script>
</body>
</html>`

  require("fs").writeFileSync(`${outDir}/index.html`, html, "utf8")
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function updateVideoIndex(publicationDir: string): void {
  const { readdirSync, existsSync, statSync, readFileSync, writeFileSync } = require("fs")
  const { join } = require("path")

  const videosDir = join(publicationDir, "videos")
  if (!existsSync(videosDir)) {
    // Nothing to do yet
    writeFileSync(join(publicationDir, "video-index.html"), buildVideoIndexHtml([]), "utf8")
    return
  }

  const entries: { id: string; title: string; date: Date; thumbnailExists: boolean }[] = []

  for (const id of readdirSync(videosDir)) {
    const indexPath = join(videosDir, id, "index.html")
    if (!existsSync(indexPath)) continue
    try {
      const html = readFileSync(indexPath, "utf8")
      const titleMatch = html.match(/<title>([^<]+)<\/title>/)
      const title = titleMatch ? titleMatch[1] : "Untitled"
      const stat = statSync(indexPath)
      entries.push({
        id, title, date: stat.mtime,
        thumbnailExists: existsSync(join(videosDir, id, "thumbnail.jpg")),
      })
    } catch { /* skip malformed */ }
  }

  entries.sort((a, b) => b.date.getTime() - a.date.getTime())
  writeFileSync(join(publicationDir, "video-index.html"), buildVideoIndexHtml(entries), "utf8")
}

function buildVideoIndexHtml(entries: { id: string; title: string; date: Date; thumbnailExists: boolean }[]): string {
  const { join } = require("path")
  const items = entries.map(e => `
    <div class="report-item">
      ${e.thumbnailExists
        ? `<img src="videos/${e.id}/thumbnail.jpg" class="video-thumb" alt="" loading="lazy">`
        : `<div class="video-thumb video-thumb-placeholder"></div>`}
      <div class="report-content">
        <div class="report-kicker">Video Report · ${formatDate(e.date)}</div>
        <div class="report-title">${escapeHtml(e.title)}</div>
        <a href="videos/${e.id}/index.html" class="report-link">Watch →</a>
      </div>
    </div>`).join("")

  const VIDEO_INDEX_CSS = `
    .video-thumb{width:120px;height:68px;object-fit:cover;border-radius:4px;flex-shrink:0;background:var(--surface);border:1px solid var(--border)}
    .video-thumb-placeholder{width:120px;height:68px;border-radius:4px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center}
    .report-item{display:flex;gap:16px;align-items:flex-start;padding:20px 0;border-bottom:1px solid var(--border)}
    .report-content{flex:1}
    .report-kicker{font-size:10px;font-weight:600;color:var(--green);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
    .report-title{font-size:16px;font-weight:700;margin-bottom:10px;line-height:1.3}
    .report-link{font-size:12px;color:var(--green);text-decoration:none}
    .report-link:hover{text-decoration:underline}
  `

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video Reports</title>
<style>${DARK_CSS}${VIDEO_INDEX_CSS}</style>
</head>
<body>
<div class="page">
  ${siteHeader("index.html", "← All reports")}
  <h1 style="font-size:22px;font-weight:800;margin-bottom:8px">Video Reports</h1>
  <p style="color:var(--text-subtle);font-size:13px;margin-bottom:28px">${entries.length} video${entries.length !== 1 ? "s" : ""} published</p>
  ${items || '<p style="color:var(--text-subtle);padding:40px 0;text-align:center">No videos published yet.</p>'}
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid var(--border)">
    <p style="font-size:10px;color:var(--text-subtle);text-align:center">This site is only accessible over Tor.</p>
  </div>
</div>
</body>
</html>`
}
```

- [ ] **Step 6.4: Update `updateIndex` in `publish.ts` to add Videos nav link**

Find the `siteHeader` call inside `updateIndex` and the one inside `publishArticle`. Update the site header in `updateIndex` to include a Videos link:

Find in `updateIndex`:
```typescript
${siteHeader("/", "Published via Tor · Encrypted")}
```
Change to:
```typescript
${siteHeader("video-index.html", "Videos →")}
```

And in the article page (`publishArticle`), update the header's right link to be consistent — no change needed (it already points back to article index).

- [ ] **Step 6.5: Create `packages/journalist-workspace/src/app/api/videos/[id]/publish/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"
import { transcodeToHls, isFfmpegAvailable } from "@/lib/transcode"
import { publishVideoReport, updateVideoIndex } from "@/lib/publish"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey, publicationDir } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "journalist") return NextResponse.json({ error: "Forbidden — editors and admins only." }, { status: 403 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (video.status === "published") return NextResponse.json({ error: "Already published." }, { status: 400 })
  if (video.status === "processing") return NextResponse.json({ error: "Already processing." }, { status: 400 })

  if (!isFfmpegAvailable()) {
    return NextResponse.json({ error: "ffmpeg is not installed on this server." }, { status: 503 })
  }

  // Set processing immediately, return 202
  await db.updateVideoStatus(params.id, "processing")

  // Decrypt title for publication
  let title = "Untitled"
  let description = ""
  try {
    const titleDek = await decryptDEK(video.title_dek, masterKey)
    title = (await decryptData(video.title_enc, titleDek)).toString("utf8")
    if (video.desc_enc && video.desc_dek) {
      const descDek = await decryptDEK(video.desc_dek, masterKey)
      description = (await decryptData(video.desc_enc, descDek)).toString("utf8")
    }
  } catch {}

  const globals = getGlobals()

  // Run transcode in background
  setImmediate(async () => {
    try {
      const result = await transcodeToHls(params.id, video as any, globals)
      if (!result.ok) {
        console.error("[publish video] transcode failed:", result.error)
        await db.updateVideoStatus(params.id, "draft")
        return
      }
      // Generate HTML pages
      publishVideoReport({ videoId: params.id, title, description, publicationDir, publishDate: new Date() })
      updateVideoIndex(publicationDir)
      await db.updateVideoStatus(params.id, "published", new Date())
    } catch (err) {
      console.error("[publish video] error:", err)
      await db.updateVideoStatus(params.id, "draft")
    }
  })

  return NextResponse.json({ ok: true, status: "processing" }, { status: 202 })
}
```

- [ ] **Step 6.6: Run full test suite**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test 2>&1 | tail -6
```

Expected: all tests pass.

- [ ] **Step 6.7: Commit**

```bash
cd /c/Users/USER/Desktop/journalist-platform
git add packages/journalist-workspace/src/lib/transcode.ts "packages/journalist-workspace/src/app/api/videos/[id]/publish/route.ts" packages/journalist-workspace/src/lib/publish.ts publication/hls.min.js
git commit -m "feat: HLS transcode pipeline + publishVideoReport + updateVideoIndex + hls.min.js"
```

---

## Task 7: Workspace video library UI + navigation

**Files:**
- Create: `packages/journalist-workspace/src/app/videos/page.tsx`
- Modify: `packages/journalist-workspace/src/app/dashboard/page.tsx` (add Videos nav link)

**Context:** Existing pages use `"use client"`, React hooks, inline styles, the dark theme (`background: "#060b14"`, green `#10b981`). Read `dashboard/page.tsx` before writing to match patterns.

- [ ] **Step 7.1: Read `packages/journalist-workspace/src/app/dashboard/page.tsx`**

Read the file to understand the session guard pattern and styling.

- [ ] **Step 7.2: Create `packages/journalist-workspace/src/app/videos/page.tsx`**

```tsx
"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"

type VideoItem = {
  id: string; title: string; description: string | null
  sourceType: "submission" | "upload"
  durationSecs: number | null; status: string
  publishedAt: string | null; createdBy: string; createdAt: string
}

type Tab = "all" | "sources" | "mine" | "published"

export default function VideosPage() {
  const router = useRouter()
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("all")
  const [role, setRole] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typeof window !== "undefined") {
      const r = sessionStorage.getItem("role")
      const uid = sessionStorage.getItem("userId")
      if (!r) { router.replace("/login"); return }
      setRole(r); setUserId(uid)
    }
    fetchVideos()
  }, [])

  async function fetchVideos() {
    setLoading(true); setError(null)
    try {
      const r = await fetch("/api/videos")
      if (!r.ok) { setError("Failed to load videos"); return }
      setVideos(await r.json())
    } catch { setError("Network error") } finally { setLoading(false) }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadProgress("Uploading…")
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const r = await fetch("/api/videos/upload", { method: "POST", body: form })
      const body = await r.json()
      if (!r.ok) { setError(body.error || "Upload failed"); return }
      setUploadProgress("Upload complete. Update the title below.")
      await fetchVideos()
    } catch { setError("Upload failed") } finally {
      setUploadProgress(null)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this video?")) return
    const r = await fetch(`/api/videos/${id}`, { method: "DELETE" })
    if (r.ok) fetchVideos()
    else { const b = await r.json(); setError(b.error || "Delete failed") }
  }

  async function handleRetract(id: string) {
    if (!confirm("Retract this published video? It will be removed from the publication site.")) return
    const r = await fetch(`/api/videos/${id}/retract`, { method: "POST" })
    if (r.ok) fetchVideos()
    else { const b = await r.json(); setError(b.error || "Retract failed") }
  }

  async function handlePublish(id: string) {
    if (!confirm("Publish this video? ffmpeg will transcode it to HLS. This may take several minutes.")) return
    const r = await fetch(`/api/videos/${id}/publish`, { method: "POST" })
    const b = await r.json()
    if (!r.ok) { setError(b.error || "Publish failed"); return }
    fetchVideos()
  }

  const filtered = videos.filter(v => {
    if (tab === "sources") return v.sourceType === "submission"
    if (tab === "mine") return v.sourceType === "upload"
    if (tab === "published") return v.status === "published"
    return true
  })

  const card: React.CSSProperties = { background: "#0d1520", border: "1px solid #1e2d3d", borderRadius: 8, padding: 24 }
  const btn = (color = "#10b981"): React.CSSProperties => ({
    background: "transparent", color, border: `1px solid ${color}`,
    borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer",
  })
  const statusColor = (s: string) => s === "published" ? "#10b981" : s === "processing" ? "#6366f1" : "#f59e0b"

  return (
    <div style={{ minHeight: "100vh", background: "#060b14", color: "#e2e8f0", padding: "40px 24px", fontFamily: "system-ui" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Videos</h1>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <a href="/dashboard" style={{ color: "#10b981", textDecoration: "none", fontSize: 13 }}>← Dashboard</a>
            {(role === "journalist" || role === "admin") && (
              <>
                <input ref={fileRef} type="file" accept="video/*" style={{ display: "none" }} onChange={handleUpload} />
                <button style={{ ...btn(), background: "#10b981", color: "#000", border: "none", padding: "6px 14px", fontWeight: 600 }}
                  onClick={() => fileRef.current?.click()} disabled={!!uploadProgress}>
                  {uploadProgress ?? "+ Upload video"}
                </button>
              </>
            )}
          </div>
        </div>

        {error && <div style={{ background: "#1a0a0a", border: "1px solid #7f1d1d", borderRadius: 6, padding: "12px 16px", color: "#fca5a5", marginBottom: 20 }}>{error}</div>}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid #1e2d3d" }}>
          {(["all", "sources", "mine", "published"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "8px 14px", fontSize: 12, background: "transparent", border: "none", cursor: "pointer",
              color: tab === t ? "#10b981" : "#6b7280",
              borderBottom: tab === t ? "2px solid #10b981" : "2px solid transparent",
            }}>
              {t === "all" ? `All (${videos.length})` : t === "sources" ? "From sources" : t === "mine" ? "My uploads" : "Published"}
            </button>
          ))}
        </div>

        <div style={card}>
          {loading ? <p style={{ color: "#6b7280" }}>Loading…</p> : filtered.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No videos{tab !== "all" ? ` in "${tab}"` : ""}.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e2d3d" }}>
                  {["Title", "Source", "Duration", "Status", "Actions"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "#6b7280", fontWeight: 500, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} style={{ borderBottom: "1px solid #0d1520" }}>
                    <td style={{ padding: "12px 10px", fontWeight: 500 }}>{v.title}</td>
                    <td style={{ padding: "12px 10px", color: "#6b7280", fontSize: 12 }}>
                      {v.sourceType === "submission" ? "Source submission" : "My upload"}
                    </td>
                    <td style={{ padding: "12px 10px", color: "#6b7280", fontSize: 12 }}>
                      {v.durationSecs ? `${Math.floor(v.durationSecs / 60)}:${String(v.durationSecs % 60).padStart(2, "0")}` : "—"}
                    </td>
                    <td style={{ padding: "12px 10px" }}>
                      <span style={{ color: statusColor(v.status), background: "#060b14", border: `1px solid ${statusColor(v.status)}30`, borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>
                        {v.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 10px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <a href={v.sourceType === "upload" ? `/api/videos/${v.id}/stream` : "#"} target="_blank"
                          style={{ ...btn(), textDecoration: "none", display: "inline-block", lineHeight: "1.5" }}>
                          ▶ Watch
                        </a>
                        {(role === "editor" || role === "admin") && v.status === "draft" && (
                          <button style={btn()} onClick={() => handlePublish(v.id)}>Publish</button>
                        )}
                        {(role === "editor" || role === "admin") && v.status === "published" && (
                          <button style={btn("#ef4444")} onClick={() => handleRetract(v.id)}>Retract</button>
                        )}
                        {(role === "journalist" || role === "admin") && v.status !== "published" && (
                          <button style={btn("#ef4444")} onClick={() => handleDelete(v.id)}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7.3: Add Videos link to dashboard navigation**

Read `packages/journalist-workspace/src/app/dashboard/page.tsx`. Find where the navigation links are rendered (likely near the top of the page, or in a header). Add a "Videos" link pointing to `/videos`. The exact place depends on what you find — place it near the existing nav items (articles, admin, etc.).

If the dashboard has an inline nav bar, add:
```tsx
<a href="/videos" style={{ color: "#10b981", textDecoration: "none", fontSize: 13, marginLeft: 16 }}>Videos</a>
```

- [ ] **Step 7.4: Run full test suite**

```bash
cd /c/Users/USER/Desktop/journalist-platform
DATABASE_URL=postgres://localhost/journalist_workspace_test bun test 2>&1 | tail -6
```

Expected: all tests pass.

- [ ] **Step 7.5: Commit**

```bash
cd /c/Users/USER/Desktop/journalist-platform
git add "packages/journalist-workspace/src/app/videos/page.tsx" packages/journalist-workspace/src/app/dashboard/page.tsx
git commit -m "feat: workspace video library page + dashboard nav link"
```

---

## Task 8: Final integration check

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
The pass count should be ≥ 105 (93 original + 5 video DB tests + 5 streaming crypto tests + any new ones added).

- [ ] **Step 8.2: Verify publication hls.min.js exists**

```bash
ls -lh /c/Users/USER/Desktop/journalist-platform/publication/hls.min.js
```

Expected: ~531 KB file exists.

- [ ] **Step 8.3: Commit final state if needed**

```bash
cd /c/Users/USER/Desktop/journalist-platform
git add -A
git commit -m "feat: video upload and publishing — complete"
```
