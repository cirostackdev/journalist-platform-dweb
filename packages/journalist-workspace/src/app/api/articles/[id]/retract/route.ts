import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "journalist") {
    return NextResponse.json({ error: "Forbidden — editors and admins only." }, { status: 403 })
  }

  const article = await db.getArticle(params.id)
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (article.status !== "published") {
    return NextResponse.json({ error: "Only published articles can be retracted." }, { status: 400 })
  }

  await db.updateArticleStatus(params.id, "draft")
  return NextResponse.json({ ok: true })
}
