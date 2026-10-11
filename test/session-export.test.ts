import { afterAll, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"

const home = await mkdtemp(path.join(os.tmpdir(), "opentrading-export-"))
process.env.OPENTRADING_HOME = home
const { fence, formatTranscript, resolveExportPath, writeExport } = await import("../src/core/session/export")
const { COMPACT_TAG } = await import("../src/core/compact-marker")

afterAll(() => rm(home, { recursive: true, force: true }))

const summary = {
  id: "20261011-101500-abcd",
  file: "2026/10/20261011-101500-abcd.jsonl",
  title: "Giá VCB hôm nay",
  createdAt: "2026-10-11T03:15:00.000Z",
  updatedAt: "2026-10-11T03:20:00.000Z",
  provider: "google",
  model: "gemini-3.1-flash-lite",
  turns: 2,
}
const label = (name: string, input: unknown) => `${name}(${JSON.stringify(input)})`

const turn: ModelMessage[] = [
  { role: "user", content: [{ type: "text", text: "<nhac_nho>giờ: 10:15</nhac_nho>" }, { type: "text", text: "Giá VCB hôm nay?" }] },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Để mình tra." },
      { type: "tool-call", toolCallId: "c1", toolName: "quote", input: { symbol: "VCB" } },
      { type: "tool-call", toolCallId: "c2", toolName: "chart_render", input: { from_call: "c1" } },
      { type: "tool-call", toolCallId: "c3", toolName: "broken", input: {} },
    ],
  },
  {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "c1", toolName: "quote", output: { type: "text", value: "VCB 87.500 đ\n```bẫy fence```" } },
      { type: "tool-result", toolCallId: "c2", toolName: "chart_render", output: { type: "text", value: "VCB 80→87,5 (+9,4% cả kỳ)" } },
      { type: "tool-result", toolCallId: "c3", toolName: "broken", output: { type: "error-text", value: "MCP hết hạn" } },
    ],
  },
  { role: "assistant", content: [{ type: "text", text: "VCB đang 87.500 đ." }] },
]

test("fence: longer than any backtick run inside, so the content cannot close it", () => {
  expect(fence("a")).toBe("```\na\n```")
  expect(fence("x ```` y", "json")).toBe("`````json\nx ```` y\n`````")
})

test("transcript: title + meta, each turn, tool input/output, errors, no reminders, chart summary once", () => {
  const md = formatTranscript({ summary, display: turn }, { label })
  expect(md.startsWith("# Giá VCB hôm nay\n\nPhiên `20261011-101500-abcd`")).toBe(true)
  expect(md).toContain("google/gemini-3.1-flash-lite · 2 lượt")
  expect(md).toContain("## Bạn\n\nGiá VCB hôm nay?")
  expect(md).not.toContain("nhac_nho")
  // One heading for the whole answer, even though tool calls split its text.
  expect(md.match(/## OpenTrading/g)).toHaveLength(1)
  expect(md).toContain('#### ✓ quote({"symbol":"VCB"})')
  expect(md).toContain('```json\n{\n  "symbol": "VCB"\n}\n```')
  expect(md).toContain("````\nVCB 87.500 đ\n```bẫy fence```\n````")
  expect(md).toContain("#### ✗ broken({})\n\n**Input**\n\n```json\n{}\n```\n\n**Lỗi**\n\n```\nMCP hết hạn\n```")
  expect(md.match(/\+9,4% cả kỳ/g)).toHaveLength(1)
  expect(md.trimEnd().endsWith("VCB đang 87.500 đ.")).toBe(true)
})

test("transcript: turns before a compaction stay, the summary is quoted where it happened", () => {
  const markerMessage: ModelMessage = { role: "user", content: `<${COMPACT_TAG}>\nđã nén\n</${COMPACT_TAG}>` }
  const display: ModelMessage[] = [
    ...turn,
    markerMessage,
    { role: "assistant", content: "Tóm tắt: user hỏi giá VCB." },
    { role: "user", content: "Còn TCB?" },
    { role: "assistant", content: "TCB 25.000 đ." },
  ]
  const md = formatTranscript({ summary, display }, { label })
  expect(md).toContain("Giá VCB hôm nay?")
  expect(md).toContain("> **Đã nén hội thoại**")
  expect(md).toContain("> Tóm tắt: user hỏi giá VCB.")
  expect(md.indexOf("VCB đang")).toBeLessThan(md.indexOf("Đã nén"))
  expect(md.indexOf("Đã nén")).toBeLessThan(md.indexOf("Còn TCB?"))
})

test("export path: default under the data dir, ~, relative, folder, no extension, quotes, --force", async () => {
  const cwd = path.join(home, "work")
  await mkdir(path.join(cwd, "out"), { recursive: true })
  const ctx = { cwd, id: summary.id }
  expect(resolveExportPath("", ctx)).toEqual({ file: path.join(home, "exports", `${summary.id}.md`), overwrite: true })
  expect(resolveExportPath("~/a.md", ctx).file).toBe(path.join(os.homedir(), "a.md"))
  expect(resolveExportPath("notes/a.md", ctx)).toEqual({ file: path.join(cwd, "notes", "a.md"), overwrite: false })
  expect(resolveExportPath("out", ctx).file).toBe(path.join(cwd, "out", `${summary.id}.md`))
  expect(resolveExportPath("new-dir/", ctx).file).toBe(path.join(cwd, "new-dir", `${summary.id}.md`))
  expect(resolveExportPath("bao-cao", ctx).file).toBe(path.join(cwd, "bao-cao.md"))
  expect(resolveExportPath('"thư mục/bản xuất.txt" --force', ctx)).toEqual({ file: path.join(cwd, "thư mục", "bản xuất.txt"), overwrite: true })
})

test("writeExport: creates folders, keeps an existing file unless allowed", async () => {
  const file = path.join(home, "deep", "x", "a.md")
  await writeExport(file, "một\n", { overwrite: false })
  expect(await readFile(file, "utf8")).toBe("một\n")
  await expect(writeExport(file, "hai\n", { overwrite: false })).rejects.toThrow("--force")
  expect(await readFile(file, "utf8")).toBe("một\n")
  await writeExport(file, "hai\n", { overwrite: true })
  expect(await readFile(file, "utf8")).toBe("hai\n")
  await writeFile(file, "")
})
