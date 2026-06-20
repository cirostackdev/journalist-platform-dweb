import { Pool } from "pg"
import { randomUUID } from "crypto"

export type Role = "admin" | "journalist" | "editor"
export type CaseStatus = "new" | "active" | "closed"
export type ArticleStatus = "draft" | "review" | "published"

export type VideoStatus = "draft" | "processing" | "published"

export type Video = {
  id: string
  title_enc: string
  title_dek: string
  desc_enc: string | null
  desc_dek: string | null
  source_type: "submission" | "upload"
  submission_id: string | null
  file_index: number | null
  upload_path: string | null
  upload_dek: string | null
  duration_secs: number | null
  status: VideoStatus
  published_at: Date | null
  created_by: string
  created_at: Date
}

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
  title_enc: string | null
  title_dek: string | null
  encrypted_body: string | null
  encrypted_dek: string | null
  status: ArticleStatus
  published_at: string | null
  created_at: string
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
  updateArticle(id: string, encryptedBody: string, encryptedDek: string, titleEnc?: string, titleDek?: string): Promise<void>
  updateArticleStatus(id: string, status: ArticleStatus): Promise<void>
  publishArticle(id: string): Promise<void>
  deleteArticle(id: string): Promise<void>
  insertVideo(opts: {
    titleEnc: string; titleDek: string
    descEnc?: string | null; descDek?: string | null
    sourceType: "submission" | "upload"
    submissionId?: string | null; fileIndex?: number | null
    uploadPath?: string | null; uploadDek?: string | null
    durationSecs?: number | null
    createdBy: string
  }): Promise<string>
  getVideo(id: string): Promise<Video | null>
  getVideos(filter?: { createdBy?: string }): Promise<Video[]>
  updateVideo(id: string, titleEnc: string, titleDek: string, descEnc: string | null, descDek: string | null): Promise<void>
  updateVideoStatus(id: string, status: VideoStatus, publishedAt?: Date | null): Promise<void>
  deleteVideo(id: string): Promise<void>
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
    title_enc TEXT,
    title_dek TEXT,
    encrypted_body TEXT,
    encrypted_dek TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review', 'published')),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE articles ADD COLUMN IF NOT EXISTS title_enc TEXT;
  ALTER TABLE articles ADD COLUMN IF NOT EXISTS title_dek TEXT;

  CREATE TABLE IF NOT EXISTS videos (
    id            TEXT PRIMARY KEY,
    title_enc     TEXT NOT NULL,
    title_dek     TEXT NOT NULL,
    desc_enc      TEXT,
    desc_dek      TEXT,
    source_type   TEXT NOT NULL CHECK(source_type IN ('submission','upload')),
    submission_id TEXT,
    file_index    INTEGER,
    upload_path   TEXT,
    upload_dek    TEXT,
    duration_secs INTEGER,
    status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK(status IN ('draft','processing','published')),
    published_at  TIMESTAMPTZ,
    created_by    TEXT NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    async updateArticle(id, encryptedBody, encryptedDek, titleEnc?, titleDek?) {
      if (titleEnc !== undefined && titleDek !== undefined) {
        await pool.query(
          "UPDATE articles SET encrypted_body = $1, encrypted_dek = $2, title_enc = $3, title_dek = $4 WHERE id = $5",
          [encryptedBody, encryptedDek, titleEnc, titleDek, id]
        )
      } else {
        await pool.query(
          "UPDATE articles SET encrypted_body = $1, encrypted_dek = $2 WHERE id = $3",
          [encryptedBody, encryptedDek, id]
        )
      }
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

    async insertVideo(opts) {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO videos (id,title_enc,title_dek,desc_enc,desc_dek,source_type,
          submission_id,file_index,upload_path,upload_dek,duration_secs,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, opts.titleEnc, opts.titleDek, opts.descEnc ?? null, opts.descDek ?? null,
         opts.sourceType, opts.submissionId ?? null, opts.fileIndex ?? null,
         opts.uploadPath ?? null, opts.uploadDek ?? null, opts.durationSecs ?? null,
         opts.createdBy]
      )
      return id
    },
    async getVideo(id) {
      const res = await pool.query("SELECT * FROM videos WHERE id = $1", [id])
      return (res.rows[0] as Video) ?? null
    },
    async getVideos(filter) {
      if (filter?.createdBy) {
        const res = await pool.query(
          "SELECT * FROM videos WHERE created_by = $1 ORDER BY created_at DESC",
          [filter.createdBy]
        )
        return res.rows as Video[]
      }
      const res = await pool.query("SELECT * FROM videos ORDER BY created_at DESC")
      return res.rows as Video[]
    },
    async updateVideo(id, titleEnc, titleDek, descEnc, descDek) {
      await pool.query(
        "UPDATE videos SET title_enc=$1,title_dek=$2,desc_enc=$3,desc_dek=$4 WHERE id=$5",
        [titleEnc, titleDek, descEnc, descDek, id]
      )
    },
    async updateVideoStatus(id, status, publishedAt) {
      await pool.query(
        "UPDATE videos SET status=$1, published_at=$2 WHERE id=$3",
        [status, publishedAt ?? null, id]
      )
    },
    async deleteVideo(id) {
      await pool.query("DELETE FROM videos WHERE id = $1", [id])
    },
  }
}
