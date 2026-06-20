import type { Db } from "./db"
import type { SessionStore } from "./session"

export type Globals = {
  db: Db; sessionStore: SessionStore; masterKey: Buffer
  queueKey: Uint8Array; queueDir: string; publicationDir: string
}

let globals: Globals | null = null
export function initGlobals(g: Globals) { globals = g }
export function getGlobals(): Globals {
  if (!globals) throw new Error("Globals not initialized — call initGlobals() at startup")
  return globals
}
