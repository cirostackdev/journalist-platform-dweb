import { Database } from "bun:sqlite"
import { sealedBoxDecrypt, decryptData, decryptDEK } from "@journalist/shared/crypto"

export interface SubmissionContent {
  submissionId: string
  displayName: string | null
  hasText: boolean
  text: string | null
  files: { index: number; originalName: string | null; encFilePath: string }[]
}

export async function getSubmissionContent(
  submissionId: string,
  newsroomPublicKey: Uint8Array,
  newsroomPrivateKey: Uint8Array,
  masterKey: Buffer,
  portalDbPath: string
): Promise<SubmissionContent | null> {
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(portalDbPath, { readonly: true })

    const row = db
      .query(
        "SELECT sub.id, sub.encrypted_text, src.display_name FROM submissions sub JOIN sources src ON sub.source_id = src.id WHERE sub.id = ?"
      )
      .get(submissionId) as { id: string; encrypted_text: string | null; display_name: string | null } | null

    if (!row) return null

    let text: string | null = null
    if (row.encrypted_text) {
      try {
        const buf = await sealedBoxDecrypt(row.encrypted_text, newsroomPublicKey, newsroomPrivateKey)
        text = buf.toString("utf8")
      } catch {
        text = "[decryption error]"
      }
    }

    const fileRows = db
      .query(
        "SELECT id, encrypted_filename, encrypted_dek, file_path FROM submission_files WHERE submission_id = ? ORDER BY rowid ASC"
      )
      .all(submissionId) as { id: string; encrypted_filename: string; encrypted_dek: string; file_path: string }[]

    const files = await Promise.all(
      fileRows.map(async (f, i) => {
        let originalName: string | null = null
        try {
          // encrypted_dek column now stores sealedDek (sealed with newsroom public key)
          const dek = await sealedBoxDecrypt(f.encrypted_dek, newsroomPublicKey, newsroomPrivateKey)
          const buf = await decryptData(f.encrypted_filename, new Uint8Array(dek))
          originalName = buf.toString("utf8")
        } catch {
          originalName = null
        }
        return { index: i, originalName, encFilePath: f.file_path }
      })
    )

    let displayName: string | null = null
    if (row.display_name) {
      try {
        const parsed = JSON.parse(row.display_name)
        if (parsed.dek && parsed.body) {
          // Encrypted format: { dek, body }
          const dek = await decryptDEK(parsed.dek, masterKey)
          const buf = await decryptData(parsed.body, dek)
          displayName = buf.toString("utf8")
        } else {
          // Legacy plaintext fallback (old rows before this fix)
          displayName = row.display_name
        }
      } catch {
        displayName = row.display_name // fallback for truly old plaintext rows
      }
    }

    return { submissionId, displayName, hasText: !!text, text, files }
  } finally {
    db?.close()
  }
}

export interface SourceFollowUpMessage {
  body: string
  created_at: number
}

/**
 * Returns decrypted follow-up messages sent by the source (direction='source').
 * These are sealed with the newsroom public key.
 */
export async function getSourceFollowUps(
  submissionId: string,
  newsroomPublicKey: Uint8Array,
  newsroomPrivateKey: Uint8Array,
  portalDbPath: string
): Promise<SourceFollowUpMessage[]> {
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(portalDbPath, { readonly: true })
    const rows = db
      .query(
        "SELECT encrypted_body, created_at FROM messages WHERE submission_id = ? AND direction = 'source' ORDER BY created_at ASC"
      )
      .all(submissionId) as { encrypted_body: string; created_at: number }[]

    const results: SourceFollowUpMessage[] = []
    for (const row of rows) {
      try {
        const buf = await sealedBoxDecrypt(row.encrypted_body, newsroomPublicKey, newsroomPrivateKey)
        results.push({ body: buf.toString("utf8"), created_at: row.created_at })
      } catch {
        results.push({ body: "[decryption error]", created_at: row.created_at })
      }
    }
    return results
  } finally {
    db?.close()
  }
}

export interface FileForDownload {
  originalName: string | null
  encFilePath: string
  sealedDek: string
  encryptedFilename: string
}

/**
 * Returns the encrypted file metadata needed to decrypt and serve a file.
 * Index is 0-based (matches the file array order in submission_files).
 */
export async function getFileForDownload(
  submissionId: string,
  fileIndex: number,
  portalDbPath: string
): Promise<FileForDownload | null> {
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(portalDbPath, { readonly: true })
    const rows = db
      .query(
        "SELECT encrypted_filename, encrypted_dek, file_path FROM submission_files WHERE submission_id = ? ORDER BY rowid ASC"
      )
      .all(submissionId) as { encrypted_filename: string; encrypted_dek: string; file_path: string }[]
    if (fileIndex < 0 || fileIndex >= rows.length) return null
    const f = rows[fileIndex]
    return {
      originalName: null, // resolved at download time
      encFilePath: f.file_path,
      sealedDek: f.encrypted_dek,
      encryptedFilename: f.encrypted_filename,
    }
  } finally {
    db?.close()
  }
}

export async function getSourcePublicKeyForSubmission(
  submissionId: string,
  portalDbPath: string
): Promise<string | null> {
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(portalDbPath, { readonly: true })
    const row = db
      .query(
        "SELECT s.source_public_key FROM sources s JOIN submissions sub ON sub.source_id = s.id WHERE sub.id = ?"
      )
      .get(submissionId) as { source_public_key: string } | null
    return row?.source_public_key ?? null
  } finally {
    db?.close()
  }
}

const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska", ".webm": "video/webm", ".m4v": "video/mp4",
  ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv", ".ts": "video/mp2t",
}

export function getMimeType(filename: string | null): string {
  if (!filename) return "application/octet-stream"
  const ext = (filename.toLowerCase().match(/\.[^.]+$/)?.[0]) ?? ""
  return VIDEO_MIME[ext] ?? "application/octet-stream"
}
