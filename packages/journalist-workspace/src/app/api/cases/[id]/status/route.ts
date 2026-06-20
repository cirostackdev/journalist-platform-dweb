import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import type { CaseStatus } from "@/lib/db"

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.headers.get("x-session") ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role !== "admin" && caseData.assigned_to !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const body = await req.json()
  const status = body?.status as CaseStatus | undefined
  if (!status || !["new","active","closed"].includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  await db.updateCaseStatus(params.id, status)
  return NextResponse.json({ ok: true })
}
