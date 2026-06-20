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

  let title: string | null = null
  if (article.title_enc && article.title_dek) {
    try {
      const titleDek = await decryptDEK(article.title_dek, masterKey)
      const titleBuf = await decryptData(article.title_enc, titleDek)
      title = titleBuf.toString("utf8")
    } catch {
      title = null
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
      title,
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
  // Block edits if published
  if (article.status === "published") {
    return NextResponse.json({ error: "Published articles cannot be edited." }, { status: 423 })
  }
  // Block edits if in review (non-admin only — admin may need to fix urgent errors)
  if (article.status === "review" && session.role !== "admin") {
    return NextResponse.json({ error: "Article is under editorial review and cannot be edited." }, { status: 423 })
  }
  const bodyJson = await req.json()
  if (bodyJson?.body === undefined) return NextResponse.json({ error: "body required" }, { status: 400 })
  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encBody = await encryptData(bodyJson.body as string, dek)

  let titleEnc: string | undefined
  let titleDek: string | undefined
  if (typeof bodyJson.title === "string") {
    const tDek = await generateDEK()
    titleDek = await encryptDEK(tDek, masterKey)
    titleEnc = await encryptData(bodyJson.title, tDek)
  }

  await db.updateArticle(params.id, encBody, encDek, titleEnc, titleDek)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const article = await db.getArticle(params.id)
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Published articles cannot be deleted (use retract instead)
  if (article.status === "published") {
    return NextResponse.json({ error: "Published articles cannot be deleted. Use retract instead." }, { status: 423 })
  }
  // Only the author or admin can delete
  if (session.role === "journalist" && article.author_id !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (session.role === "editor") {
    return NextResponse.json({ error: "Forbidden — editors cannot delete articles." }, { status: 403 })
  }

  await db.deleteArticle(params.id)
  return NextResponse.json({ ok: true })
}
