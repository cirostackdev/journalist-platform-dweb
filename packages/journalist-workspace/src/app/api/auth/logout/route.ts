import { NextRequest, NextResponse } from "next/server"
import { getGlobals } from "@/lib/globals"

export async function POST(req: NextRequest) {
  const { sessionStore } = getGlobals()
  sessionStore.destroySession(req.headers.get("x-session") ?? "")
  return NextResponse.json({ ok: true })
}
