import sharp from "sharp"
import { extname } from "path"

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp", ".heic", ".heif", ".avif"])
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"])

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

  if (OFFICE_EXTENSIONS.has(ext)) {
    return {
      data,
      stripped: false,
      warning: `Office file (${ext}) — embedded metadata (author, revision history, tracked changes) NOT stripped. Advise source to use PDF or plain text where possible.`,
    }
  }

  return { data, stripped: false }
}
