import { inflateRawSync } from "node:zlib"
import { DOMParser } from "linkedom"

/**
 * Excel (.xlsx) and Word (.docx) as text for read_file: broker statements and financial
 * reports often come as one of these. Both are ZIP files of XML; a small ZIP reader (stored
 * and deflated entries, no ZIP64, no encryption) and linkedom's XML parser are enough, so no
 * new dependency. Formulas show their last computed value; dates stay Excel serial numbers
 * unless the cell is typed as a date string.
 */

const MAX_ENTRY_BYTES = 64 * 1024 * 1024

/** The files inside a ZIP, read lazily by name. */
export function readZip(bytes: Uint8Array): Map<string, () => Uint8Array> {
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
      if (size > MAX_ENTRY_BYTES) throw new Error(`phần ${name} quá lớn`)
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = bytes.subarray(start, start + compressed)
      if (method === 0) return data
      if (method === 8) return new Uint8Array(inflateRawSync(data))
      throw new Error(`kiểu nén ${method} chưa hỗ trợ`)
    })
  }
  return files
}

const xml = (bytes: Uint8Array) => new DOMParser().parseFromString(new TextDecoder("utf-8").decode(bytes), "text/xml")
const byTag = (node: { getElementsByTagName(n: string): ArrayLike<Element> }, tag: string): Element[] => Array.from(node.getElementsByTagName(tag))

function part(files: Map<string, () => Uint8Array>, name: string) {
  const read = files.get(name)
  return read ? xml(read()) : undefined
}

// ── xlsx ───────────────────────────────────────────────────────────────────

export interface Sheet {
  name: string
  rows: string[][]
}

/** "C12" → column index 2. */
function columnOf(ref: string) {
  let n = 0
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Every sheet's cells as text (shared strings resolved, inline strings, booleans). */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = readZip(bytes)
  const workbook = part(files, "xl/workbook.xml")
  if (!workbook) throw new Error("không thấy xl/workbook.xml: không phải file Excel .xlsx")
  const rels = part(files, "xl/_rels/workbook.xml.rels")
  const targets = new Map(byTag(rels ?? { getElementsByTagName: () => [] }, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]))
  const shared = byTag(part(files, "xl/sharedStrings.xml") ?? { getElementsByTagName: () => [] }, "si").map((si) =>
    byTag(si, "t")
      .map((t) => t.textContent ?? "")
      .join(""),
  )
  return byTag(workbook, "sheet").map((s, i) => {
    const target = (targets.get(s.getAttribute("r:id")) ?? `worksheets/sheet${i + 1}.xml`).replace(/^\/?(xl\/)?/, "")
    const sheet = part(files, `xl/${target}`)
    const rows: string[][] = []
    for (const row of sheet ? byTag(sheet, "row") : []) {
      const r = Number(row.getAttribute("r") ?? rows.length + 1) - 1
      const cells: string[] = []
      for (const c of byTag(row, "c")) {
        const col = c.getAttribute("r") ? columnOf(c.getAttribute("r")!) : cells.length
        const type = c.getAttribute("t")
        const v = byTag(c, "v")[0]?.textContent ?? ""
        let value = v
        if (type === "s") value = shared[Number(v)] ?? ""
        else if (type === "inlineStr") value = byTag(c, "t").map((t) => t.textContent ?? "").join("")
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE"
        cells[col] = value
      }
      rows[r] = Array.from(cells, (x) => x ?? "")
    }
    return { name: s.getAttribute("name") ?? `Sheet${i + 1}`, rows: Array.from(rows, (x) => x ?? []) }
  })
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const toCsvRow = (cells: string[]) => cells.map(csvCell).join(",")

// ── docx ───────────────────────────────────────────────────────────────────

const textOf = (node: Element) =>
  byTag(node, "w:t")
    .map((t) => t.textContent ?? "")
    .join("")

function paragraph(p: Element): string {
  const text = textOf(p).trim()
  if (!text) return ""
  const style = byTag(p, "w:pStyle")[0]?.getAttribute("w:val") ?? ""
  const level = style.match(/^(?:Heading|Tieude|Title)(\d)?$/i)
  if (level) return `${"#".repeat(Math.min(6, Number(level[1] ?? 1)))} ${text}`
  if (byTag(p, "w:numPr").length > 0) return `- ${text}`
  return text
}

function table(tbl: Element): string {
  const rows = byTag(tbl, "w:tr").map((tr) => byTag(tr, "w:tc").map((tc) => textOf(tc).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()))
  if (rows.length === 0) return ""
  const width = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`
  return [line(rows[0]!), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n")
}

/** The document body as markdown: headings, list items, paragraphs, tables. */
export function readDocx(bytes: Uint8Array): string {
  const files = readZip(bytes)
  const doc = part(files, "word/document.xml")
  if (!doc) throw new Error("không thấy word/document.xml: không phải file Word .docx")
  const body = byTag(doc, "w:body")[0]
  if (!body) return ""
  const blocks: string[] = []
  for (const child of Array.from(body.children)) {
    if (child.tagName === "w:p") blocks.push(paragraph(child))
    else if (child.tagName === "w:tbl") blocks.push(table(child))
  }
  return blocks.filter(Boolean).join("\n\n")
}
