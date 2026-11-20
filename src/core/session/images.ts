import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ModelMessage } from "ai"

/**
 * The images a user sent, kept next to the session so `--resume` gives them back to the model (#344).
 *
 * The JSONL line keeps the text placeholder it always had (stripImages), so an older `ot` and any
 * reader of the file see what they saw before; the line adds `images`, which names each image by its
 * sha256 in `<session>.images/` beside the session file. Loading puts the image back where its
 * placeholder is; a missing or unreadable file leaves the placeholder.
 *
 * Only images the user attached are kept, not images in tool results. Each file is written once (by
 * hash), private to the user where the OS has modes (0700 folder, 0600 files; on Windows the data
 * folder's own ACL applies). Over IMAGE_MAX_BYTES, or past SESSION_IMAGES_MAX_BYTES for the session,
 * an image stays a placeholder. `sessions.images: false` in config.json turns this off.
 */

/** One image of one stored entry: the message it is in (0 for a `message` line) and its part. */
export interface ImageRef {
  message: number
  part: number
  sha256: string
  mediaType: string
}

/** An image found in a turn, not yet on disk. */
export interface PendingImage extends ImageRef {
  bytes: Buffer
}

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const SESSION_IMAGES_MAX_BYTES = 50 * 1024 * 1024

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp" }
const ext = (mediaType: string) => EXT[mediaType.toLowerCase()] ?? "img"

/** The folder of a session's images: `2026/09/<id>.jsonl` → `2026/09/<id>.images`. */
export const imagesDirOf = (sessionFile: string) => sessionFile.replace(/\.jsonl$/, "") + ".images"

const fileOf = (dir: string, ref: Pick<ImageRef, "sha256" | "mediaType">) => path.join(dir, `${ref.sha256}.${ext(ref.mediaType)}`)

/** The bytes of an image part the user attached; undefined for a URL or anything else. */
function bytesOf(image: unknown): Buffer | undefined {
  if (image instanceof Uint8Array) return Buffer.from(image)
  if (image instanceof ArrayBuffer) return Buffer.from(new Uint8Array(image))
  if (typeof image !== "string") return undefined
  const data = image.startsWith("data:") ? image.slice(image.indexOf(",") + 1) : image
  // A URL is not something we hold; base64 is the only other string form.
  if (/^[a-z]+:\/\//i.test(data) || !/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 256))) return undefined
  const bytes = Buffer.from(data, "base64")
  return bytes.length > 0 ? bytes : undefined
}

/** The user images of `messages` (index = position in the list), in order. */
export function userImages(messages: readonly ModelMessage[]): PendingImage[] {
  const out: PendingImage[] = []
  messages.forEach((m, message) => {
    if (m.role !== "user" || typeof m.content === "string") return
    m.content.forEach((p, part) => {
      if (p.type !== "image") return
      const bytes = bytesOf(p.image)
      if (!bytes || bytes.length > IMAGE_MAX_BYTES) return
      out.push({ message, part, bytes, mediaType: p.mediaType ?? "image/png", sha256: createHash("sha256").update(bytes).digest("hex") })
    })
  })
  return out
}

/** What the session's image folder already holds, in bytes (0 when it does not exist yet). */
export async function storedBytes(dir: string): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[])
  let total = 0
  for (const name of names) total += (await stat(path.join(dir, name)).catch(() => undefined))?.size ?? 0
  return total
}

/**
 * Writes the images not on disk yet, within `room` bytes; returns the refs of the images that are
 * stored (written now or before) and the bytes written. A write that fails leaves that image a
 * placeholder, never the turn unsaved.
 */
export async function writeImages(dir: string, images: readonly PendingImage[], room: number): Promise<{ refs: ImageRef[]; written: number }> {
  const refs: ImageRef[] = []
  let written = 0
  if (images.length === 0) return { refs, written }
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
  } catch {
    return { refs, written }
  }
  for (const { bytes, ...ref } of images) {
    const file = fileOf(dir, ref)
    const known = await stat(file).catch(() => undefined)
    if (known?.isFile() && known.size === bytes.length) {
      refs.push(ref)
      continue
    }
    if (written + bytes.length > room) continue
    try {
      await writeFile(file, bytes, { flag: "wx", mode: 0o600 })
      written += bytes.length
      refs.push(ref)
    } catch (error) {
      // Written meanwhile by another turn of this session: the same bytes, by hash.
      if ((error as NodeJS.ErrnoException).code === "EEXIST") refs.push(ref)
    }
  }
  return { refs, written }
}

/**
 * Puts stored images back in place of their placeholders (copies; `messages` is not changed). A ref
 * whose file is gone, or whose part is not a placeholder any more, is skipped.
 */
export function restoreImages(messages: ModelMessage[], refs: unknown, dir: string): ModelMessage[] {
  if (!Array.isArray(refs) || refs.length === 0) return messages
  const out = [...messages]
  for (const ref of refs as Partial<ImageRef>[]) {
    if (!Number.isInteger(ref.message) || !Number.isInteger(ref.part) || typeof ref.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(ref.sha256) || typeof ref.mediaType !== "string") continue
    const m = out[ref.message!]
    if (!m || m.role !== "user" || typeof m.content === "string") continue
    const placeholder = m.content[ref.part!]
    if (placeholder?.type !== "text") continue
    let bytes: Buffer
    try {
      bytes = readFileSync(fileOf(dir, ref as ImageRef))
    } catch {
      continue
    }
    if (createHash("sha256").update(bytes).digest("hex") !== ref.sha256) continue
    const content = [...m.content]
    content[ref.part!] = { type: "image", image: bytes.toString("base64"), mediaType: ref.mediaType }
    out[ref.message!] = { ...m, content }
  }
  return out
}
