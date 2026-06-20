import { createRequire } from "module"
import { randomBytes } from "crypto"
import { openSync, readSync, closeSync } from "fs"
import { createReadStream, createWriteStream } from "fs"
import type { Writable } from "stream"
const _require = createRequire(import.meta.url)
const sodium = _require("libsodium-wrappers") as typeof import("libsodium-wrappers")
const sodiumSumo = _require("libsodium-wrappers-sumo") as typeof import("libsodium-wrappers-sumo")
import argon2 from "argon2"

export async function deriveMasterKey(
  passphrase: string,
  salt: Buffer
): Promise<Buffer> {
  if (salt.length < 16) {
    throw new Error("Salt must be at least 16 bytes")
  }
  // Use lower memory cost in test environments to prevent OOM with parallel test runners.
  // bun test sets NODE_ENV=test by default.
  const isTest = process.env.NODE_ENV === "test"
  const memoryCost = isTest ? 4096 : 262144 // 4MB in test, 256MB in production
  const timeCost = isTest ? 2 : 4
  // 256 MB / 4 iterations — nation-state threat model.
  // Complies with NIST SP 800-132 salt minimum (16 bytes) and higher-threat deployments.
  return argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    hashLength: 32,
    raw: true,
    memoryCost,
    timeCost,
    parallelism: 1,
  }) as Promise<Buffer>
}

export async function generateDEK(): Promise<Uint8Array> {
  await sodium.ready
  return sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)
}

export async function encryptDEK(
  dek: Uint8Array,
  masterKey: Buffer
): Promise<string> {
  await sodium.ready
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const encrypted = sodium.crypto_secretbox_easy(dek, nonce, masterKey)
  return Buffer.concat([Buffer.from(nonce), Buffer.from(encrypted)]).toString("base64")
}

export async function decryptDEK(
  encryptedDEK: string,
  masterKey: Buffer
): Promise<Uint8Array> {
  await sodium.ready
  const buf = Buffer.from(encryptedDEK, "base64")
  if (buf.length <= sodium.crypto_secretbox_NONCEBYTES) {
    throw new Error("Ciphertext too short — data may be corrupted or truncated")
  }
  const nonce = buf.subarray(0, sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = buf.subarray(sodium.crypto_secretbox_NONCEBYTES)
  const dek = sodium.crypto_secretbox_open_easy(ciphertext, nonce, masterKey)
  if (!dek) throw new Error("DEK decryption failed — wrong master key or corrupted data")
  return dek
}

export async function encryptData(
  plaintext: string | Buffer,
  dek: Uint8Array
): Promise<string> {
  await sodium.ready
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext
  const encrypted = sodium.crypto_secretbox_easy(data, nonce, dek)
  return Buffer.concat([Buffer.from(nonce), Buffer.from(encrypted)]).toString("base64")
}

export async function decryptData(
  ciphertext: string,
  dek: Uint8Array
): Promise<Buffer> {
  await sodium.ready
  const buf = Buffer.from(ciphertext, "base64")
  if (buf.length <= sodium.crypto_secretbox_NONCEBYTES) {
    throw new Error("Ciphertext too short — data may be corrupted or truncated")
  }
  const nonce = buf.subarray(0, sodium.crypto_secretbox_NONCEBYTES)
  const encrypted = buf.subarray(sodium.crypto_secretbox_NONCEBYTES)
  const decrypted = sodium.crypto_secretbox_open_easy(encrypted, nonce, dek)
  if (!decrypted) throw new Error("Data decryption failed")
  return Buffer.from(decrypted)
}

/**
 * Generates a random 12-character alphanumeric passphrase formatted as XXXX-XXXX-XXXX.
 * Uses an unambiguous charset (no 0, 1, I, O, L) for readability.
 */
export function generatePassphrase(): string {
  const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // 31 chars
  const VALID_RANGE = Math.floor(256 / CHARSET.length) * CHARSET.length // 248
  const chars: string[] = []
  while (chars.length < 12) {
    const byte = randomBytes(1)[0]
    if (byte < VALID_RANGE) {
      chars.push(CHARSET[byte % CHARSET.length])
    }
    // reject bytes >= 248 to eliminate modulo bias
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`
}

// Fixed 16-byte salt for source keypair derivation ("src-keypair-v1  ")
const KEYPAIR_SALT = new Uint8Array([
  0x73, 0x72, 0x63, 0x2d, 0x6b, 0x65, 0x79, 0x70,
  0x61, 0x69, 0x72, 0x2d, 0x76, 0x31, 0x20, 0x20,
])

export async function generateNewsroomKeypair(): Promise<{
  publicKey: Uint8Array
  privateKey: Uint8Array
}> {
  await sodium.ready
  return sodium.crypto_box_keypair()
}

export async function deriveSourceKeypair(
  diceware2: string,
  opts: { isTest?: boolean } = {}
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  await sodiumSumo.ready
  const isTest = opts.isTest ?? process.env.NODE_ENV === "test"
  const opslimit = isTest
    ? sodiumSumo.crypto_pwhash_OPSLIMIT_MIN
    : sodiumSumo.crypto_pwhash_OPSLIMIT_INTERACTIVE
  const memlimit = isTest
    ? sodiumSumo.crypto_pwhash_MEMLIMIT_MIN
    : sodiumSumo.crypto_pwhash_MEMLIMIT_INTERACTIVE
  const seed = sodiumSumo.crypto_pwhash(
    32,
    Buffer.from(diceware2, "utf8"),
    KEYPAIR_SALT,
    opslimit,
    memlimit,
    sodiumSumo.crypto_pwhash_ALG_ARGON2ID13
  )
  return sodiumSumo.crypto_box_seed_keypair(seed)
}

export async function sealedBoxEncrypt(
  plaintext: Buffer,
  recipientPublicKey: Uint8Array
): Promise<string> {
  await sodium.ready
  const ciphertext = sodium.crypto_box_seal(plaintext, recipientPublicKey)
  return Buffer.from(ciphertext).toString("base64")
}

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
 * Output format: [4-byte magic][24-byte header][4-byte len][chunk]...
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

    inStream.on("error", reject)
    inStream.on("data", (chunk: Buffer) => { chunks.push(chunk) })
    inStream.on("end", () => {
      try {
        // Handle empty file
        if (chunks.length === 0) {
          const ct = sodiumSumo.crypto_secretstream_xchacha20poly1305_push(
            state, Buffer.alloc(0), null,
            sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_FINAL
          )
          const lenBuf = Buffer.alloc(4)
          lenBuf.writeUInt32BE(ct.length, 0)
          out.write(lenBuf)
          out.write(Buffer.from(ct))
          out.end()
          return
        }
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1
          const tag = isLast
            ? sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_FINAL
            : sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
          const ct = sodiumSumo.crypto_secretstream_xchacha20poly1305_push(
            state, chunks[i], null, tag
          )
          const lenBuf = Buffer.alloc(4)
          lenBuf.writeUInt32BE(ct.length, 0)
          out.write(lenBuf)
          out.write(Buffer.from(ct))
        }
        out.end()
      } catch (err) { reject(err) }
    })
    out.on("finish", resolve)
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
    const headerLen = sodiumSumo.crypto_secretstream_xchacha20poly1305_HEADERBYTES
    const header = Buffer.alloc(headerLen)
    readSync(fd, header, 0, headerLen, 4)
    const state = sodiumSumo.crypto_secretstream_xchacha20poly1305_init_pull(header, key)

    let offset = 4 + headerLen

    await new Promise<void>((resolve, reject) => {
      dest.on("error", reject)

      function readNextChunk() {
        try {
          const lenBuf = Buffer.alloc(4)
          const bytesRead = readSync(fd, lenBuf, 0, 4, offset)
          if (bytesRead === 0) { dest.end(); resolve(); return }
          offset += 4
          const ctLen = lenBuf.readUInt32BE(0)

          const ct = Buffer.alloc(ctLen)
          readSync(fd, ct, 0, ctLen, offset)
          offset += ctLen

          const result = sodiumSumo.crypto_secretstream_xchacha20poly1305_pull(state, ct, null)
          if (!result) throw new Error("decryptStreamToWritable: authentication failed")
          const { message, tag } = result

          const writeDone = () => {
            if (tag === sodiumSumo.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
              dest.end(); resolve()
            } else {
              readNextChunk()
            }
          }

          if (message.length > 0) {
            dest.write(Buffer.from(message), (err) => {
              if (err) { reject(err); return }
              writeDone()
            })
          } else {
            writeDone()
          }
        } catch (err) { reject(err) }
      }

      readNextChunk()
    })
  } finally {
    closeSync(fd)
  }
}
