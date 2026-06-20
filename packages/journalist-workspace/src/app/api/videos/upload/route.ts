import { NextRequest, NextResponse } from "next/server"
import { writeFileSync, mkdirSync, unlinkSync } from "fs"
import { randomUUID } from "crypto"
import { join } from "path"
import { getGlobals } from "@/lib/globals"
import {
  generateDEK, encryptDEK, encryptData,
  sealedBoxEncrypt, encryptStreamToFile,
} from "@journalist/shared/crypto"

const UPLOAD_DIR = process.env.VIDEO_UPLOAD_DIR ?? "/var/secure-videos"
const STREAM_THRESHOLD = 64 * 1024 * 1024

export async function POST(req: NextRequest) {
  const { db, sessionStore, masterKey, newsroomPublicKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role === "editor") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const contentType = req.headers.get("content-type") ?? ""
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "file field required" }, { status: 400 })

  mkdirSync(UPLOAD_DIR, { recursive: true })
  const videoId = randomUUID()
  const encPath = join(UPLOAD_DIR, `${videoId}.enc`)
  const tmpPath = join(UPLOAD_DIR, `${videoId}.tmp`)

  const bytes = Buffer.from(await file.arrayBuffer())
  writeFileSync(tmpPath, bytes)

  const dek = await generateDEK()
  const sealedDek = await sealedBoxEncrypt(Buffer.from(dek), newsroomPublicKey)

  if (bytes.length >= STREAM_THRESHOLD) {
    await encryptStreamToFile(tmpPath, encPath, dek)
  } else {
    const enc = await encryptData(bytes, dek)
    writeFileSync(encPath, enc, "utf8")
  }
  try { unlinkSync(tmpPath) } catch {}

  // Create a draft video record with a placeholder title
  const placeholderTitle = `Upload — ${new Date().toISOString()}`
  const titleDek = await generateDEK()
  const titleEnc = await encryptData(placeholderTitle, titleDek)
  const titleDekEnc = await encryptDEK(titleDek, masterKey)

  const id = await db.insertVideo({
    titleEnc, titleDek: titleDekEnc,
    sourceType: "upload", uploadPath: encPath, uploadDek: sealedDek,
    createdBy: session.userId,
  })

  return NextResponse.json({ id }, { status: 201 })
}
