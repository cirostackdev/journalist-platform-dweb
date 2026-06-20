import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData } from "@journalist/shared/crypto"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json()
  const text = body?.text as string | undefined
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 })
  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encBody = await encryptData(text, dek)
  const noteId = await db.insertCaseNote(params.id, session.userId, encBody, encDek)
  return NextResponse.json({ noteId })
}
