import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData } from "@journalist/shared/crypto"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  if (!sessionStore.getSession(req.headers.get("x-session") ?? "")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const article = await db.getArticle(params.id)
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ article })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const session = sessionStore.getSession(req.headers.get("x-session") ?? "")
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json()
  if (body?.body === undefined) return NextResponse.json({ error: "body required" }, { status: 400 })
  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encBody = await encryptData(body.body as string, dek)
  await db.updateArticle(params.id, encBody, encDek)
  return NextResponse.json({ ok: true })
}
