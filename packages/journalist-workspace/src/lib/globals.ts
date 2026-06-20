import type { Db } from "./db"
import type { SessionStore } from "./session"

export type Globals = {
  db: Db
  sessionStore: SessionStore
  masterKey: Buffer
  queueKey: Uint8Array
  toWorkspaceQueueDir: string
  toPortalQueueDir: string
  publicationDir: string
  portalDbPath: string
  newsroomPublicKey: Uint8Array
  newsroomPrivateKey: Uint8Array
}

let globals: Globals | null = null
export function initGlobals(g: Globals) { globals = g }
export function getGlobals(): Globals {
  if (!globals) throw new Error("Globals not initialized — call initGlobals() at startup")
  return globals
}
