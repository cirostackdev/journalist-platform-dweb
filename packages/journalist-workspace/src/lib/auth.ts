import argon2 from "argon2"
import { authenticator } from "otplib"
import type { Db, Role } from "./db"
import type { SessionStore } from "./session"
import { encryptData, decryptData, generateDEK, encryptDEK, decryptDEK } from "@journalist/shared/crypto"

type LoginResult = { success: true; token: string; role: Role } | { success: false; token?: undefined }

// In-memory TOTP token blacklist: "userId:token" → expiry timestamp
const totpUsed = new Map<string, number>()

export function createAuthService(opts: { db: Db; sessionStore: SessionStore; masterKey: Buffer }) {
  return {
    async createUser(username: string, password: string, role: Role) {
      const argon2Hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 })
      const totpSecret = authenticator.generateSecret()
      const dek = await generateDEK()
      const encDek = await encryptDEK(dek, opts.masterKey)
      const encSecret = await encryptData(totpSecret, dek)
      const totpSecretEnc = JSON.stringify({ dek: encDek, body: encSecret })
      const userId = await opts.db.insertUser(username, argon2Hash, totpSecretEnc, role)
      return { userId, totpSecret }
    },

    async login(username: string, password: string, totpToken: string): Promise<LoginResult> {
      const user = await opts.db.getUserByUsername(username)
      if (!user) {
        await argon2.hash("dummy", { type: argon2.argon2id, memoryCost: 262144, timeCost: 4, parallelism: 1 })
        return { success: false }
      }
      const passwordOk = await argon2.verify(user.argon2_hash, password)
      if (!passwordOk) return { success: false }
      const { dek: encDek, body: encSecret } = JSON.parse(user.totp_secret_enc)
      const dek = await decryptDEK(encDek, opts.masterKey)
      const secretBuf = await decryptData(encSecret, dek)
      const totpOk = authenticator.verify({ token: totpToken, secret: secretBuf.toString("utf8") })
      if (!totpOk) return { success: false }

      // Replay protection
      const tokenKey = `${user.id}:${totpToken}`
      const now = Date.now()
      for (const [k, exp] of totpUsed) { if (now > exp) totpUsed.delete(k) }
      if (totpUsed.has(tokenKey)) return { success: false }
      totpUsed.set(tokenKey, now + 90_000)

      const token = opts.sessionStore.createSession(user.id, user.role)
      return { success: true, token, role: user.role }
    },
  }
}
