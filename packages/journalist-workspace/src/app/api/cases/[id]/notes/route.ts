import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData, decryptDEK, decryptData } from "@journalist/shared/crypto"
import { canAccessCase } from "@/lib/caseAccess"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canAccessCase(session, caseData)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const notes = await db.getCaseNotes(params.id)
  const decrypted = await Promise.all(notes.map(async (note) => {
    try {
      const dek = await decryptDEK(note.encrypted_dek, masterKey)
      const buf = await decryptData(note.encrypted_body, dek)
      return { id: note.id, case_id: note.case_id, author_id: note.author_id, created_at: note.created_at, body: buf.toString("utf8") }
    } catch {
      return { id: note.id, case_id: note.case_id, author_id: note.author_id, created_at: note.created_at, body: "[decryption error]" }
    }
  }))
  return NextResponse.json({ notes: decrypted })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canAccessCase(session, caseData)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const body = await req.json()
  const text = body?.text as string | undefined
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 })
  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encBody = await encryptData(text, dek)
  const noteId = await db.insertCaseNote(params.id, session.userId, encBody, encDek)
  return NextResponse.json({ noteId })
}
