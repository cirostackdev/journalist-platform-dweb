import { NextRequest, NextResponse } from "next/server"
import { PassThrough } from "stream"
import { getGlobals } from "@/lib/globals"
import {
  sealedBoxDecrypt, decryptData,
  isSecretStream, decryptStreamToWritable,
} from "@journalist/shared/crypto"
import { getMimeType } from "@/lib/portal-db"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, newsroomPublicKey, newsroomPrivateKey } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const video = await db.getVideo(params.id)
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (session.role === "journalist" && video.created_by !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (video.source_type !== "upload" || !video.upload_path || !video.upload_dek) {
    return NextResponse.json(
      { error: "Use /api/cases/[id]/files/[index]/stream for source submissions" },
      { status: 400 }
    )
  }

  try {
    const dek = await sealedBoxDecrypt(video.upload_dek, newsroomPublicKey, newsroomPrivateKey)
    const mimeType = getMimeType(video.upload_path)

    if (isSecretStream(video.upload_path)) {
      const pass = new PassThrough()
      decryptStreamToWritable(video.upload_path, pass, new Uint8Array(dek)).catch(err => {
        console.error("[video stream]", err)
        pass.destroy(err)
      })
      const { ReadableStream } = await import("stream/web")
      const webStream = new ReadableStream({
        start(controller) {
          pass.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
          pass.on("end", () => controller.close())
          pass.on("error", (err) => controller.error(err))
        },
        cancel() { pass.destroy() },
      })
      return new NextResponse(webStream as any, {
        headers: { "Content-Type": mimeType, "Cache-Control": "no-store" },
      })
    } else {
      const { readFileSync } = await import("fs")
      const enc = readFileSync(video.upload_path, "utf8")
      const plain = await decryptData(enc, new Uint8Array(dek))
      return new NextResponse(plain, {
        headers: { "Content-Type": mimeType, "Content-Length": String(plain.length), "Cache-Control": "no-store" },
      })
    }
  } catch (err) {
    console.error("[video stream]", err)
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 })
  }
}
