import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData, decryptDEK, decryptData } from "@journalist/shared/crypto"

export async function GET(req: NextRequest) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const filter = session.role === "journalist" ? { createdBy: session.userId } : undefined
  const videos = await db.getVideos(filter)

  const result = await Promise.all(videos.map(async (v) => {
    let title = "[encrypted]"
    let description: string | null = null
    try {
      const dek = await decryptDEK(v.title_dek, masterKey)
      title = (await decryptData(v.title_enc, dek)).toString("utf8")
      if (v.desc_enc && v.desc_dek) {
        const dek2 = await decryptDEK(v.desc_dek, masterKey)
        description = (await decryptData(v.desc_enc, dek2)).toString("utf8")
      }
    } catch { /* keep defaults */ }
    return {
      id: v.id, title, description,
      sourceType: v.source_type, submissionId: v.submission_id, fileIndex: v.file_index,
      durationSecs: v.duration_secs, status: v.status,
      publishedAt: v.published_at, createdBy: v.created_by, createdAt: v.created_at,
    }
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const { title, description, sourceType, submissionId, fileIndex } = body ?? {}
  if (!title?.trim() || !sourceType) {
    return NextResponse.json({ error: "title and sourceType required" }, { status: 400 })
  }
  if (sourceType === "submission" && (submissionId == null || fileIndex == null)) {
    return NextResponse.json({ error: "submissionId and fileIndex required for submission sourceType" }, { status: 400 })
  }

  const titleDek = await generateDEK()
  const titleEnc = await encryptData(title.trim(), titleDek)
  const titleDekEnc = await encryptDEK(titleDek, masterKey)

  let descEnc: string | null = null
  let descDekEnc: string | null = null
  if (description?.trim()) {
    const dDek = await generateDEK()
    descEnc = await encryptData(description.trim(), dDek)
    descDekEnc = await encryptDEK(dDek, masterKey)
  }

  const id = await db.insertVideo({
    titleEnc, titleDek: titleDekEnc,
    descEnc, descDek: descDekEnc,
    sourceType,
    submissionId: submissionId ?? null,
    fileIndex: fileIndex ?? null,
    createdBy: session.userId,
  })

  return NextResponse.json({ id }, { status: 201 })
}
