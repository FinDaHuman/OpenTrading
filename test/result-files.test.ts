import { afterAll, afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileAccessNote } from "../src/core/agent"
import { Workspace } from "../src/core/fs/workspace"
import { initRuntime } from "../src/core/runtime"
import { ToolRegistry } from "../src/core/tools/registry"
import { clearResults, exportResultsTo, rememberResult, RESULT_FILE_MAX_BYTES, resultExportDir, useResultSession } from "../src/core/tools/refs"
import { shellTool } from "../src/core/tools/shell/shell"

/**
 * Issue #309 A2: a shell command cannot read the tool results the model sees, so it re-typed the
 * numbers. Data results are also written as <ref>.json where a script can read them, and the
 * `<quyen_tep>` reminder says where.
 */

const root = mkdtempSync(path.join(os.tmpdir(), "ot-result-files-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
afterEach(() => clearResults())
const home = path.join(root, "home")
const data = path.join(home, ".opentrading")
const project = path.join(root, "project")
for (const dir of [data, project]) mkdirSync(dir, { recursive: true })
const quotes = JSON.stringify({ symbol: "HPG", closes: [{ date: "2026-10-30", close: 27.1 }, { date: "2026-10-31", close: 27.4 }] })

test("a data result is written as <ref>.json, the JSON only (no label line)", () => {
  const dir = path.join(root, "out-1")
  exportResultsTo(dir)
  useResultSession("s1")
  const ref = rememberResult("vn_quote_history", `[nguồn: snapshot]\n${quotes}`)
  expect(JSON.parse(readFileSync(path.join(dir, `${ref}.json`), "utf8"))).toEqual(JSON.parse(quotes))
  // The raw text wins over the visible one (the model may have seen a truncated table).
  const raw = JSON.stringify({ closes: [1, 2, 3, 4] })
  const ref2 = rememberResult("vn_quote_history", "bảng đã rút gọn", { rawText: raw })
  expect(readFileSync(path.join(dir, `${ref2}.json`), "utf8")).toBe(raw)
})

test("nothing is written without a folder, for text that is not JSON, or past the size caps", () => {
  const dir = path.join(root, "out-2")
  useResultSession("s2")
  const none = rememberResult("vn_quote_history", quotes)
  expect(existsSync(path.join(dir, `${none}.json`))).toBe(false)
  exportResultsTo(dir)
  const text = rememberResult("web_search", "không phải JSON")
  expect(existsSync(path.join(dir, `${text}.json`))).toBe(false)
  const big = rememberResult("vn_quote_history", JSON.stringify({ x: "a".repeat(RESULT_FILE_MAX_BYTES) }))
  expect(existsSync(path.join(dir, `${big}.json`))).toBe(false)
})

test("<quyen_tep> says where the files are, relative inside the workspace", () => {
  const registry = new ToolRegistry()
  const workspace = new Workspace(project, { home, data })
  registry.workspace = workspace
  registry.register(shellTool(workspace, { shell: { kind: "bash", path: "/bin/bash" } }))
  expect(fileAccessNote(registry, "bypass", "machine")).not.toContain("rN.json")
  exportResultsTo(path.join(project, "ot-data"))
  const note = fileAccessNote(registry, "bypass", "machine")
  expect(note).toContain("Kết quả dữ liệu có nhãn [ref rN] có bản JSON đầy đủ ở ot-data/rN.json")
  expect(note).toContain("không chép tay số")
})

test("config results.exportDir: used inside the workspace, ignored outside it", () => {
  initRuntime({ cwd: project, home: data, skills: () => [], scratchpad: false, resultFiles: "ot-data" })
  expect(resultExportDir()).toBe(path.join(project, "ot-data"))
  initRuntime({ cwd: project, home: data, skills: () => [], scratchpad: false, resultFiles: "../elsewhere" })
  expect(resultExportDir()).toBeUndefined()
  initRuntime({ cwd: project, home: data, skills: () => [], scratchpad: false })
  expect(resultExportDir()).toBeUndefined()
})
