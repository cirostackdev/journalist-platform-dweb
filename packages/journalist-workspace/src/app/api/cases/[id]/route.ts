import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"
import { getSubmissionContent } from "@/lib/portal-db"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey, portalDbPath } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Decrypt notes
  const rawNotes = await db.getCaseNotes(params.id)
  const notes = await Promise.all(rawNotes.map(async (note) => {
    try {
      const dek = await decryptDEK(note.encrypted_dek, masterKey)
      const buf = await decryptData(note.encrypted_body, dek)
      return { id: note.id, case_id: note.case_id, author_id: note.author_id, created_at: note.created_at, body: buf.toString("utf8") }
    } catch {
      return { id: note.id, case_id: note.case_id, author_id: note.author_id, created_at: note.created_at, body: "[decryption error]" }
    }
  }))

  // Read submission content from source portal DB (best-effort)
  let submission: { displayName: string | null; hasText: boolean; text: string | null; files: { index: number; originalName: string | null }[] } | null = null
  try {
    const { newsroomPublicKey, newsroomPrivateKey } = getGlobals()
    const content = await getSubmissionContent(
      caseData.submission_ref,
      newsroomPublicKey,
      newsroomPrivateKey,
      masterKey,
      portalDbPath
    )
    if (content) {
      submission = { displayName: content.displayName, hasText: content.hasText, text: content.text, files: content.files.map(f => ({ index: f.index, originalName: f.originalName })) }
    }
  } catch {
    // DB not available (e.g., test environment) — submission stays null
  }

  // Build sanitised case object — omit submission_ref (internal cross-system link)
  const { submission_ref: _omitted, assigned_to, ...casePublic } = caseData
  const sanitisedCase = {
    ...casePublic,
    // Only include assigned_to for admins
    ...(session.role === "admin" ? { assigned_to } : {}),
  }

  return NextResponse.json({ case: sanitisedCase, notes, submission })
}
