import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const article = await db.getArticle(params.id)
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role !== "journalist" || article.author_id !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (article.status !== "draft") return NextResponse.json({ error: "Article is not in draft status" }, { status: 400 })
  await db.updateArticleStatus(params.id, "review")
  return NextResponse.json({ ok: true })
}
