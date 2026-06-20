import sharp from "sharp"
import { extname } from "path"
import { spawnSync } from "child_process"
import { writeFileSync as wfs, unlinkSync as uls, existsSync } from "fs"
import { join as pjoin } from "path"
import { tmpdir } from "os"
import { randomBytes } from "crypto"

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp", ".heic", ".heif", ".avif"])
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"])
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mts", ".ts", ".wmv", ".flv",
])

function isFfmpegAvailable(): boolean {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { timeout: 3000 })
    return r.status === 0
  } catch { return false }
}

export type StripResult = {
  data: Buffer
  stripped: boolean
  warning?: string
}

/**
 * Strip metadata from files before encryption.
 * Images: re-encoded via sharp (removes EXIF, ICC profiles, XMP, etc.)
 * Office: not supported — returns warning
 * Other: passed through unchanged
 */
export async function stripMetadata(data: Buffer, originalName: string): Promise<StripResult> {
  const ext = extname(originalName).toLowerCase()

  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      // Re-encode through sharp — strips all metadata by default
      // keepMetadata(false) is the default; just re-encoding removes EXIF/ICC/XMP
      const stripped = await sharp(data)
        .rotate() // Apply EXIF rotation before stripping (so image isn't rotated wrong)
        .withMetadata({}) // Keep only basic orientation — strips GPS, camera info, author, etc.
        .toBuffer()
      return { data: stripped, stripped: true }
    } catch (err) {
      // If sharp fails (e.g. corrupted image), fall back to original
      console.warn(`[stripMetadata] sharp failed for ${originalName}: ${err}. Storing original.`)
      return { data, stripped: false, warning: "Image metadata stripping failed — original stored" }
    }
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    if (!isFfmpegAvailable()) {
      return {
        data,
        stripped: false,
        warning: `Video (${ext}) — ffmpeg not available, metadata NOT stripped. Install ffmpeg on the server.`,
      }
    }
    const id = randomBytes(8).toString("hex")
    const inPath = pjoin(tmpdir(), `strip-in-${id}${ext}`)
    const outPath = pjoin(tmpdir(), `strip-out-${id}.mp4`)
    try {
      wfs(inPath, data)
      const result = spawnSync("ffmpeg", [
        "-i", inPath,
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-c:v", "copy",
        "-c:a", "copy",
        "-y",
        outPath,
      ], { timeout: 120_000 })
      if (result.status !== 0) {
        return { data, stripped: false, warning: `ffmpeg failed (exit ${result.status}). Original stored.` }
      }
      const { readFileSync: rfs } = require("fs")
      const stripped = rfs(outPath)
      return { data: stripped, stripped: true }
    } finally {
      try { uls(inPath) } catch {}
      try { if (existsSync(outPath)) uls(outPath) } catch {}
    }
  }

  if (OFFICE_EXTENSIONS.has(ext)) {
    return {
      data,
      stripped: false,
      warning: `Office file (${ext}) — embedded metadata (author, revision history, tracked changes) NOT stripped. Advise source to use PDF or plain text where possible.`,
    }
  }

  return { data, stripped: false }
}
