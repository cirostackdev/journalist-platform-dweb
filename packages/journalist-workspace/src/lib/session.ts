import { randomBytes } from "crypto"
import type { Role } from "./db"

export type Session = { userId: string; role: Role; expiresAt: number }
export type SessionStore = {
  createSession(userId: string, role: Role): string
  getSession(token: string): Session | null
  destroySession(token: string): void
}

export function createSessionStore(opts: { ttlMs?: number } = {}): SessionStore {
  const ttlMs = opts.ttlMs ?? 8 * 60 * 60 * 1000
  const store = new Map<string, Session>()
  return {
    createSession(userId, role) {
      const token = randomBytes(32).toString("hex")
      store.set(token, { userId, role, expiresAt: Date.now() + ttlMs })
      return token
    },
    getSession(token) {
      const session = store.get(token)
      if (!session) return null
      if (Date.now() > session.expiresAt) { store.delete(token); return null }
      return session
    },
    destroySession(token) { store.delete(token) },
  }
}
