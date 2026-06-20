import { describe, test, expect, beforeAll } from "bun:test"
import { createAuthService } from "../src/lib/auth"
import { openDb } from "../src/lib/db"
import { createSessionStore } from "../src/lib/session"
import { deriveMasterKey } from "@journalist/shared/crypto"
import { authenticator } from "otplib"

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://localhost/journalist_workspace_test"
let authService: ReturnType<typeof createAuthService>

beforeAll(async () => {
  const db = await openDb(TEST_DB_URL)
  const sessionStore = createSessionStore()
  const salt = Buffer.alloc(16, 0xcc)
  const masterKey = await deriveMasterKey("test-passphrase", salt)
  authService = createAuthService({ db, sessionStore, masterKey })
})

describe("createUser", () => {
  test("creates a user and returns TOTP setup info", async () => {
    const result = await authService.createUser("journalist2", "secure-pass-123", "journalist")
    expect(result.totpSecret).toBeString()
    expect(result.totpSecret.length).toBeGreaterThan(0)
    expect(result.userId).toBeString()
  })
})

describe("login", () => {
  test("returns session token on correct password and TOTP", async () => {
    const { totpSecret } = await authService.createUser("journalist3", "pass456", "journalist")
    const totpToken = authenticator.generate(totpSecret)
    const result = await authService.login("journalist3", "pass456", totpToken)
    expect(result.success).toBe(true)
    expect(result.token).toMatch(/^[0-9a-f]{64}$/)
  })
  test("fails on wrong password", async () => {
    await authService.createUser("journalist4", "correct-pass", "journalist")
    const result = await authService.login("journalist4", "wrong-pass", "000000")
    expect(result.success).toBe(false)
  })
  test("fails on wrong TOTP", async () => {
    const { totpSecret } = await authService.createUser("journalist5", "pass789", "journalist")
    const result = await authService.login("journalist5", "pass789", "000000")
    expect(result.success).toBe(false)
  })
  test("fails for unknown username", async () => {
    const result = await authService.login("nobody", "pass", "000000")
    expect(result.success).toBe(false)
  })
})
