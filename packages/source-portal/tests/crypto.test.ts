import { describe, test, expect } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { PassThrough } from "stream"
import {
  deriveMasterKey,
  generateDEK,
  encryptDEK,
  decryptDEK,
  encryptData,
  decryptData,
  generatePassphrase,
  generateNewsroomKeypair,
  deriveSourceKeypair,
  sealedBoxEncrypt,
  sealedBoxDecrypt,
  boxEncrypt,
  boxDecrypt,
  encryptStreamToFile,
  decryptStreamToWritable,
  isSecretStream,
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

  test("decryptDEK throws on truncated ciphertext", async () => {
    await expect(decryptDEK("dG9vc2hvcnQ=", Buffer.alloc(32))).rejects.toThrow("too short")
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

  test("decryptData throws on truncated ciphertext", async () => {
    await expect(decryptData("dG9vc2hvcnQ=", new Uint8Array(32))).rejects.toThrow("too short")
  })
})

describe("generatePassphrase", () => {
  test("returns a string in XXXX-XXXX-XXXX format", () => {
    const p = generatePassphrase()
    expect(p).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })

  test("two calls produce different values", () => {
    const a = generatePassphrase()
    const b = generatePassphrase()
    expect(a).not.toBe(b)
  })

  test("contains no ambiguous characters (0, 1, I, O, L)", () => {
    for (let i = 0; i < 20; i++) {
      const p = generatePassphrase()
      expect(p).not.toMatch(/[01IOL]/)
    }
  })
})

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

describe("isSecretStream", () => {
  test("returns true for secretstream-encrypted files", async () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const { publicKey } = await generateNewsroomKeypair()
      const key = publicKey.slice(0, 32)
      const src = `${dir}/plain.bin`
      const enc = `${dir}/enc.bin`
      writeFileSync(src, Buffer.from("hello world"))
      await encryptStreamToFile(src, enc, key)
      expect(isSecretStream(enc)).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test("returns false for non-secretstream files", () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const f = `${dir}/plain.bin`
      writeFileSync(f, Buffer.from("just some bytes not encrypted"))
      expect(isSecretStream(f)).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
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
      const plaintext = Buffer.from("round trip test data")
      writeFileSync(src, plaintext)
      await encryptStreamToFile(src, enc, key)

      const out = new PassThrough()
      const chunks: Buffer[] = []
      out.on("data", (c: Buffer) => chunks.push(c))
      await decryptStreamToWritable(enc, out, key)
      expect(Buffer.concat(chunks).equals(plaintext)).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test("round-trips a multi-chunk file (>4 MB)", async () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const { publicKey } = await generateNewsroomKeypair()
      const key = publicKey.slice(0, 32)
      const src = `${dir}/big.bin`
      const enc = `${dir}/big.enc`
      const bigData = Buffer.alloc(5 * 1024 * 1024, 0xab) // 5 MB
      writeFileSync(src, bigData)
      await encryptStreamToFile(src, enc, key)

      const out = new PassThrough()
      const chunks: Buffer[] = []
      out.on("data", (c: Buffer) => chunks.push(c))
      await decryptStreamToWritable(enc, out, key)
      const result = Buffer.concat(chunks)
      expect(result.length).toBe(bigData.length)
      expect(result.equals(bigData)).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
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
      await expect(
        decryptStreamToWritable(enc, out, key2.slice(0, 32))
      ).rejects.toThrow()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test("decryption throws on non-secretstream file", async () => {
    const dir = mkdtempSync(`${tmpdir()}/stream-test-`)
    try {
      const { publicKey } = await generateNewsroomKeypair()
      const key = publicKey.slice(0, 32)
      const f = `${dir}/plain.bin`
      writeFileSync(f, Buffer.from("not encrypted at all"))
      const out = new PassThrough()
      await expect(
        decryptStreamToWritable(f, out, key)
      ).rejects.toThrow("not a secretstream file")
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
