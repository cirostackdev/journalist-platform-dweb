import { NextRequest, NextResponse } from "next/server"
import { readFileSync } from "fs"
import { getGlobals } from "@/lib/globals"
import { sealedBoxDecrypt, decryptData } from "@journalist/shared/crypto"
import { getFileForDownload } from "@/lib/portal-db"
import { canAccessCase } from "@/lib/caseAccess"

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; index: string } }
) {
  const { db, sessionStore, newsroomPublicKey, newsroomPrivateKey, portalDbPath } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  const session = sessionStore.getSession(token)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
    // Decrypt DEK (sealedDek = sealed box encrypted to newsroom public key)
    const dek = await sealedBoxDecrypt(fileInfo.sealedDek, newsroomPublicKey, newsroomPrivateKey)

    // Decrypt original filename
    let filename = `file-${fileIndex}`
    try {
      const nameBuf = await decryptData(fileInfo.encryptedFilename, new Uint8Array(dek))
      filename = nameBuf.toString("utf8")
    } catch {
      // fallback filename if name decryption fails
    }

    // Read and decrypt file content
    const encryptedBytes = readFileSync(fileInfo.encFilePath, "utf8")
    const plaintext = await decryptData(encryptedBytes, new Uint8Array(dek))

    return new NextResponse(plaintext, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(plaintext.length),
      },
    })
  } catch (err) {
    console.error("File decrypt error:", err)
    return NextResponse.json({ error: "File decryption failed" }, { status: 500 })
  }
}
