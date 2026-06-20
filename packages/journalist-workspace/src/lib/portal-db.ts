import { Database } from "bun:sqlite"
import { decryptDEK, decryptData } from "@journalist/shared/crypto"

export interface SubmissionContent {
  submissionId: string
  hasText: boolean
  text: string | null
  files: { index: number; originalName: string | null; encFilePath: string }[]
}

/**
 * Opens the source portal SQLite DB read-only and decrypts the submission content.
 * Returns null if the DB path is not configured or the submission is not found.
 */
export async function getSubmissionContent(
  submissionId: string,
  masterKey: Buffer,
  portalDbPath: string
): Promise<SubmissionContent | null> {
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(portalDbPath, { readonly: true })

    const row = db
      .query("SELECT id, encrypted_text FROM submissions WHERE id = ?")
      .get(submissionId) as { id: string; encrypted_text: string | null } | null

    if (!row) return null

    let text: string | null = null
    if (row.encrypted_text) {
      try {
        const { dek: encDek, body: encBody } = JSON.parse(row.encrypted_text)
        const dek = await decryptDEK(encDek, masterKey)
        const buf = await decryptData(encBody, dek)
        text = buf.toString("utf8")
      } catch {
        text = "[decryption error]"
      }
    }

    // Read file metadata from submission_files table
    const fileRows = db
      .query("SELECT id, encrypted_filename, encrypted_dek, file_path FROM submission_files WHERE submission_id = ? ORDER BY rowid ASC")
      .all(submissionId) as { id: string; encrypted_filename: string; encrypted_dek: string; file_path: string }[]

    const files = await Promise.all(
      fileRows.map(async (f, i) => {
        let originalName: string | null = null
        try {
          const dek = await decryptDEK(f.encrypted_dek, masterKey)
          const buf = await decryptData(f.encrypted_filename, dek)
          originalName = buf.toString("utf8")
        } catch {
          originalName = null
        }
        return { index: i, originalName, encFilePath: f.file_path }
      })
    )

    return { submissionId, hasText: !!text, text, files }
  } finally {
    db?.close()
  }
}
