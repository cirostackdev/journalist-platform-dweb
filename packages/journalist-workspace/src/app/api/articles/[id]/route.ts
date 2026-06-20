import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData, decryptDEK, decryptData } from "@journalist/shared/crypto"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  if (!sessionStore.getSession(req.cookies.get("session")?.value ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const article = await db.getArticle(params.id)
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: string | null = null
  if (article.encrypted_body && article.encrypted_dek) {
    try {
      const dek = await decryptDEK(article.encrypted_dek, masterKey)
      const buf = await decryptData(article.encrypted_body, dek)
      body = buf.toString("utf8")
    } catch {
      body = null
    }
  }

  return NextResponse.json({
    article: {
      id: article.id,
      case_id: article.case_id,
      author_id: article.author_id,
      status: article.status,
      published_at: article.published_at,
      created_at: (article as any).created_at ?? null,
      body,
    },
  })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const session = sessionStore.getSession(req.cookies.get("session")?.value ?? "")
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const article = await db.getArticle(params.id)
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role !== "admin" && article.author_id !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (article.status === "published") {
    return NextResponse.json({ error: "Cannot edit a published article" }, { status: 400 })
  }
  const body = await req.json()
  if (body?.body === undefined) return NextResponse.json({ error: "body required" }, { status: 400 })
  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encBody = await encryptData(body.body as string, dek)
  await db.updateArticle(params.id, encBody, encDek)
  return NextResponse.json({ ok: true })
}
