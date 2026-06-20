import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { createAuthService } from "@/lib/auth"
import type { Role } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { db, sessionStore } = getGlobals()
  const session = sessionStore.getSession(req.cookies.get("session")?.value ?? "")
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const res = await db.query("SELECT id, username, role, created_at FROM users ORDER BY created_at ASC")
  return NextResponse.json({ users: res.rows })
}

export async function POST(req: NextRequest) {
  const { db, sessionStore, masterKey } = getGlobals()
  const session = sessionStore.getSession(req.cookies.get("session")?.value ?? "")
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await req.json()
  const { username, password, role } = body ?? {}
  if (!username || !password || !["admin","journalist","editor"].includes(role)) return NextResponse.json({ error: "username, password, role required" }, { status: 400 })
  const auth = createAuthService({ db, sessionStore, masterKey })
  const { userId, totpSecret } = await auth.createUser(username, password, role as Role)
  return NextResponse.json({ userId, totpSecret, message: "Save this TOTP secret — it will not be shown again." }, { status: 201 })
}
