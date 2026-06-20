import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { createAuthService } from "@/lib/auth"

// Simple in-memory rate limiter: max 5 failed attempts per username per 15 minutes
const failedAttempts = new Map<string, { count: number; windowStart: number }>()

function checkLoginRateLimit(username: string): boolean {
  const now = Date.now()
  const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
  const MAX_ATTEMPTS = 5

  const entry = failedAttempts.get(username)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    return true // allow (new window)
  }
  return entry.count < MAX_ATTEMPTS
}

function recordFailedAttempt(username: string): void {
  const now = Date.now()
  const WINDOW_MS = 15 * 60 * 1000
  const entry = failedAttempts.get(username)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    failedAttempts.set(username, { count: 1, windowStart: now })
  } else {
    entry.count++
  }
}

export async function POST(req: NextRequest) {
  const { db, sessionStore, masterKey } = getGlobals()
  const body = await req.json()
  const { username, password, totpToken } = body ?? {}
  if (!username || !password || !totpToken) return NextResponse.json({ error: "username, password, totpToken required" }, { status: 400 })
  if (!checkLoginRateLimit(username)) {
    return NextResponse.json({ error: "Too many failed attempts. Try again later." }, { status: 429 })
  }
  const auth = createAuthService({ db, sessionStore, masterKey })
  const result = await auth.login(username, password, totpToken)
  if (!result.success) {
    recordFailedAttempt(username)
    await new Promise((r) => setTimeout(r, 500))
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }
  // On success: clear the counter and set httpOnly session cookie
  failedAttempts.delete(username)
  const response = NextResponse.json({ ok: true, role: result.role })
  response.cookies.set("session", result.token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    // secure: true — set in production behind TLS; omitted here so dev/test works without HTTPS
  })
  return response
}
