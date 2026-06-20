import { Database } from "bun:sqlite"
import { randomUUID } from "crypto"

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    source_public_key TEXT NOT NULL,
    codename_hash TEXT NOT NULL UNIQUE,
    codename_hmac TEXT,
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
    sender_public_key TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
`

export type Message = {
  id: string
  submission_id: string
  direction: "source" | "journalist"
  encrypted_body: string
  sender_public_key: string
  created_at: number
}

export type Source = {
  id: string
  display_name: string
  source_public_key: string
  codename_hash: string
  codename_hmac: string | null
  created_at: number
}

export interface Db {
  close(): void
  query(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }
  insertSource(
    codenameHash: string,
    codenameHmac: string,
    displayName: string,
    sourcePublicKey: string
  ): string
  insertSubmission(sourceId: string, encryptedText: string | null): string
  insertSubmissionFile(
    submissionId: string,
    encryptedFilename: string,
    encryptedDek: string,
    filePath: string
  ): string
  insertMessage(
    submissionId: string,
    direction: "source" | "journalist",
    encryptedBody: string,
    senderPublicKey: string
  ): string
  getMessages(submissionId: string): Message[]
  getSourceByHmac(hmac: string): Source | null
}

export function openDb(path: string): Db {
  const sqlite = new Database(path)
  sqlite.exec("PRAGMA journal_mode = WAL;")
  sqlite.exec("PRAGMA foreign_keys = ON;")
  sqlite.exec(SCHEMA)
  // Migrations for existing DBs
  for (const col of [
    "ALTER TABLE sources ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE sources ADD COLUMN source_public_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE messages ADD COLUMN sender_public_key TEXT NOT NULL DEFAULT ''",
  ]) {
    try { sqlite.exec(col) } catch { /* already exists */ }
  }

  return {
    close() { sqlite.close() },

    query(sql: string) {
      return sqlite.query(sql) as { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }
    },

    insertSource(
      codenameHash: string,
      codenameHmac: string,
      displayName: string,
      sourcePublicKey: string
    ): string {
      const id = randomUUID()
      sqlite
        .query(
          "INSERT INTO sources (id, codename_hash, codename_hmac, display_name, source_public_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(id, codenameHash, codenameHmac, displayName, sourcePublicKey, Date.now())
      return id
    },

    insertSubmission(sourceId: string, encryptedText: string | null): string {
      const id = randomUUID()
      sqlite
        .query("INSERT INTO submissions (id, source_id, encrypted_text, submitted_at) VALUES (?, ?, ?, ?)")
        .run(id, sourceId, encryptedText, Date.now())
      return id
    },

    insertSubmissionFile(
      submissionId: string,
      encryptedFilename: string,
      encryptedDek: string,
      filePath: string
    ): string {
      const id = randomUUID()
      sqlite
        .query(
          "INSERT INTO submission_files (id, submission_id, encrypted_filename, encrypted_dek, file_path, submitted_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(id, submissionId, encryptedFilename, encryptedDek, filePath, Date.now())
      return id
    },

    insertMessage(
      submissionId: string,
      direction: "source" | "journalist",
      encryptedBody: string,
      senderPublicKey: string
    ): string {
      const id = randomUUID()
      sqlite
        .query(
          "INSERT INTO messages (id, submission_id, direction, encrypted_body, sender_public_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(id, submissionId, direction, encryptedBody, senderPublicKey, Date.now())
      return id
    },

    getMessages(submissionId: string): Message[] {
      return sqlite
        .query("SELECT * FROM messages WHERE submission_id = ? ORDER BY created_at ASC")
        .all(submissionId) as Message[]
    },

    getSourceByHmac(hmac: string): Source | null {
      return sqlite
        .query("SELECT * FROM sources WHERE codename_hmac = ?")
        .get(hmac) as Source | null
    },
  }
}
