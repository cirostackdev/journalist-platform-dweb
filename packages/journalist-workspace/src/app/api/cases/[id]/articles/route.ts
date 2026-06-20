import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.headers.get("x-session") ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const articleId = await db.insertArticle(params.id, session.userId)
  return NextResponse.json({ articleId }, { status: 201 })
}
