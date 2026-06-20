# Video Upload & Publishing — Design Spec

**Date:** 2026-06-20
**Status:** Approved

---

## Overview

Add end-to-end video support: sources submit video evidence (up to 2 GB) via the source portal; journalists upload their own footage via a dedicated workspace library; editors/admins publish video reports as standalone HLS pages on the publication site.

---

## Approach

**Encrypt-at-upload, transcode-at-publish (Option A).**
Source portal does not transcode — it strips metadata and stream-encrypts to disk. The workspace transcodes to HLS only when an editor/admin explicitly publishes. This keeps source submission fast and the portal simple.

---

## 1. Streaming Encryption for Large Files

**Problem:** Current `readFileSync + encryptData` loads the entire file into memory. A 2 GB video exhausts memory.

**Solution:** libsodium `crypto_secretstream_xchacha20poly1305` — designed for streaming authenticated encryption of arbitrary-length data.

**Format on disk:**
```
[4-byte magic: 0x00 0x53 0x45 0x43]   ← "SEC" marker, distinguishes from old format
[24-byte secretstream header]
[encrypted chunk 1 ... encrypted chunk N]
```
Each chunk is 4 MB of plaintext encrypted to ~4 MB + 17-byte MAC.

**New functions in `packages/shared/src/crypto.ts`:**
```typescript
encryptStreamToFile(sourcePath: string, destPath: string, key: Uint8Array): Promise<void>
decryptStreamToWritable(sourcePath: string, dest: Writable, key: Uint8Array): Promise<void>
isSecretStream(filePath: string): boolean  // reads magic header
```

**Backward compatibility:** Files without the magic header use the existing single-shot decrypt path. New files over 64 MB use secretstream; smaller files continue using single-shot.

**Key:** The per-file DEK is still sealed with the newsroom public key (same `sealedBoxEncrypt` pattern). Only the body encryption method changes.

---

## 2. Source Portal — Video Submission

### File size limit
Multer raised from 256 MB to **2 GB** (`limits: { fileSize: 2 * 1024 * 1024 * 1024 }`).

### Video metadata stripping (`stripMetadata.ts`)
New video path alongside existing image path:

**Supported video extensions:** `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`, `.mts`, `.ts`, `.wmv`

**Strip method:** Re-mux via ffmpeg, removing all container metadata:
```
ffmpeg -i input -map_metadata -1 -map_chapters -1 -c:v copy -c:a copy output
```
This strips GPS, device serial, creation timestamps, encoder strings, camera model — without re-encoding (fast, lossless quality).

**Fallback:** If ffmpeg is not available, video passes through unstripped with `console.warn`. Same pattern as sharp for images.

**File type detection:** Extension + first-bytes magic number (not extension alone).

### Encryption
Files ≥ 64 MB use `encryptStreamToFile`. Files < 64 MB use existing `encryptData`. Magic header determines decryption path at read time.

### No transcoding on source portal
Sources wait only for: upload + metadata strip + stream-encrypt. No ffmpeg transcoding delay.

---

## 3. Workspace — Video Playback

### New endpoint: `GET /api/cases/[id]/files/[index]/stream`
- Authenticates session + `canAccessCase` ownership check
- Reads encrypted file path + sealed DEK from `portal-db.ts`
- Detects format (magic header → secretstream or legacy single-shot)
- Decrypts and streams plaintext bytes with `Content-Type: video/mp4` (or detected MIME)
- Progressive playback only — no Range/seek support (sufficient for evidence review)

### Workspace case detail UI
Video files get a **"▶ Watch"** button alongside the existing download link. Clicking opens a modal with `<video src="/api/cases/[id]/files/[index]/stream" controls>`.

### Journalist-uploaded video stream
`GET /api/videos/[id]/stream` — same decrypt logic, file at `/var/secure-videos/[id].enc`.

---

## 4. Journalist Video Uploads

### New DB table — workspace Postgres

```sql
CREATE TABLE IF NOT EXISTS videos (
  id            TEXT PRIMARY KEY,
  title_enc     TEXT NOT NULL,
  title_dek     TEXT NOT NULL,
  desc_enc      TEXT,
  desc_dek      TEXT,
  source_type   TEXT NOT NULL CHECK(source_type IN ('submission','upload')),
  -- source_type='submission': links to a portal case file
  submission_id TEXT,
  file_index    INTEGER,
  -- source_type='upload': journalist's own file
  upload_path   TEXT,
  upload_dek    TEXT,
  duration_secs INTEGER,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft','processing','published')),
  published_at  TIMESTAMPTZ,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`title_enc` / `title_dek` follow the same masterKey-wrapped DEK encryption pattern as case notes. `upload_dek` is a sealed DEK (newsroom public key) like submission files.

### New API routes — `packages/journalist-workspace/src/app/api/videos/`

| Route | Method | Roles | Action |
|---|---|---|---|
| `/api/videos` | GET | J/E/A | List videos — journalist sees own only; editor/admin see all |
| `/api/videos` | POST | J/A | Create video report linked to a case submission file |
| `/api/videos/upload` | POST | J/A | Upload journalist's own video (streaming, ≤ 2 GB) |
| `/api/videos/[id]` | GET | J/E/A | Get video detail |
| `/api/videos/[id]` | PUT | J/A (owner) | Update title/description |
| `/api/videos/[id]` | DELETE | J/A (owner) | Delete — only draft/processing; not published |
| `/api/videos/[id]/stream` | GET | J/E/A | Stream decrypted video for playback |
| `/api/videos/[id]/publish` | POST | E/A | Trigger transcode + HLS publish |
| `/api/videos/[id]/retract` | POST | E/A | Remove from publication, reset to draft |

### Upload flow
1. Browser POSTs multipart to `/api/videos/upload`
2. Server streams to temp path → `encryptStreamToFile` → `/var/secure-videos/[id].enc`
3. Sealed DEK stored in `videos.upload_dek`
4. Returns `{ videoId }`. Title/description added via PUT.

### Creating a video report from a source case file
From the case detail page, video files have a **"Create video report"** button. This calls `POST /api/videos` with `{ source_type: "submission", submissionId, fileIndex }`. The video appears in the library under "From sources" tab.

### Workspace video library page — `src/app/videos/page.tsx`
Unified list with tabs: **All / From sources / My uploads / Published**. Each row shows thumbnail (once published), title, source, duration, status badge, and action buttons (Watch, Publish, Delete).

---

## 5. Transcode + Publish Pipeline

### New file: `packages/journalist-workspace/src/lib/transcode.ts`

**`publishVideo(videoId, globals)`** — called by `POST /api/videos/[id]/publish`:

```
1. Set status → "processing"
2. Resolve encrypted file:
   - submission: read file_path from portal SQLite, sealed DEK via portal-db
   - upload: read upload_path, sealed DEK from videos.upload_dek
3. Decrypt stream → pipe to ffmpeg stdin
4. ffmpeg HLS transcode (three parallel passes or single-pass with -filter_complex):
   - 1080p: scale=-2:1080, -b:v 4000k, -maxrate 4400k, -bufsize 8800k
   - 720p:  scale=-2:720,  -b:v 2000k, -maxrate 2200k, -bufsize 4400k
   - 480p:  scale=-2:480,  -b:v 800k,  -maxrate 880k,  -bufsize 1760k
   - Audio: -c:a aac -b:a 128k
   - Segments: -hls_time 4 -hls_playlist_type vod
5. Extract thumbnail: ffmpeg -ss 00:00:03 -vframes 1 thumbnail.jpg
6. Write master.m3u8 linking all three quality playlists
7. Generate publication/videos/[id]/index.html (see §6)
8. Upsert entry in publication/video-index.html
9. Set status → "published", published_at → NOW()
```

**Background execution:** `POST /api/videos/[id]/publish` sets status to `"processing"` and returns `{ ok: true, status: "processing" }` immediately. The transcode runs in a `setImmediate` callback. Client polls `GET /api/videos/[id]` until `status === "published"`.

**Output directory:**
```
publication/videos/[id]/
  index.html
  master.m3u8
  thumbnail.jpg
  1080p/  playlist.m3u8  seg001.ts  seg002.ts  …
  720p/   playlist.m3u8  seg001.ts  …
  480p/   playlist.m3u8  seg001.ts  …
```

**Retraction (`POST /api/videos/[id]/retract`):** Deletes `publication/videos/[id]/` directory, removes entry from `video-index.html`, sets status → `"draft"`.

---

## 6. Publication Site

### `publish.ts` additions

**`publishVideoReport(opts)`** — generates `publication/videos/[id]/index.html`:

**Page layout (approved design B — hero player first):**
```
[Site header — logo + Reports | Videos nav]
[Full-width HLS video player — title overlaid at bottom of hero]
[Quality bar — Auto / 1080p / 720p / 480p + "Verified · Metadata stripped" badge]
[Georgian serif description — lede style with green left-border]
[Footer — ← All videos | "This site is only accessible over Tor."]
```

**`updateVideoIndex(publicationDir)`** — generates/updates `publication/video-index.html`:
- Lists all published video reports newest-first
- Thumbnail, title, duration, publication date, "Watch →" link

### `publication/hls.min.js`
hls.js bundled locally (no CDN). Committed to repo. Video report pages load it via `<script src="/hls.min.js">`. This is critical for Tor onion sites where CDN requests are unreliable.

### Navigation update
`publication/index.html` (article index) gains a **"Videos →"** link in the site header pointing to `video-index.html`.

---

## 7. File Layout Summary

**New source portal files:**
- `packages/source-portal/src/stripMetadata.ts` — video path added

**New shared files:**
- `packages/shared/src/crypto.ts` — `encryptStreamToFile`, `decryptStreamToWritable`, `isSecretStream`

**New workspace files:**
- `packages/journalist-workspace/src/lib/transcode.ts`
- `packages/journalist-workspace/src/app/api/videos/route.ts`
- `packages/journalist-workspace/src/app/api/videos/upload/route.ts`
- `packages/journalist-workspace/src/app/api/videos/[id]/route.ts`
- `packages/journalist-workspace/src/app/api/videos/[id]/stream/route.ts`
- `packages/journalist-workspace/src/app/api/videos/[id]/publish/route.ts`
- `packages/journalist-workspace/src/app/api/videos/[id]/retract/route.ts`
- `packages/journalist-workspace/src/app/api/cases/[id]/files/[index]/stream/route.ts`
- `packages/journalist-workspace/src/app/videos/page.tsx`

**Modified workspace files:**
- `packages/journalist-workspace/src/lib/db.ts` — `videos` table + CRUD methods
- `packages/journalist-workspace/src/app/api/cases/[id]/files/[index]/route.ts` — "Watch" button response hint

**Modified publication files:**
- `packages/journalist-workspace/src/lib/publish.ts` — `publishVideoReport`, `updateVideoIndex`
- `publication/hls.min.js` (committed static asset)

---

## 8. Dependencies

| Package | Where | Purpose |
|---|---|---|
| `ffmpeg` | System (both servers) | Metadata strip (portal), HLS transcode (workspace) |
| `hls.js` | `publication/hls.min.js` | Browser HLS playback on publication site |
| libsodium secretstream | Already installed | Streaming encryption |

No new npm packages required. libsodium-wrappers-sumo is already installed.

---

## 9. Security Notes

- Video metadata stripped before encryption (GPS, device serial, creation time)
- Encrypted files use sealed DEK (newsroom public key) — same trust model as documents
- HLS segments are **plaintext** in the publication directory — same as published articles
- Journalist workspace streams plaintext video over local authenticated session only
- `hls.min.js` committed to repo — no external CDN requests from publication site
- `/var/secure-videos/` permissions: `700`, owned by service user
