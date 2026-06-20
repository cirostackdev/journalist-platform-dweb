import { createRequire } from "module"
import { randomBytes } from "crypto"
const _require = createRequire(import.meta.url)
const sodium = _require("libsodium-wrappers") as typeof import("libsodium-wrappers")
import argon2 from "argon2"

export async function deriveMasterKey(
  passphrase: string,
  salt: Buffer
): Promise<Buffer> {
  if (salt.length < 8) {
    throw new Error("Salt must be at least 8 bytes")
  }
  // 64 MB / 3 iterations — sufficient for login-style auth.
  // Increase memoryCost to 262144+ for higher-threat deployments (e.g. nation-state adversaries).
  return argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    hashLength: 32,
    raw: true,
    memoryCost: 65536,
    timeCost: 3,
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
  const bytes = randomBytes(12)
  const chars = Array.from(bytes, (b) => CHARSET[b % CHARSET.length])
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`
}
