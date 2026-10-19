import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { deflateRawSync } from "node:zlib"
import { excelNumber, readDocx, readXlsx, readZip } from "../src/core/fs/office"
import { Workspace } from "../src/core/fs/workspace"
import { readFileTool } from "../src/core/tools/fs/read"
import type { ToolResult } from "../src/core/tools/types"

const root = mkdtempSync(path.join(os.tmpdir(), "ot-office-"))
const project = path.join(root, "project")
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))
const ws = () => new Workspace(project, { home: path.join(root, "home"), data: path.join(root, "home", ".opentrading") })
const ctx = () => ({ signal: new AbortController().signal, callId: "c" })
const text = (r: string | ToolResult) => (typeof r === "string" ? r : r.output)

/** A minimal ZIP writer for fixtures: even entries stored, odd ones deflated (CRC left 0; the reader ignores it). */
function zip(entries: Record<string, string>): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  Object.entries(entries).forEach(([name, content], i) => {
    const raw = enc.encode(content)
    const deflate = i % 2 === 1
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const nameBytes = enc.encode(name)
    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, deflate ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, deflate ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  })
  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + 22)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const XLSX = {
  "xl/workbook.xml": '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Giá" sheetId="1" r:id="rId1"/><sheet name="BCTC" sheetId="2" r:id="rId2"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
  "xl/sharedStrings.xml": '<?xml version="1.0"?><sst><si><t>Mã</t></si><si><t>Giá đóng cửa</t></si><si><r><t>FP</t></r><r><t>T</t></r></si><si><t>Doanh thu, tỷ</t></si></sst>',
  "xl/worksheets/sheet1.xml":
    '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>120500.00000000001</v></c><c r="C2"><v>0.30000000000000004</v></c><c r="D2" t="b"><v>1</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>VCB</t></is></c><c r="B4"><f>B2*0.8</f><v>96400</v></c><c r="C4"><v>0.12</v></c></row></sheetData></worksheet>',
  "xl/worksheets/sheet2.xml": '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>3</v></c><c r="B1"><v>62000</v></c></row></sheetData></worksheet>',
}

test("readZip reads stored and deflated entries; an entry inflating past the cap is refused", () => {
  const files = readZip(zip({ "a.txt": "một", "b.txt": "hai hai hai hai" }))
  expect(new TextDecoder().decode(files.get("a.txt")!())).toBe("một")
  expect(new TextDecoder().decode(files.get("b.txt")!())).toBe("hai hai hai hai")
  expect(() => readZip(new TextEncoder().encode("not a zip"))).toThrow("ZIP")
  // 200 KB of zeros deflates to almost nothing: the cap is on what it inflates to.
  const bomb = readZip(zip({ "a.txt": "x", "big.xml": "0".repeat(200_000) }), 10_000)
  expect(() => bomb.get("big.xml")!()).toThrow("quá lớn")
})

test("numbers as Excel shows them: 15 significant digits", () => {
  expect(excelNumber("0.30000000000000004")).toBe("0.3")
  expect(excelNumber("120500.00000000001")).toBe("120500")
  expect(excelNumber("0.12")).toBe("0.12")
  expect(excelNumber("-1234567.891")).toBe("-1234567.891")
  expect(excelNumber("abc")).toBe("abc")
})

test("xlsx: only the chosen sheet is parsed; shared/inline strings, rich text, booleans, empty cells and rows kept in place", () => {
  const book = readXlsx(zip(XLSX))
  expect(book.sheets).toEqual([{ name: "Giá", rows: 3 }, { name: "BCTC", rows: 1 }])
  expect(book.index).toBe(0)
  expect(book.rows).toEqual([["Mã", "Giá đóng cửa"], ["FPT", "120500", "0.3", "TRUE"], [], ["VCB", "96400", "0.12"]])
  expect(readXlsx(zip(XLSX), "BCTC").rows).toEqual([["Doanh thu, tỷ", "62000"]])
  expect(() => readXlsx(zip(XLSX), "Khác")).toThrow("Các sheet: 1. Giá · 2. BCTC")
})

test("read_file on .xlsx shows the first sheet as numbered CSV, lists the others, picks one by name or number", async () => {
  const file = path.join(project, "gia.xlsx")
  writeFileSync(file, zip(XLSX))
  const tool = readFileTool(ws())
  const first = text(await tool.execute({ path: "gia.xlsx" }, ctx()))
  expect(first).toContain('sheet "Giá"')
  expect(first).toContain("2. BCTC (1 dòng)")
  expect(first).toContain("0,12 = 12%")
  expect(first).toContain("1\tMã,Giá đóng cửa")
  expect(first).toContain("2\tFPT,120500,0.3,TRUE")
  expect(first).toContain("4\tVCB,96400,0.12")
  const second = text(await tool.execute({ path: "gia.xlsx", sheet: "bctc" }, ctx()))
  expect(second).toContain('1\t"Doanh thu, tỷ",62000')
  expect(text(await tool.execute({ path: "gia.xlsx", sheet: "2" }, ctx()))).toContain("Doanh thu")
  await expect(tool.execute({ path: "gia.xlsx", sheet: "Khác" }, ctx())).rejects.toThrow("Các sheet: 1. Giá · 2. BCTC")
})

test("docx: headings, list items, paragraphs and tables as markdown; old .doc/.xls are explained", async () => {
  const body =
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Báo cáo FPT</w:t></w:r></w:p>' +
    "<w:p><w:r><w:t>Lợi nhuận </w:t></w:r><w:r><w:t>tăng 20%.</w:t></w:r></w:p>" +
    "<w:sdt><w:sdtContent><w:p><w:r><w:t>Mục lục</w:t><w:tab/><w:t>3</w:t></w:r></w:p></w:sdtContent></w:sdt>" +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Mảng công nghệ</w:t></w:r></w:p>' +
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Chỉ tiêu</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2025</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Doanh thu</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>62.000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
  const docx = zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>` })
  expect(readDocx(docx)).toBe("# Báo cáo FPT\n\nLợi nhuận tăng 20%.\n\nMục lục\t3\n\n- Mảng công nghệ\n\n| Chỉ tiêu | 2025 |\n| --- | --- |\n| Doanh thu | 62.000 |")
  writeFileSync(path.join(project, "bao-cao.docx"), docx)
  const out = text(await readFileTool(ws()).execute({ path: "bao-cao.docx" }, ctx()))
  expect(out).toContain("1\t# Báo cáo FPT")
  expect(out).toContain("| Doanh thu | 62.000 |")
  writeFileSync(path.join(project, "cu.xls"), new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))
  await expect(readFileTool(ws()).execute({ path: "cu.xls" }, ctx())).rejects.toThrow("định dạng Office cũ")
  writeFileSync(path.join(project, "hong.xlsx"), "không phải zip")
  await expect(readFileTool(ws()).execute({ path: "hong.xlsx" }, ctx())).rejects.toThrow("Không đọc được")
})
