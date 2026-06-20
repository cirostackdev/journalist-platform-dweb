import { mkdirSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { PassThrough } from "stream"
import { spawn } from "child_process"
import type { Globals } from "./globals"
import {
  sealedBoxDecrypt, decryptData,
  isSecretStream, decryptStreamToWritable,
} from "@journalist/shared/crypto"
import { getFileForDownload } from "./portal-db"

export function isFfmpegAvailable(): boolean {
  try {
    const { spawnSync } = require("child_process")
    const r = spawnSync("ffmpeg", ["-version"], { timeout: 3000 })
    return r.status === 0
  } catch { return false }
}

type VideoRecord = {
  source_type: string
  upload_path: string | null
  upload_dek: string | null
  submission_id: string | null
  file_index: number | null
}

async function buildDecryptStream(video: VideoRecord, globals: Globals): Promise<PassThrough> {
  const { newsroomPublicKey, newsroomPrivateKey, portalDbPath } = globals
  const pass = new PassThrough()

  if (video.source_type === "upload") {
    if (!video.upload_path || !video.upload_dek) throw new Error("Missing upload_path or upload_dek")
    const dek = await sealedBoxDecrypt(video.upload_dek, newsroomPublicKey, newsroomPrivateKey)
    if (isSecretStream(video.upload_path)) {
      decryptStreamToWritable(video.upload_path, pass, new Uint8Array(dek)).catch(err => pass.destroy(err))
    } else {
      const { readFileSync } = require("fs")
      const enc = readFileSync(video.upload_path, "utf8")
      const plain = await decryptData(enc, new Uint8Array(dek))
      pass.end(plain)
    }
  } else {
    if (video.submission_id == null || video.file_index == null) throw new Error("Missing submission_id or file_index")
    const fileInfo = await getFileForDownload(video.submission_id, video.file_index, portalDbPath)
    if (!fileInfo) throw new Error("Source file not found in portal DB")
    const dek = await sealedBoxDecrypt(fileInfo.sealedDek, newsroomPublicKey, newsroomPrivateKey)
    if (isSecretStream(fileInfo.encFilePath)) {
      decryptStreamToWritable(fileInfo.encFilePath, pass, new Uint8Array(dek)).catch(err => pass.destroy(err))
    } else {
      const { readFileSync } = require("fs")
      const enc = readFileSync(fileInfo.encFilePath, "utf8")
      const plain = await decryptData(enc, new Uint8Array(dek))
      pass.end(plain)
    }
  }
  return pass
}

export type TranscodeResult = { ok: true } | { ok: false; error: string }

export async function transcodeToHls(
  videoId: string,
  video: VideoRecord,
  globals: Globals
): Promise<TranscodeResult> {
  const outDir = join(globals.publicationDir, "videos", videoId)
  mkdirSync(join(outDir, "1080p"), { recursive: true })
  mkdirSync(join(outDir, "720p"), { recursive: true })
  mkdirSync(join(outDir, "480p"), { recursive: true })

  const decryptStream = await buildDecryptStream(video, globals)

  const ffmpegProc = spawn("ffmpeg", [
    "-i", "pipe:0",
    "-filter_complex",
    "[0:v]split=3[v1][v2][v3]; [v1]scale=-2:1080[out1080]; [v2]scale=-2:720[out720]; [v3]scale=-2:480[out480]",
    // 1080p
    "-map", "[out1080]", "-map", "0:a?",
    "-c:v:0", "libx264", "-b:v:0", "4000k", "-maxrate:v:0", "4400k", "-bufsize:v:0", "8800k",
    "-c:a:0", "aac", "-b:a:0", "128k",
    "-hls_time", "4", "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(outDir, "1080p", "seg%03d.ts"),
    join(outDir, "1080p", "playlist.m3u8"),
    // 720p
    "-map", "[out720]", "-map", "0:a?",
    "-c:v:1", "libx264", "-b:v:1", "2000k", "-maxrate:v:1", "2200k", "-bufsize:v:1", "4400k",
    "-c:a:1", "aac", "-b:a:1", "128k",
    "-hls_time", "4", "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(outDir, "720p", "seg%03d.ts"),
    join(outDir, "720p", "playlist.m3u8"),
    // 480p
    "-map", "[out480]", "-map", "0:a?",
    "-c:v:2", "libx264", "-b:v:2", "800k", "-maxrate:v:2", "880k", "-bufsize:v:2", "1760k",
    "-c:a:2", "aac", "-b:a:2", "96k",
    "-hls_time", "4", "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(outDir, "480p", "seg%03d.ts"),
    join(outDir, "480p", "playlist.m3u8"),
  ], { stdio: ["pipe", "pipe", "pipe"] })

  decryptStream.pipe(ffmpegProc.stdin)

  await new Promise<void>((resolve, reject) => {
    ffmpegProc.on("close", (code: number | null) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
    ffmpegProc.on("error", reject)
  })

  // Write master playlist
  const master = [
    "#EXTM3U", "",
    '#EXT-X-STREAM-INF:BANDWIDTH=4128000,RESOLUTION=1920x1080,NAME="1080p"',
    "1080p/playlist.m3u8", "",
    '#EXT-X-STREAM-INF:BANDWIDTH=2128000,RESOLUTION=1280x720,NAME="720p"',
    "720p/playlist.m3u8", "",
    '#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=854x480,NAME="480p"',
    "480p/playlist.m3u8",
  ].join("\n")
  writeFileSync(join(outDir, "master.m3u8"), master)

  // Extract thumbnail (non-fatal)
  try {
    const thumbStream = await buildDecryptStream(video, globals)
    const thumbProc = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-ss", "00:00:03",
      "-vframes", "1",
      "-q:v", "3",
      "-y",
      join(outDir, "thumbnail.jpg"),
    ], { stdio: ["pipe", "pipe", "pipe"] })
    thumbStream.pipe(thumbProc.stdin)
    await new Promise<void>((resolve) => { thumbProc.on("close", () => resolve()) })
  } catch (err) {
    console.warn("[transcode] thumbnail extraction failed:", err)
  }

  return { ok: true }
}
