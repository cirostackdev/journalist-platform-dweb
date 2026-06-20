import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function POST(req: NextRequest) {
  const { sessionStore } = getGlobals()
  const token = req.cookies.get("session")?.value ?? ""
  sessionStore.destroySession(token)
  const response = NextResponse.json({ ok: true })
  response.cookies.set("session", "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 })
  return response
}
