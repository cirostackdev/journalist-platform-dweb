import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { createAuthService } from "@/lib/auth"

export async function POST(req: NextRequest) {
  const { db, sessionStore, masterKey } = getGlobals()
  const body = await req.json()
  const { username, password, totpToken } = body ?? {}
  if (!username || !password || !totpToken) return NextResponse.json({ error: "username, password, totpToken required" }, { status: 400 })
  const auth = createAuthService({ db, sessionStore, masterKey })
  const result = await auth.login(username, password, totpToken)
  if (!result.success) {
    await new Promise((r) => setTimeout(r, 500))
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }
  return NextResponse.json({ token: result.token, role: result.role })
}
