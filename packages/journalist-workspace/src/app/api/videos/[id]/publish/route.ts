import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"
import { transcodeToHls, isFfmpegAvailable } from "@/lib/transcode"
import { publishVideoReport, updateVideoIndex } from "@/lib/publish"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey, publicationDir } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "journalist") {
    return NextResponse.json({ error: "Forbidden — editors and admins only." }, { status: 403 })
  }

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (video.status === "published") {
    return NextResponse.json({ error: "Already published." }, { status: 400 })
  }
  if (video.status === "processing") {
    return NextResponse.json({ error: "Already processing." }, { status: 400 })
  }
  if (!isFfmpegAvailable()) {
    return NextResponse.json({ error: "ffmpeg is not installed on this server." }, { status: 503 })
  }

  await db.updateVideoStatus(params.id, "processing")

  // Decrypt title/description for the publication page
  let title = "Untitled"
  let description = ""
  try {
    const titleDek = await decryptDEK(video.title_dek, masterKey)
    title = (await decryptData(video.title_enc, titleDek)).toString("utf8")
    if (video.desc_enc && video.desc_dek) {
      const descDek = await decryptDEK(video.desc_dek, masterKey)
      description = (await decryptData(video.desc_enc, descDek)).toString("utf8")
    }
  } catch {}

  const globals = getGlobals()
  const videoRecord = {
    source_type: video.source_type,
    upload_path: video.upload_path,
    upload_dek: video.upload_dek,
    submission_id: video.submission_id,
    file_index: video.file_index,
  }

  // Transcode in background — return 202 immediately
  setImmediate(async () => {
    try {
      const result = await transcodeToHls(params.id, videoRecord, globals)
      if (!result.ok) {
        console.error("[publish video] transcode failed:", (result as any).error)
        await db.updateVideoStatus(params.id, "draft")
        return
      }
      publishVideoReport({ videoId: params.id, title, description, publicationDir, publishDate: new Date() })
      updateVideoIndex(publicationDir)
      await db.updateVideoStatus(params.id, "published", new Date())
    } catch (err) {
      console.error("[publish video] error:", err)
      await db.updateVideoStatus(params.id, "draft")
    }
  })

  return NextResponse.json({ ok: true, status: "processing" }, { status: 202 })
}
