import { Pool } from "pg"
import { randomUUID } from "crypto"

export type Role = "admin" | "journalist" | "editor"
export type CaseStatus = "new" | "active" | "closed"
export type ArticleStatus = "draft" | "review" | "published"

export type User = {
  id: string
  username: string
  argon2_hash: string
  totp_secret_enc: string
  role: Role
  created_at: Date
}

export type Case = {
  id: string
  submission_ref: string
  assigned_to: string | null
  status: CaseStatus
  created_at: Date
}

export type CaseNote = {
  id: string
  case_id: string
  author_id: string
  encrypted_body: string
  encrypted_dek: string
  created_at: Date
}

export type Article = {
  id: string
  case_id: string
  author_id: string
  encrypted_body: string | null
  encrypted_dek: string | null
  status: ArticleStatus
  published_at: Date | null
  created_at: Date
}

export interface Db {
  close(): Promise<void>
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  insertUser(username: string, argon2Hash: string, totpSecretEnc: string, role: Role): Promise<string>
  getUserByUsername(username: string): Promise<User | null>
  getUserById(id: string): Promise<User | null>
  insertCase(submissionRef: string): Promise<string>
  getCases(filter?: { assignedTo?: string }): Promise<Case[]>
  getCase(id: string): Promise<Case | null>
  updateCaseStatus(id: string, status: CaseStatus): Promise<void>
  assignCase(id: string, userId: string): Promise<void>
  insertCaseNote(caseId: string, authorId: string, encryptedBody: string, encryptedDek: string): Promise<string>
  getCaseNotes(caseId: string): Promise<CaseNote[]>
  insertArticle(caseId: string, authorId: string): Promise<string>
  getArticle(id: string): Promise<Article | null>
  getArticlesByCase(caseId: string): Promise<Article[]>
  updateArticle(id: string, encryptedBody: string, encryptedDek: string): Promise<void>
  updateArticleStatus(id: string, status: ArticleStatus): Promise<void>
  publishArticle(id: string): Promise<void>
  deleteArticle(id: string): Promise<void>
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    argon2_hash TEXT NOT NULL,
    totp_secret_enc TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'journalist', 'editor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    submission_ref TEXT NOT NULL UNIQUE,
    assigned_to TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'active', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS case_notes (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    encrypted_body TEXT NOT NULL,
    encrypted_dek TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    encrypted_body TEXT,
    encrypted_dek TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review', 'published')),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`

export async function openDb(connectionString: string): Promise<Db> {
  const pool = new Pool({ connectionString })
  await pool.query(SCHEMA)

  return {
    async close() { await pool.end() },

    async query(sql: string, params?: unknown[]) {
      const result = await pool.query(sql, params)
      return { rows: result.rows }
    },

    async insertUser(username, argon2Hash, totpSecretEnc, role) {
      const id = randomUUID()
      await pool.query(
        "INSERT INTO users (id, username, argon2_hash, totp_secret_enc, role) VALUES ($1, $2, $3, $4, $5)",
        [id, username, argon2Hash, totpSecretEnc, role]
      )
      return id
    },

    async getUserByUsername(username) {
      const res = await pool.query("SELECT * FROM users WHERE username = $1", [username])
      return (res.rows[0] as User) ?? null
    },

    async getUserById(id) {
      const res = await pool.query("SELECT * FROM users WHERE id = $1", [id])
      return (res.rows[0] as User) ?? null
    },

    async insertCase(submissionRef) {
      const id = randomUUID()
      await pool.query(
        "INSERT INTO cases (id, submission_ref) VALUES ($1, $2)",
        [id, submissionRef]
      )
      return id
    },

    async getCases(filter) {
      if (filter?.assignedTo) {
        const res = await pool.query(
          "SELECT * FROM cases WHERE assigned_to = $1 ORDER BY created_at DESC",
          [filter.assignedTo]
        )
        return res.rows as Case[]
      }
      const res = await pool.query("SELECT * FROM cases ORDER BY created_at DESC")
      return res.rows as Case[]
    },

    async getCase(id) {
      const res = await pool.query("SELECT * FROM cases WHERE id = $1", [id])
      return (res.rows[0] as Case) ?? null
    },

    async updateCaseStatus(id, status) {
      await pool.query("UPDATE cases SET status = $1 WHERE id = $2", [status, id])
    },

    async assignCase(id, userId) {
      await pool.query("UPDATE cases SET assigned_to = $1, status = 'active' WHERE id = $2", [userId, id])
    },

    async insertCaseNote(caseId, authorId, encryptedBody, encryptedDek) {
      const id = randomUUID()
      await pool.query(
        "INSERT INTO case_notes (id, case_id, author_id, encrypted_body, encrypted_dek) VALUES ($1, $2, $3, $4, $5)",
        [id, caseId, authorId, encryptedBody, encryptedDek]
      )
      return id
    },

    async getCaseNotes(caseId) {
      const res = await pool.query(
        "SELECT * FROM case_notes WHERE case_id = $1 ORDER BY created_at ASC",
        [caseId]
      )
      return res.rows as CaseNote[]
    },

    async insertArticle(caseId, authorId) {
      const id = randomUUID()
      await pool.query(
        "INSERT INTO articles (id, case_id, author_id) VALUES ($1, $2, $3)",
        [id, caseId, authorId]
      )
      return id
    },

    async getArticle(id) {
      const res = await pool.query("SELECT * FROM articles WHERE id = $1", [id])
      return (res.rows[0] as Article) ?? null
    },

    async getArticlesByCase(caseId) {
      const res = await pool.query("SELECT * FROM articles WHERE case_id = $1 ORDER BY created_at DESC", [caseId])
      return res.rows as Article[]
    },

    async updateArticle(id, encryptedBody, encryptedDek) {
      await pool.query(
        "UPDATE articles SET encrypted_body = $1, encrypted_dek = $2 WHERE id = $3",
        [encryptedBody, encryptedDek, id]
      )
    },

    async updateArticleStatus(id, status) {
      await pool.query("UPDATE articles SET status = $1 WHERE id = $2", [status, id])
    },

    async publishArticle(id) {
      await pool.query(
        "UPDATE articles SET status = 'published', published_at = NOW() WHERE id = $1",
        [id]
      )
    },

    async deleteArticle(id) {
      await pool.query("DELETE FROM articles WHERE id = $1", [id])
    },
  }
}
