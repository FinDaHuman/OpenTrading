import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { FileState, hashBytes } from "../../fs/file-state"
import { readScope } from "../../fs/path-safety"
import { decodeFile, isBinary, splitLines } from "../../fs/text"
import { realish, type Workspace } from "../../fs/workspace"
import type { ToolDef, ToolResult } from "../types"
import { maxLength, readDocx, readXlsx, toCsvRow } from "../../fs/office"

/**
 * read_file: what the user hands over by path (a broker's PDF report, an Excel export saved
 * as CSV, notes, a screenshot), and later the agent's own artifacts before editing them.
 * Text comes back numbered like `cat -n` (Claude Code's Read tool), a folder comes back as
 * a listing (opencode read.ts), PDFs page by page, images as images.
 */

export type ReadFileInput = { path: string; offset?: number; limit?: number; pages?: string; sheet?: string }
/** Internal only (not in the tool schema): a smaller character cap, for files the user @-attached. */
type ReadOptions = Omit<ReadFileInput, "path"> & { maxChars?: number }

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
    if (!m) return `Invalid pages "${spec}" (e.g. "3", "1-5", "2,4-6").`
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    if (from < 1 || to < from) return `Invalid pages "${spec}".`
    for (let p = from; p <= Math.min(to, total); p++) pages.add(p)
  }
  if (pages.size === 0) return `The PDF has only ${total} pages.`
  return [...pages].sort((a, b) => a - b)
}

async function readPdf(abs: string, bytes: Uint8Array, spec: string | undefined): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf")
  const doc = await getDocumentProxy(bytes)
  const { text, totalPages } = await extractText(doc, { mergePages: false })
  const wanted = spec ? parsePages(spec, totalPages) : Array.from({ length: Math.min(totalPages, PDF_DEFAULT_PAGES) }, (_, i) => i + 1)
  if (typeof wanted === "string") throw new Error(wanted)
  if (wanted.length > PDF_MAX_PAGES) throw new Error(`At most ${PDF_MAX_PAGES} pages per call; split pages over several calls.`)
  const body = wanted.map((p) => `--- Trang ${p} ---\n${String(text[p - 1] ?? "").replace(/[ \t]+\n/g, "\n").trim()}`).join("\n\n")
  const chars = wanted.reduce((n, p) => n + String(text[p - 1] ?? "").trim().length, 0)
  const notes = [
    `PDF ${abs} · ${totalPages} pages · showing page ${wanted.length === 1 ? wanted[0] : `${wanted[0]}–${wanted.at(-1)}`}${wanted.length > 1 && wanted.at(-1)! - wanted[0]! + 1 !== wanted.length ? ` (${wanted.join(", ")})` : ""}`,
    ...(chars < 50 * wanted.length ? ["These pages have almost no text layer (a scan): their content cannot be read. Ask the user for a screenshot of the pages needed or a version with text."] : []),
    ...(!spec && totalPages > wanted.length ? [`${totalPages - wanted.length} pages left; continue with pages, e.g. pages="${wanted.length + 1}-${Math.min(totalPages, wanted.length + PDF_DEFAULT_PAGES)}".`] : []),
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
    `Directory ${abs} · ${entries.filter((e) => e.isDirectory()).length} directories, ${entries.filter((e) => !e.isDirectory()).length} files`,
    "",
    ...shown,
    ...(more > 0 ? ["", `(${more} more entries; filter with glob_files)`] : []),
    ...(names.length === 0 ? ["(empty directory)"] : []),
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

/** Numbered lines from `offset` (1-based), at most `limit` lines and `maxChars` characters. */
/** `cut`: some line shown was longer than MAX_LINE_CHARS and lost its end. */
export function numberLines(
  lines: string[],
  offset: number,
  limit: number,
  maxChars = MAX_TEXT_CHARS,
): { body: string; first: number; last: number; cut: boolean } {
  const out: string[] = []
  let chars = 0
  let last = offset - 1
  let cut = false
  for (let n = offset; n <= Math.min(lines.length, offset + limit - 1); n++) {
    let line = lines[n - 1]!
    const long = line.length > MAX_LINE_CHARS
    if (long) line = `${line.slice(0, MAX_LINE_CHARS)}… (line cut, ${line.length} characters long)`
    const row = `${n}\t${line}`
    if (out.length > 0 && chars + row.length + 1 > maxChars) break
    out.push(row)
    chars += row.length + 1
    last = n
    cut ||= long
  }
  return { body: out.join("\n"), first: offset, last, cut }
}

/** Numbered rows from `offset`, with the same paging note as text files. */
function paged(label: string, lines: string[], input: ReadOptions, unit: string) {
  if (lines.length === 0) return `${label} · empty.`
  const offset = Math.max(1, input.offset ?? 1)
  if (offset > lines.length) throw new Error(`offset ${offset} is past the number of ${unit} (${lines.length}).`)
  const { body, first, last } = numberLines(lines, offset, Math.max(1, input.limit ?? MAX_LINES), input.maxChars)
  const footer = last < lines.length ? `\n\n(${lines.length - last} ${unit} left; continue with offset=${last + 1})` : ""
  return `${label} · ${lines.length} ${unit}${first === 1 && last === lines.length ? "" : ` · showing ${unit} ${first}–${last}`}\n${body}${footer}`
}

/** One sheet of a workbook as CSV rows numbered like Excel rows; the other sheets are listed. */
function readSheet(abs: string, bytes: Uint8Array, input: ReadOptions) {
  let book
  try {
    book = readXlsx(bytes, input.sheet)
  } catch (error) {
    throw new Error(`Không đọc được ${abs}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (book.sheets.length === 0) return `Excel ${abs} · no sheets.`
  const list =
    book.sheets.length > 1 ? `\nSheets: ${book.sheets.map((s, i) => `${i + 1}. ${s.name} (${s.rows} rows)${i === book.index ? " ← reading" : ""}`).join(" · ")}; pick another with the sheet parameter.` : ""
  const width = maxLength(book.rows)
  const head =
    `Excel ${abs} · sheet "${book.sheets[book.index]!.name}" · ${width} columns (as CSV; the number at the start of each line is the Excel row number; values are raw numbers, not the displayed format: a percentage cell is a fraction, 0.12 = 12%; a date may be an Excel serial number, 45658 = 2025-01-01)` +
    list
  return paged(head, book.rows.map(toCsvRow), input, "lines")
}

export async function readFileAt(abs: string, input: ReadOptions, state?: FileState): Promise<string | ToolResult> {
  let info
  try {
    info = await stat(abs)
  } catch {
    const near = await nearNames(abs)
    throw new Error(`No file or directory ${abs}.${near.length > 0 ? ` Did you mean: ${near.join(" · ")}?` : ""}`)
  }
  if (info.isDirectory()) return listDir(abs)
  const ext = path.extname(abs).toLowerCase()

  const imageType = IMAGE_TYPES[ext]
  if (imageType) {
    if (info.size > MAX_IMAGE_BYTES) throw new Error(`Image ${abs} is ${Math.round(info.size / 1024)} KB, over ${Math.round(MAX_IMAGE_BYTES / 1024)} KB: ask the user to shrink or crop it.`)
    const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer())
    return { output: `Ảnh ${abs} (${Math.round(info.size / 1024)} KB).`, images: [{ data: Buffer.from(bytes).toString("base64"), mediaType: imageType }] }
  }

  if (ext === ".pdf") {
    if (info.size > MAX_PDF_BYTES) throw new Error(`PDF ${abs} is too large (${Math.round(info.size / 1024 / 1024)} MB).`)
    const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer())
    return readPdf(abs, bytes, input.pages)
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    if (info.size > MAX_TEXT_BYTES) throw new Error(`Excel file ${abs} is too large (${Math.round(info.size / 1024 / 1024)} MB).`)
    return readSheet(abs, new Uint8Array(await Bun.file(abs).arrayBuffer()), input)
  }
  if (ext === ".docx") {
    if (info.size > MAX_TEXT_BYTES) throw new Error(`Word file ${abs} is too large (${Math.round(info.size / 1024 / 1024)} MB).`)
    let text: string
    try {
      text = readDocx(new Uint8Array(await Bun.file(abs).arrayBuffer()))
    } catch (error) {
      throw new Error(`Không đọc được ${abs}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return paged(`Word ${abs}`, text.split("\n"), input, "lines")
  }
  if (ext === ".xls" || ext === ".doc") throw new Error(`${ext} is an old (binary) Office format that cannot be read yet. Ask the user to save it as ${ext === ".xls" ? ".xlsx or .csv" : ".docx or .pdf"}.`)

  if (info.size > MAX_TEXT_BYTES) throw new Error(`File ${abs} is too large (${Math.round(info.size / 1024 / 1024)} MB) to read whole: find the part you need with grep_files, then read it with offset/limit.`)
  const bytes = new Uint8Array(await Bun.file(abs).arrayBuffer())
  if (isBinary(abs, bytes)) throw new Error(`${abs} is a binary file that read_file cannot read (it reads text, CSV, JSON, Markdown, HTML, PDF, images).`)
  const { text } = decodeFile(bytes)
  const lines = splitLines(text)
  const offset = Math.max(1, input.offset ?? 1)
  const limit = Math.max(1, input.limit ?? MAX_LINES)
  if (lines.length === 0) {
    state?.record(abs, { mtimeMs: info.mtimeMs, size: info.size, hash: hashBytes(bytes), full: true })
    return `${abs} · empty file.`
  }
  if (offset > lines.length) throw new Error(`offset ${offset} is past the file's line count (${lines.length}).`)
  const { body, first, last, cut } = numberLines(lines, offset, limit, input.maxChars)
  const whole = first === 1 && last === lines.length
  // A cut line hid part of the file: it was not fully read, however the pages add up.
  state?.record(abs, { mtimeMs: info.mtimeMs, size: info.size, hash: hashBytes(bytes), full: whole && !cut }, cut ? undefined : { first, last, lines: lines.length })
  const header = `${abs} · ${lines.length} lines${whole ? "" : ` · showing lines ${first}–${last}`}`
  const footer = last < lines.length ? `\n\n(${lines.length - last} lines left; continue with offset=${last + 1})` : ""
  const note = cut ? "\n\n(Some lines were cut: the whole file has not been seen, so write_file cannot overwrite it; edit the exact place with edit_file.)" : ""
  return `${header}\n${body}${footer}${note}`
}

export function readFileTool(workspace: Workspace, state?: FileState): ToolDef<ReadFileInput> {
  return {
    name: "read_file",
    description:
      "Reads a file or directory on the machine (absolute path or relative to the workspace). Text comes back line by line with line numbers (at most 2000; continue with offset/limit); .xlsx as CSV per sheet; .docx as markdown; PDF as text per page (pages, at most 20 per call); images as images. " +
      "Use when the user mentions a file or directory. Not for URLs (use web_fetch). Files holding keys need the user's permission.",
    input: z.object({
      path: z.string().min(1),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(MAX_LINES).optional(),
      pages: z.string().optional().describe('E.g. "1-5"'),
      sheet: z.string().optional().describe("Sheet name or number"),
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
    subject: (input) => workspace.resolve(input.path),
    summarize: (input) => `read_file ${input.path}${input.pages ? ` · trang ${input.pages}` : input.offset ? ` · từ dòng ${input.offset}` : ""}`,
    execute: (input) => readFileAt(workspace.resolve(input.path), input, state),
  }
}
