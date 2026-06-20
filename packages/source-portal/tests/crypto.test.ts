import { describe, test, expect } from "bun:test"
import {
  deriveMasterKey,
  generateDEK,
  encryptDEK,
  decryptDEK,
  encryptData,
  decryptData,
} from "@journalist/shared/crypto"

describe("deriveMasterKey", () => {
  test("produces a 32-byte key from passphrase + salt", async () => {
    const salt = Buffer.alloc(16, 0x01)
    const key = await deriveMasterKey("test-passphrase", salt)
    expect(key).toHaveLength(32)
  })

  test("same passphrase + salt produces same key", async () => {
    const salt = Buffer.alloc(16, 0x02)
    const a = await deriveMasterKey("secret", salt)
    const b = await deriveMasterKey("secret", salt)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  test("different passphrases produce different keys", async () => {
    const salt = Buffer.alloc(16, 0x03)
    const a = await deriveMasterKey("secret1", salt)
    const b = await deriveMasterKey("secret2", salt)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})

describe("DEK lifecycle", () => {
  test("generateDEK returns 32 bytes", async () => {
    const dek = await generateDEK()
    expect(dek).toHaveLength(32)
  })

  test("encryptDEK / decryptDEK round-trips correctly", async () => {
    const salt = Buffer.alloc(16, 0x04)
    const masterKey = await deriveMasterKey("master", salt)
    const dek = await generateDEK()
    const encrypted = await encryptDEK(dek, masterKey)
    const decrypted = await decryptDEK(encrypted, masterKey)
    expect(Buffer.from(decrypted).equals(Buffer.from(dek))).toBe(true)
  })

  test("decryptDEK throws on wrong master key", async () => {
    const salt = Buffer.alloc(16, 0x05)
    const masterKey = await deriveMasterKey("master", salt)
    const wrongKey = await deriveMasterKey("wrong", salt)
    const dek = await generateDEK()
    const encrypted = await encryptDEK(dek, masterKey)
    await expect(decryptDEK(encrypted, wrongKey)).rejects.toThrow()
  })
})

describe("encryptData / decryptData", () => {
  test("round-trips string data", async () => {
    const dek = await generateDEK()
    const plaintext = "tip content here"
    const encrypted = await encryptData(plaintext, dek)
    const decrypted = await decryptData(encrypted, dek)
    expect(decrypted.toString("utf8")).toBe(plaintext)
  })

  test("round-trips binary data", async () => {
    const dek = await generateDEK()
    const data = Buffer.from([0x01, 0x02, 0x03, 0xff])
    const encrypted = await encryptData(data, dek)
    const decrypted = await decryptData(encrypted, dek)
    expect(decrypted.equals(data)).toBe(true)
  })

  test("encrypted output differs each call (random nonce)", async () => {
    const dek = await generateDEK()
    const a = await encryptData("same input", dek)
    const b = await encryptData("same input", dek)
    expect(a).not.toBe(b)
  })
})
