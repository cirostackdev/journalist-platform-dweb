import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { publishArticle } from "@/lib/publish"

const PUBLICATION_DIR = process.env.PUBLICATION_DIR ?? "/var/publication"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const session = sessionStore.getSession(req.headers.get("x-session") ?? "")
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "journalist") return NextResponse.json({ error: "Forbidden — editors only" }, { status: 403 })
  const article = await db.getArticle(params.id)
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!article.encrypted_body || !article.encrypted_dek) return NextResponse.json({ error: "Article has no content" }, { status: 400 })
  await publishArticle({ articleId: params.id, encryptedBody: article.encrypted_body, encryptedDek: article.encrypted_dek, masterKey, publicationDir: PUBLICATION_DIR })
  await db.publishArticle(params.id)
  return NextResponse.json({ ok: true })
}
