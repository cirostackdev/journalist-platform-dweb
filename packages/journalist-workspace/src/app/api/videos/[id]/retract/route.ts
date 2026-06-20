import { NextRequest, NextResponse } from "next/server"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { getGlobals } from "@/lib/globals"
import { updateVideoIndex } from "@/lib/publish"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, publicationDir } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "journalist") {
    return NextResponse.json({ error: "Forbidden — editors and admins only." }, { status: 403 })
  }

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (video.status !== "published") {
    return NextResponse.json({ error: "Only published videos can be retracted." }, { status: 400 })
  }

  const pubDir = join(publicationDir, "videos", params.id)
  if (existsSync(pubDir)) rmSync(pubDir, { recursive: true, force: true })
  updateVideoIndex(publicationDir)

  await db.updateVideoStatus(params.id, "draft", null)
  return NextResponse.json({ ok: true })
}
