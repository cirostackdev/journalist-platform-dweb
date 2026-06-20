import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function GET(req: NextRequest) {
  const { db, sessionStore } = getGlobals()
  const token = req.headers.get("x-session") ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const filter = session.role === "journalist" ? { assignedTo: session.userId } : undefined
  const cases = await db.getCases(filter)
  return NextResponse.json({ cases })
}
