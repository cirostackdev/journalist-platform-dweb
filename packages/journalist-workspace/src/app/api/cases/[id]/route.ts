import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.headers.get("x-session") ?? ""
  if (!sessionStore.getSession(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const notes = await db.getCaseNotes(params.id)

  // Decrypt each note's body server-side
  const decryptedNotes = await Promise.all(
    notes.map(async (note) => {
      try {
        const dek = await decryptDEK(note.encrypted_dek, masterKey)
        const decryptedBody = await decryptData(note.encrypted_body, dek)
        return {
          id: note.id,
          case_id: note.case_id,
          author_id: note.author_id,
          created_at: note.created_at,
          body: decryptedBody.toString("utf8"),
        }
      } catch (error) {
        return {
          id: note.id,
          case_id: note.case_id,
          author_id: note.author_id,
          created_at: note.created_at,
          body: "[decryption error]",
        }
      }
    })
  )

  return NextResponse.json({ case: caseData, notes: decryptedNotes })
}
