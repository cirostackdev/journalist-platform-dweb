import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData } from "@journalist/shared/crypto"
import { writeQueueMessage } from "@journalist/shared/queue"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey, queueKey, queueDir } = getGlobals()
  const token = req.headers.get("x-session") ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await req.json()
  const text = body?.text as string | undefined
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 })
  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encBody = await encryptData(text, dek)
  await writeQueueMessage(queueDir, queueKey, {
    type: "journalist_reply", submissionId: caseData.submission_ref, encryptedBody: encBody, encryptedDek: encDek,
  })
  return NextResponse.json({ ok: true })
}
