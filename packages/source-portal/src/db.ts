import { Database } from "bun:sqlite"
import { randomUUID } from "crypto"

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    codename_hash TEXT NOT NULL UNIQUE,
    codename_hmac TEXT,
    passphrase_hash TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    encrypted_text TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    submitted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submission_files (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    encrypted_filename TEXT NOT NULL,
    encrypted_dek TEXT NOT NULL,
    file_path TEXT NOT NULL,
    submitted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    direction TEXT NOT NULL CHECK(direction IN ('source', 'journalist')),
    encrypted_body TEXT NOT NULL,
    encrypted_dek TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`

export type Message = {
  id: string
  submission_id: string
  direction: "source" | "journalist"
  encrypted_body: string
  encrypted_dek: string
  created_at: number
}

export type Source = {
  id: string
  codename_hash: string
  passphrase_hash: string | null
  created_at: number
}

export interface Db {
  close(): void
  query(sql: string): { get(): unknown; all(...args: unknown[]): unknown[] }
  insertSource(codenameHash: string, passphraseHash?: string, codenameHmac?: string): string
  insertSubmission(sourceId: string, encryptedText: string | null): string
  insertSubmissionFile(submissionId: string, encryptedFilename: string, encryptedDek: string, filePath: string): string
  insertMessage(
    submissionId: string,
    direction: "source" | "journalist",
    encryptedBody: string,
    encryptedDek: string
  ): string
  getMessages(submissionId: string): Message[]
  getSourceByHash(codenameHash: string): { id: string } | null
  getSourceByHmac(hmac: string): Source | null
}

export function openDb(path: string): Db {
  const sqlite = new Database(path)
  sqlite.exec("PRAGMA journal_mode = WAL;")
  sqlite.exec("PRAGMA foreign_keys = ON;")
  sqlite.exec(SCHEMA)
  try { sqlite.exec("ALTER TABLE sources ADD COLUMN codename_hmac TEXT") } catch { /* already exists */ }

  return {
    close() {
      sqlite.close()
    },
    query(sql: string) {
      return sqlite.query(sql)
    },
    insertSource(codenameHash: string, passphraseHash?: string, codenameHmac?: string): string {
      const id = randomUUID()
      sqlite
        .query("INSERT INTO sources (id, codename_hash, codename_hmac, passphrase_hash, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, codenameHash, codenameHmac ?? null, passphraseHash ?? null, Date.now())
      return id
    },
    insertSubmission(sourceId: string, encryptedText: string | null): string {
      const id = randomUUID()
      sqlite
        .query("INSERT INTO submissions (id, source_id, encrypted_text, submitted_at) VALUES (?, ?, ?, ?)")
        .run(id, sourceId, encryptedText, Date.now())
      return id
    },
    insertSubmissionFile(submissionId: string, encryptedFilename: string, encryptedDek: string, filePath: string): string {
      const id = randomUUID()
      sqlite
        .query("INSERT INTO submission_files (id, submission_id, encrypted_filename, encrypted_dek, file_path, submitted_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, submissionId, encryptedFilename, encryptedDek, filePath, Date.now())
      return id
    },
    insertMessage(
      submissionId: string,
      direction: "source" | "journalist",
      encryptedBody: string,
      encryptedDek: string
    ): string {
      const id = randomUUID()
      sqlite
        .query("INSERT INTO messages (id, submission_id, direction, encrypted_body, encrypted_dek, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, submissionId, direction, encryptedBody, encryptedDek, Date.now())
      return id
    },
    getMessages(submissionId: string): Message[] {
      return sqlite
        .query("SELECT * FROM messages WHERE submission_id = ? ORDER BY created_at ASC")
        .all(submissionId) as Message[]
    },
    getSourceByHash(codenameHash: string): Source | null {
      return sqlite
        .query("SELECT id, codename_hash, passphrase_hash, created_at FROM sources WHERE codename_hash = ?")
        .get(codenameHash) as Source | null
    },
    getSourceByHmac(hmac: string): Source | null {
      return sqlite
        .query("SELECT id, codename_hash, passphrase_hash, created_at FROM sources WHERE codename_hmac = ?")
        .get(hmac) as Source | null
    },
  }
}
