import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"
import { authenticator } from "otplib"
import { generateDEK, encryptDEK, encryptData } from "@journalist/shared/crypto"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { db, sessionStore, masterKey } = getGlobals()
  const session = sessionStore.getSession(req.headers.get("x-session") ?? "")
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const user = await db.getUserById(params.id)
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Generate new TOTP secret and encrypt it
  const totpSecret = authenticator.generateSecret()
  const dek = await generateDEK()
  const encDek = await encryptDEK(dek, masterKey)
  const encSecret = await encryptData(totpSecret, dek)
  const totpSecretEnc = JSON.stringify({ dek: encDek, body: encSecret })

  await db.query(
    "UPDATE users SET totp_secret_enc = $1 WHERE id = $2",
    [totpSecretEnc, params.id]
  )

  return NextResponse.json({
    userId: params.id,
    totpSecret,
    message: "TOTP secret reset. Save this immediately — it will not be shown again.",
  })
}
