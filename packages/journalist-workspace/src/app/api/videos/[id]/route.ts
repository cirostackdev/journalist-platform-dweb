import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { generateDEK, encryptDEK, encryptData, decryptDEK, decryptData } from "@journalist/shared/crypto"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role === "journalist" && video.created_by !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let title = "[encrypted]"
  let description: string | null = null
  try {
    const dek = await decryptDEK(video.title_dek, masterKey)
    title = (await decryptData(video.title_enc, dek)).toString("utf8")
    if (video.desc_enc && video.desc_dek) {
      const dek2 = await decryptDEK(video.desc_dek, masterKey)
      description = (await decryptData(video.desc_enc, dek2)).toString("utf8")
    }
  } catch {}

  return NextResponse.json({
    id: video.id, title, description,
    sourceType: video.source_type, submissionId: video.submission_id, fileIndex: video.file_index,
    durationSecs: video.duration_secs, status: video.status,
    publishedAt: video.published_at, createdBy: video.created_by, createdAt: video.created_at,
  })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role === "journalist" && video.created_by !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { title, description } = body ?? {}
  if (!title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 })

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

  await db.updateVideo(params.id, titleEnc, titleDekEnc, descEnc, descDekEnc)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (video.status === "published") {
    return NextResponse.json({ error: "Cannot delete a published video. Use retract first." }, { status: 423 })
  }
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (session.role === "journalist" && video.created_by !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (video.upload_path) {
    try { require("fs").unlinkSync(video.upload_path) } catch {}
  }
  await db.deleteVideo(params.id)
  return NextResponse.json({ ok: true })
}
