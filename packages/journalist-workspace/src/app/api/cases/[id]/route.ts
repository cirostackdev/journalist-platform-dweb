import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.headers.get("x-session") ?? ""
  if (!sessionStore.getSession(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const notes = await db.getCaseNotes(params.id)
  return NextResponse.json({ case: caseData, notes })
}
