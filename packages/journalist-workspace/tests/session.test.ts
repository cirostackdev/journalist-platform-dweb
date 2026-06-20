import { describe, test, expect } from "bun:test"
import { createSessionStore } from "../src/lib/session"

describe("session store", () => {
  test("createSession returns a 64-char hex token", () => {
    const store = createSessionStore()
    const token = store.createSession("user-id-1", "journalist")
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })
  test("getSession returns session for valid token", () => {
    const store = createSessionStore()
    const token = store.createSession("user-id-2", "editor")
    const session = store.getSession(token)
    expect(session).not.toBeNull()
    expect(session!.userId).toBe("user-id-2")
    expect(session!.role).toBe("editor")
  })
  test("getSession returns null for unknown token", () => {
    const store = createSessionStore()
    expect(store.getSession("nonexistent")).toBeNull()
  })
  test("destroySession removes the session", () => {
    const store = createSessionStore()
    const token = store.createSession("user-id-3", "admin")
    store.destroySession(token)
    expect(store.getSession(token)).toBeNull()
  })
  test("getSession returns null for expired session", async () => {
    const store = createSessionStore({ ttlMs: 1 })
    const token = store.createSession("user-id-4", "journalist")
    await new Promise((r) => setTimeout(r, 10))
    expect(store.getSession(token)).toBeNull()
  })
})
