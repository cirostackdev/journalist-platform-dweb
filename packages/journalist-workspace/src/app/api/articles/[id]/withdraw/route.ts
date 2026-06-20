import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const article = await db.getArticle(params.id)
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Only the article's author-journalist (or admin) can withdraw from review
  const isOwnAuthor = session.role === "journalist" && article.author_id === session.userId
  const isAdmin = session.role === "admin"
  if (!isOwnAuthor && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (article.status !== "review") {
    return NextResponse.json({ error: "Only articles in review can be withdrawn." }, { status: 400 })
  }

  await db.updateArticleStatus(params.id, "draft")
  return NextResponse.json({ ok: true })
}
