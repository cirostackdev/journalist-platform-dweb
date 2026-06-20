import { NextRequest, NextResponse } from "next/server"
import { PassThrough } from "stream"
import { getGlobals } from "@/lib/globals"
import {
  sealedBoxDecrypt,
  decryptData,
  isSecretStream,
  decryptStreamToWritable,
} from "@journalist/shared/crypto"
import { getFileForDownload, getMimeType } from "@/lib/portal-db"
import { canAccessCase } from "@/lib/caseAccess"

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; index: string } }
) {
  const { db, sessionStore, newsroomPublicKey, newsroomPrivateKey, portalDbPath } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const fileIndex = parseInt(params.index, 10)
  if (isNaN(fileIndex) || fileIndex < 0) {
    return NextResponse.json({ error: "Invalid file index" }, { status: 400 })
  }

  const caseData = await db.getCase(params.id)
  if (!caseData) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canAccessCase(session, caseData)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const fileInfo = await getFileForDownload(caseData.submission_ref, fileIndex, portalDbPath)
  if (!fileInfo) return NextResponse.json({ error: "File not found" }, { status: 404 })

  try {
    const dek = await sealedBoxDecrypt(fileInfo.sealedDek, newsroomPublicKey, newsroomPrivateKey)
    const mimeType = getMimeType(fileInfo.originalName)

    if (isSecretStream(fileInfo.encFilePath)) {
      // Large file: stream-decrypt on the fly
      const pass = new PassThrough()
      decryptStreamToWritable(fileInfo.encFilePath, pass, new Uint8Array(dek)).catch(err => {
        console.error("[stream case file]", err)
        pass.destroy(err)
      })
      // Convert Node.js PassThrough to Web ReadableStream for Next.js
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
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    } else {
      // Small/legacy file: single-shot decrypt
      const { readFileSync } = await import("fs")
      const encContent = readFileSync(fileInfo.encFilePath, "utf8")
      const plaintext = await decryptData(encContent, new Uint8Array(dek))
      return new NextResponse(plaintext, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(plaintext.length),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }
  } catch (err) {
    console.error("[stream case file] decrypt error:", err)
    return NextResponse.json({ error: "Decryption failed" }, { status: 500 })
  }
}
