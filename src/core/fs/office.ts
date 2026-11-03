import { inflateRawSync } from "node:zlib"
import { DOMParser } from "linkedom"

/**
 * Excel (.xlsx) and Word (.docx) as text for read_file: broker statements and financial
 * reports often come as one of these. Both are ZIP files of XML; a small ZIP reader (stored
 * and deflated entries, no ZIP64, no encryption) and linkedom's XML parser are enough, so no
 * new dependency. Formulas show their last computed value; dates stay Excel serial numbers
 * unless the cell is typed as a date string; numbers are shown to 15 significant digits, as
 * Excel does (the stored double 0.30000000000000004 is the 0.3 the user sees).
 * Everything runs synchronously, so entries are capped by what they actually inflate to (a
 * crafted file can lie about its declared size) and only the sheet asked for is parsed.
 */

export const MAX_ENTRY_BYTES = 32 * 1024 * 1024

/** The files inside a ZIP, read lazily by name; an entry inflating past `maxEntry` throws. */
export function readZip(bytes: Uint8Array, maxEntry = MAX_ENTRY_BYTES): Map<string, () => Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End of central directory: scan back over a comment of at most 64 KB.
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("không phải file ZIP hợp lệ (có thể file bị hỏng hoặc có mật khẩu)")
  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  if (at === 0xffffffff) throw new Error("file quá lớn (ZIP64) chưa đọc được")
  const files = new Map<string, () => Uint8Array>()
  const decoder = new TextDecoder("utf-8")
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("thư mục ZIP bị hỏng")
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const compressed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen))
    at += 46 + nameLen + extraLen + commentLen
    files.set(name, () => {
      if (flags & 1) throw new Error("file có mật khẩu, không đọc được")
      if (size > maxEntry || compressed > maxEntry) throw new Error(`phần ${name} quá lớn`)
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = bytes.subarray(start, start + compressed)
      if (method === 0) return data
      if (method === 8) {
        try {
          return new Uint8Array(inflateRawSync(data, { maxOutputLength: maxEntry }))
        } catch (error) {
          if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new Error(`phần ${name} quá lớn khi giải nén`)
          throw new Error(`phần ${name} bị hỏng`)
        }
      }
      throw new Error(`kiểu nén ${method} chưa hỗ trợ`)
    })
  }
  return files
}

const xml = (bytes: Uint8Array) => new DOMParser().parseFromString(new TextDecoder("utf-8").decode(bytes), "text/xml")
const byTag = (node: { getElementsByTagName(n: string): ArrayLike<Element> }, tag: string): Element[] => Array.from(node.getElementsByTagName(tag))

// OOXML names elements by namespace URI; the prefix is the writer's choice (`<x:sheet>` from
// some exporters, `<sheet>` from Excel). linkedom does not resolve namespaces, so the prefix
// bound to each URI is read from the root element, where OOXML writers declare them.
const NS = {
  sheet: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  pkg: "http://schemas.openxmlformats.org/package/2006/relationships",
  word: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}

/** Qualified-name maker for `uri` in `doc`: the declared prefix, else the usual one. */
function names(doc: { documentElement?: { attributes: ArrayLike<{ name: string; value: string }> } | null } | undefined, uri: string, usual: string): (local: string) => string {
  let prefix = usual
  for (const attr of Array.from(doc?.documentElement?.attributes ?? [])) {
    if (attr.value !== uri) continue
    if (attr.name === "xmlns") prefix = ""
    else if (attr.name.startsWith("xmlns:")) prefix = attr.name.slice(6)
    else continue
    break
  }
  return (local) => (prefix ? `${prefix}:${local}` : local)
}

/** A one-line cell: paragraphs and line breaks as `<br>` (the GFM way to break inside a table cell). */
const cellText = (parts: string[]) =>
  parts
    .map((p) => p.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, "<br>").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("<br>")

/** Largest length without spreading into Math.max (a million rows overflow the call stack). */
export function maxLength(rows: readonly { length: number }[]): number {
  let max = 0
  for (const r of rows) if (r.length > max) max = r.length
  return max
}

function part(files: Map<string, () => Uint8Array>, name: string) {
  const read = files.get(name)
  return read ? xml(read()) : undefined
}

// ── xlsx ───────────────────────────────────────────────────────────────────

export interface Workbook {
  /** Every sheet with its row count (counted without parsing the other sheets). */
  sheets: { name: string; rows: number }[]
  /** The sheet that was read. */
  index: number
  rows: string[][]
}

/** A stored double as Excel shows it: 15 significant digits, no trailing zeros. */
export function excelNumber(v: string): string {
  const n = Number(v)
  if (v.trim() === "" || !Number.isFinite(n)) return v
  return String(Number(n.toPrecision(15)))
}

/** "C12" → column index 2. */
function columnOf(ref: string) {
  let n = 0
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * One sheet's cells as text (shared strings resolved, inline strings, booleans), chosen by exact
 * name, else by 1-based number (default the first); the others are listed with their row counts.
 * Throws "không có sheet" with the list when `pick` matches none.
 */
export function readXlsx(bytes: Uint8Array, pick?: string, maxEntry = MAX_ENTRY_BYTES): Workbook {
  const files = readZip(bytes, maxEntry)
  const workbook = part(files, "xl/workbook.xml")
  if (!workbook) throw new Error("không thấy xl/workbook.xml: không phải file Excel .xlsx")
  const wb = names(workbook, NS.sheet, "")
  const rid = names(workbook, NS.rel, "r")("id")
  const rels = part(files, "xl/_rels/workbook.xml.rels")
  const relTag = names(rels, NS.pkg, "")("Relationship")
  const targets = new Map(byTag(rels ?? { getElementsByTagName: () => [] }, relTag).map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]))
  const sst = part(files, "xl/sharedStrings.xml")
  const ss = names(sst, NS.sheet, "")
  const shared = byTag(sst ?? { getElementsByTagName: () => [] }, ss("si")).map((si) =>
    byTag(si, ss("t"))
      .map((t) => t.textContent ?? "")
      .join(""),
  )
  const entries = byTag(workbook, wb("sheet")).map((s, i) => ({
    name: s.getAttribute("name") ?? `Sheet${i + 1}`,
    path: `xl/${(targets.get(s.getAttribute(rid)) ?? `worksheets/sheet${i + 1}.xml`).replace(/^\/?(xl\/)?/, "")}`,
  }))
  const raw = (p: string) => {
    const read = files.get(p)
    return read ? new TextDecoder("utf-8").decode(read()) : ""
  }
  const sheets = entries.map((e) => ({ name: e.name, rows: (raw(e.path).match(/<([\w.-]+:)?row[\s>]/g) ?? []).length }))
  const want = pick?.trim()
  // A sheet named "2026" is that sheet, not the 2026th: an exact name wins over a number.
  const byName = want ? entries.findIndex((e) => e.name.trim().toLowerCase() === want.toLowerCase()) : -1
  const index = !want ? 0 : byName >= 0 ? byName : /^\d+$/.test(want) ? Number(want) - 1 : -1
  if (!entries[index]) throw new Error(`không có sheet "${want}". Các sheet: ${entries.map((e, i) => `${i + 1}. ${e.name}`).join(" · ")}`)
  const sheet = part(files, entries[index]!.path)
  const ws = names(sheet, NS.sheet, "")
  const [ROW, C, V, T] = [ws("row"), ws("c"), ws("v"), ws("t")]
  const rows: string[][] = []
  {
    for (const row of sheet ? byTag(sheet, ROW) : []) {
      const r = Number(row.getAttribute("r") ?? rows.length + 1) - 1
      const cells: string[] = []
      for (const c of byTag(row, C)) {
        const col = c.getAttribute("r") ? columnOf(c.getAttribute("r")!) : cells.length
        const type = c.getAttribute("t")
        const v = byTag(c, V)[0]?.textContent ?? ""
        let value = v
        if (type === "s") value = shared[Number(v)] ?? ""
        else if (type === "inlineStr") value = byTag(c, T).map((t) => t.textContent ?? "").join("")
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE"
        else if (!type || type === "n") value = excelNumber(v)
        cells[col] = value
      }
      rows[r] = Array.from(cells, (x) => x ?? "")
    }
  }
  return { sheets, index, rows: Array.from(rows, (x) => x ?? []) }
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const toCsvRow = (cells: string[]) => cells.map(csvCell).join(",")

// ── docx ───────────────────────────────────────────────────────────────────

type W = (local: string) => string

/** A paragraph's text in order: runs, tabs and line breaks. */
function textOf(node: Element, w: W): string {
  let out = ""
  for (const child of Array.from(node.children)) {
    if (child.tagName === w("t")) out += child.textContent ?? ""
    else if (child.tagName === w("tab")) out += "\t"
    else if (child.tagName === w("br") || child.tagName === w("cr")) out += "\n"
    else out += textOf(child, w)
  }
  return out
}

function paragraph(p: Element, w: W): string {
  const text = textOf(p, w).trim()
  if (!text) return ""
  const style = byTag(p, w("pStyle"))[0]?.getAttribute(w("val")) ?? ""
  const level = style.match(/^(?:Heading|Tieude|Title)(\d)?$/i)
  if (level) return `${"#".repeat(Math.min(6, Number(level[1] ?? 1)))} ${text}`
  if (byTag(p, w("numPr")).length > 0) return `- ${text}`
  return text
}

/** A cell's paragraphs, each kept apart: "100" and "200" must not read as 100200. */
function cellParagraphs(tc: Element, w: W): string[] {
  const out: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.tagName === w("p")) out.push(textOf(child, w))
      else walk(child)
    }
  }
  walk(tc)
  return out
}

function table(tbl: Element, w: W): string {
  const rows = byTag(tbl, w("tr")).map((tr) => byTag(tr, w("tc")).map((tc) => cellText(cellParagraphs(tc, w))))
  if (rows.length === 0) return ""
  const width = maxLength(rows)
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`
  return [line(rows[0]!), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n")
}

/** The document body as markdown: headings, list items, paragraphs, tables. */
export function readDocx(bytes: Uint8Array, maxEntry = MAX_ENTRY_BYTES): string {
  const files = readZip(bytes, maxEntry)
  const doc = part(files, "word/document.xml")
  if (!doc) throw new Error("không thấy word/document.xml: không phải file Word .docx")
  const w = names(doc, NS.word, "w")
  const body = byTag(doc, w("body"))[0]
  if (!body) return ""
  const blocks: string[] = []
  // Content controls (w:sdt: templates, a table of contents) hold paragraphs and tables too.
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.tagName === w("p")) blocks.push(paragraph(child, w))
      else if (child.tagName === w("tbl")) blocks.push(table(child, w))
      else if (child.tagName === w("sdt") || child.tagName === w("sdtContent")) walk(child)
    }
  }
  walk(body)
  return blocks.filter(Boolean).join("\n\n")
}
