import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { FileState, hashBytes } from "../../fs/file-state"
import { readScope } from "../../fs/path-safety"
import { decodeFile, isBinary, splitLines } from "../../fs/text"
import { realish, type Workspace } from "../../fs/workspace"
import type { ToolDef, ToolResult } from "../types"

/**
 * read_file: what the user hands over by path (a broker's PDF report, an Excel export saved
 * as CSV, notes, a screenshot), and later the agent's own artifacts before editing them.
 * Text comes back numbered like `cat -n` (Claude Code FileReadTool), a folder comes back as
 * a listing (opencode read.ts), PDFs page by page, images as images.
 */

export type ReadFileInput = { path: string; offset?: number; limit?: number; pages?: string }

export const MAX_LINES = 2000
export const MAX_LINE_CHARS = 2000
export const MAX_TEXT_CHARS = 60_000
/** Larger text files are refused whole: grep_files finds the part to read with offset/limit. */
export const MAX_TEXT_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_BYTES = 3_750_000
export const MAX_DIR_ENTRIES = 500
export const PDF_DEFAULT_PAGES = 10
export const PDF_MAX_PAGES = 20
const MAX_PDF_BYTES = 100 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }

/** `"3"`, `"1-5"`, `"2,4-6"` → sorted unique 1-based page numbers, or an error. */
export function parsePages(spec: string, total: number): number[] | string {
  const pages = new Set<number>()
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) return `pages "${spec}" không hợp lệ (ví dụ "3", "1-5", "2,4-6").`
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    if (from < 1 || to < from) return `pages "${spec}" không hợp lệ.`
    for (let p = from; p <= Math.min(to, total); p++) pages.add(p)
  }
  if (pages.size === 0) return `PDF chỉ có ${total} trang.`
  return [...pages].sort((a, b) => a - b)
}

async function readPdf(abs: string, bytes: Uint8Array, spec: string | undefined): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf")
  const doc = await getDocumentProxy(bytes)
  const { text, totalPages } = await extractText(doc, { mergePages: false })
  const wanted = spec ? parsePages(spec, totalPages) : Array.from({ length: Math.min(totalPages, PDF_DEFAULT_PAGES) }, (_, i) => i + 1)
  if (typeof wanted === "string") throw new Error(wanted)
  if (wanted.length > PDF_MAX_PAGES) throw new Error(`Tối đa ${PDF_MAX_PAGES} trang mỗi lần; chia pages thành nhiều lần gọi.`)
  const body = wanted.map((p) => `--- Trang ${p} ---\n${String(text[p - 1] ?? "").replace(/[ \t]+\n/g, "\n").trim()}`).join("\n\n")
  const chars = wanted.reduce((n, p) => n + String(text[p - 1] ?? "").trim().length, 0)
  const notes = [
    `PDF ${abs} · ${totalPages} trang · đang hiện trang ${wanted.length === 1 ? wanted[0] : `${wanted[0]}–${wanted.at(-1)}`}${wanted.length > 1 && wanted.at(-1)! - wanted[0]! + 1 !== wanted.length ? ` (${wanted.join(", ")})` : ""}`,
    ...(chars < 50 * wanted.length ? ["Các trang này gần như không có lớp chữ (bản scan): không đọc được nội dung. Nhờ người dùng gửi ảnh chụp trang cần đọc hoặc bản có chữ."] : []),
    ...(!spec && totalPages > wanted.length ? [`Còn ${totalPages - wanted.length} trang; đọc tiếp bằng pages, ví dụ pages="${wanted.length + 1}-${Math.min(totalPages, wanted.length + PDF_DEFAULT_PAGES)}".`] : []),
  ]
  return `${notes.join("\n")}\n\n${body}`
}

async function listDir(abs: string): Promise<string> {
  const entries = await readdir(abs, { withFileTypes: true })
  const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort((a, b) => {
    const da = a.endsWith("/")
    const db = b.endsWith("/")
    return da === db ? a.localeCompare(b) : da ? -1 : 1
  })
  const shown = names.slice(0, MAX_DIR_ENTRIES)
  const more = names.length - shown.length
  return [
    `Thư mục ${abs} · ${entries.filter((e) => e.isDirectory()).length} thư mục, ${entries.filter((e) => !e.isDirectory()).length} file`,
    "",
    ...shown,
    ...(more > 0 ? ["", `(còn ${more} mục; dùng glob_files để lọc)`] : []),
    ...(names.length === 0 ? ["(thư mục trống)"] : []),
  ].join("\n")
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]!
}

/** Up to three names in the same folder that look like the missing one (typo, other extension). */
async function nearNames(abs: string): Promise<string[]> {
  try {
    const stemOf = (n: string) => n.toLowerCase().replace(/\.[^.]+$/, "")
    const want = stemOf(path.basename(abs))
    const names = await readdir(path.dirname(abs))
    return names
      .map((n) => {
        const stem = stemOf(n)
        // ".gitignore" has an empty stem: it would "contain" every name.
        const d = stem && want && (stem.includes(want) || want.includes(stem)) ? 0 : editDistance(stem, want)
        return { n, d }
      })
      .filter((x) => x.d <= Math.max(2, Math.floor(want.length * 0.3)))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((x) => path.join(path.dirname(abs), x.n))
  } catch {
    return []
  }
}

/** Numbered lines from `offset` (1-based), at most `limit` lines and MAX_TEXT_CHARS characters. */
export function numberLines(lines: string[], offset: number, limit: number): { body: string; first: number; last: number } {
  const out: string[] = []
  let chars = 0
  let last = offset - 1
  for (let n = offset; n <= Math.min(lines.length, offset + limit - 1); n++) {
    let line = lines[n - 1]!
    if (line.length > MAX_LINE_CHARS) line = `${line.slice(0, MAX_LINE_CHARS)}… (dòng bị cắt, dài ${line.length} ký tự)`
    const row = `${n}\t${line}`
    if (out.length > 0 && chars + row.length + 1 > MAX_TEXT_CHARS) break
    out.push(row)
    chars += row.length + 1
    last = n
  }
  return { body: out.join("\n"), first: offset, last }
}

export async function readFileAt(abs: string, input: Omit<ReadFileInput, "path">, state?: FileState): Promise<string | ToolResult> {
  let info
  try {
    info = await stat(abs)
  } catch {
    const near = await nearNames(abs)
    throw new Error(`Không có file hoặc thư mục ${abs}.${near.length > 0 ? ` Có phải ý bạn là: ${near.join(" · ")}?` : ""}`)
  }
  if (info.isDirectory()) return listDir(abs)
  const ext = path.extname(abs).toLowerCase()

  const imageType = IMAGE_TYPES[ext]
  if (imageType) {
    if (info.size > MAX_IMAGE_BYTES) throw new Error(`Ảnh ${abs} nặng ${Math.round(info.size / 1024)} KB, quá ${Math.round(MAX_IMAGE_BYTES / 1024)} KB: nhờ người dùng thu nhỏ hoặc cắt ảnh.`)
    const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer())
    return { output: `Ảnh ${abs} (${Math.round(info.size / 1024)} KB).`, images: [{ data: Buffer.from(bytes).toString("base64"), mediaType: imageType }] }
  }

  if (ext === ".pdf") {
    if (info.size > MAX_PDF_BYTES) throw new Error(`PDF ${abs} quá lớn (${Math.round(info.size / 1024 / 1024)} MB).`)
    const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer())
    return readPdf(abs, bytes, input.pages)
  }
  if (ext === ".xlsx" || ext === ".docx") throw new Error(`Chưa đọc được ${ext} trực tiếp. Nhờ người dùng lưu thành ${ext === ".xlsx" ? ".csv" : ".pdf hoặc .txt"} rồi đọc file đó.`)

  if (info.size > MAX_TEXT_BYTES) throw new Error(`File ${abs} quá lớn (${Math.round(info.size / 1024 / 1024)} MB) để đọc cả: tìm phần cần đọc bằng grep_files rồi đọc theo offset/limit.`)
  const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer())
  if (isBinary(abs, bytes)) throw new Error(`${abs} là file nhị phân, read_file không đọc được (đọc được: text, CSV, JSON, Markdown, HTML, PDF, ảnh).`)
  const { text } = decodeFile(bytes)
  const lines = splitLines(text)
  const offset = Math.max(1, input.offset ?? 1)
  const limit = Math.max(1, input.limit ?? MAX_LINES)
  if (lines.length === 0) {
    state?.record(abs, { mtimeMs: info.mtimeMs, size: info.size, hash: hashBytes(bytes), full: true })
    return `${abs} · file rỗng.`
  }
  if (offset > lines.length) throw new Error(`offset ${offset} vượt quá số dòng của file (${lines.length}).`)
  const { body, first, last } = numberLines(lines, offset, limit)
  const full = first === 1 && last === lines.length
  state?.record(abs, { mtimeMs: info.mtimeMs, size: info.size, hash: hashBytes(bytes), full })
  const header = `${abs} · ${lines.length} dòng${full ? "" : ` · đang hiện dòng ${first}–${last}`}`
  const footer = last < lines.length ? `\n\n(còn ${lines.length - last} dòng; đọc tiếp với offset=${last + 1})` : ""
  return `${header}\n${body}${footer}`
}

export function readFileTool(workspace: Workspace, state?: FileState): ToolDef<ReadFileInput> {
  return {
    name: "read_file",
    description:
      "Đọc một file hoặc thư mục trên máy người dùng theo đường dẫn (tuyệt đối, hoặc tương đối tính từ workspace; ~ là thư mục home). " +
      "Text/CSV/JSON/Markdown/HTML trả về từng dòng có số dòng (tối đa 2000 dòng mỗi lần, đọc tiếp bằng offset/limit); thư mục trả về danh sách file; PDF trả chữ theo trang (mặc định 10 trang đầu, chọn bằng pages, tối đa 20 trang/lần); ảnh png/jpg/gif/webp trả về ảnh. " +
      "Dùng khi người dùng đưa đường dẫn file/thư mục, nhắc tới một file trên máy, hoặc cần xem nội dung file trước khi trả lời. Gọi song song nhiều file cùng lúc được. " +
      "Không dùng khi cần tìm file theo tên (dùng glob_files) hay tìm chữ trong nhiều file (dùng grep_files); không dùng cho URL (dùng web_fetch). " +
      "File chứa khoá/mật khẩu (.env, auth.json, .ssh…) cần người dùng cho phép.",
    input: z.object({
      path: z.string().min(1).describe("Đường dẫn file hoặc thư mục, ví dụ D:\\Dau-tu\\bctc-fpt.pdf hoặc ghi-chu.md"),
      offset: z.number().int().min(1).optional().describe("Dòng bắt đầu (từ 1), cho file text dài"),
      limit: z.number().int().min(1).max(MAX_LINES).optional().describe(`Số dòng đọc (mặc định và tối đa ${MAX_LINES})`),
      pages: z.string().optional().describe('Trang PDF cần đọc, ví dụ "3", "1-5", "2,4-6"'),
    }),
    readOnly: true,
    timeoutMs: 60_000,
    maxOutputChars: MAX_TEXT_CHARS + 2_000,
    // Secrets would reach the LLM provider once read; UNC paths leak the user's NTLM hash
    // to that host. Both ask first, per exact path (no "always").
    askFor: (input) => {
      const raw = (input as ReadFileInput).path
      return typeof raw === "string" ? readScope(workspace.resolve(raw), workspace.env(), realish) : undefined
    },
    summarize: (input) => `read_file ${input.path}${input.pages ? ` · trang ${input.pages}` : input.offset ? ` · từ dòng ${input.offset}` : ""}`,
    execute: (input) => readFileAt(workspace.resolve(input.path), input, state),
  }
}
