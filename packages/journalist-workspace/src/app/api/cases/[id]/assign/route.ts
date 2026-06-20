import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.headers.get("x-session") ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await req.json()
  const userId = body?.userId as string | undefined
  if (!userId?.trim()) return NextResponse.json({ error: "userId required" }, { status: 400 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await db.assignCase(params.id, userId)
  return NextResponse.json({ ok: true })
}
