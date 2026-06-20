import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { canAccessCase } from "@/lib/caseAccess"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canAccessCase(session, caseData)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const articles = await db.getArticlesByCase(params.id)
  return NextResponse.json({
    articles: articles.map((a) => ({
      id: a.id, case_id: a.case_id, author_id: a.author_id,
      status: a.status, published_at: a.published_at, created_at: a.created_at,
    }))
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canAccessCase(session, caseData)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const articleId = await db.insertArticle(params.id, session.userId)
  return NextResponse.json({ articleId }, { status: 201 })
}
