import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { boxEncrypt } from "@journalist/shared/crypto"
import { writeQueueMessage } from "@journalist/shared/queue"
import { getSourcePublicKeyForSubmission } from "@/lib/portal-db"
import { canAccessCase } from "@/lib/caseAccess"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, newsroomPublicKey, newsroomPrivateKey, queueKey, toPortalQueueDir, portalDbPath } =
    getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const text = body?.text as string | undefined
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 })

  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canAccessCase(session, caseData)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const sourcePKHex = await getSourcePublicKeyForSubmission(caseData.submission_ref, portalDbPath)
  if (!sourcePKHex) {
    return NextResponse.json({ error: "Source public key not found" }, { status: 500 })
  }
  const sourcePK = new Uint8Array(Buffer.from(sourcePKHex, "hex"))

  const boxedBody = await boxEncrypt(Buffer.from(text, "utf8"), sourcePK, newsroomPrivateKey)
  const senderPublicKey = Buffer.from(newsroomPublicKey).toString("hex")

  await writeQueueMessage(toPortalQueueDir, queueKey, {
    type: "journalist_reply",
    submissionId: caseData.submission_ref,
    boxedBody,
    senderPublicKey,
  })

  return NextResponse.json({ ok: true })
}
