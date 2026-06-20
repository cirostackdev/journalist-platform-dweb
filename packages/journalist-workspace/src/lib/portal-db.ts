import { Database } from "bun:sqlite"
import { sealedBoxDecrypt, decryptData } from "@journalist/shared/crypto"

export interface SubmissionContent {
  submissionId: string
  hasText: boolean
  text: string | null
  files: { index: number; originalName: string | null; encFilePath: string }[]
}

export async function getSubmissionContent(
  submissionId: string,
  newsroomPublicKey: Uint8Array,
  newsroomPrivateKey: Uint8Array,
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

    return { submissionId, hasText: !!text, text, files }
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
