import path from "node:path"

/**
 * Reading and writing text the way the file was: Windows PowerShell 5.1 writes UTF-16LE
 * with a BOM (`Out-File`, `>`), Notepad may add a UTF-8 BOM, Excel exports CRLF. The edit
 * tools write back in the same encoding and line endings (Claude Code writeTextContent).
 */

export type Encoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be"

export interface Decoded {
  text: string
  encoding: Encoding
  /** Line ending most of the file uses. */
  eol: "\n" | "\r\n"
}

export function decodeFile(bytes: Uint8Array): Decoded {
  let encoding: Encoding = "utf8"
  let text: string
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = "utf8-bom"
    text = new TextDecoder("utf-8").decode(bytes.subarray(3))
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf16le"
    text = new TextDecoder("utf-16le").decode(bytes.subarray(2))
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf16be"
    text = new TextDecoder("utf-16be").decode(bytes.subarray(2))
  } else text = new TextDecoder("utf-8").decode(bytes)
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return { text, encoding, eol: crlf > lf ? "\r\n" : "\n" }
}

export function encodeFile(text: string, encoding: Encoding): Uint8Array {
  if (encoding === "utf8") return new TextEncoder().encode(text)
  if (encoding === "utf8-bom") return new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])
  const out = new Uint8Array(2 + text.length * 2)
  const le = encoding === "utf16le"
  out[0] = le ? 0xff : 0xfe
  out[1] = le ? 0xfe : 0xff
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out[2 + i * 2] = le ? code & 0xff : code >> 8
    out[3 + i * 2] = le ? code >> 8 : code & 0xff
  }
  return out
}

const BINARY_EXT = new Set(
  [
    "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "exe", "dll", "so", "dylib", "bin", "msi", "iso", "dmg", "class", "jar", "war",
    "wasm", "pyc", "pyo", "o", "a", "lib", "obj", "db", "sqlite", "sqlite3", "mdb", "accdb", "doc", "xls", "ppt", "pptx", "odt", "ods",
    "mp3", "mp4", "m4a", "wav", "flac", "ogg", "avi", "mov", "mkv", "webm", "bmp", "ico", "tif", "tiff", "psd", "ttf", "otf", "woff", "woff2",
    "eot", "parquet", "feather", "pkl", "pickle", "npy", "npz", "h5",
  ],
)

/**
 * Binary by extension, or by content: a NUL byte or more than 30% control characters in
 * the first 4 KB (opencode read.ts). UTF-16 text has NULs, so a BOM marks it as text.
 */
export function isBinary(file: string, sample: Uint8Array): boolean {
  if (BINARY_EXT.has(path.extname(file).slice(1).toLowerCase())) return true
  if ((sample[0] === 0xff && sample[1] === 0xfe) || (sample[0] === 0xfe && sample[1] === 0xff)) return false
  const head = sample.subarray(0, 4096)
  if (head.length === 0) return false
  let control = 0
  for (const byte of head) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) control++
  }
  return control / head.length > 0.3
}

/** Split into lines without the line endings; a final newline does not add an empty line. */
export function splitLines(text: string): string[] {
  if (text === "") return []
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  return lines
}
