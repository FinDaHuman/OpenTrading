import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Workspace } from "../src/core/fs/workspace"
import { modeNote } from "../src/core/permission/mode"
import { ToolRegistry } from "../src/core/tools/registry"
import { shellTool } from "../src/core/tools/shell/shell"

/**
 * A host can keep the shell and drop the file tools (a benchmark runner keeps MCP + shell). The
 * model must not be sent to read_file, grep_files or write_file then: the shell description, the
 * `<quyen_tep>` workspace line and its mode line name only the tools the registry holds.
 */

const root = mkdtempSync(path.join(os.tmpdir(), "ot-file-hints-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const home = path.join(root, "home")
const data = path.join(home, ".opentrading")
const project = path.join(root, "project")
for (const dir of [data, project]) mkdirSync(dir, { recursive: true })
const ws = () => new Workspace(project, { home, data })
const BASH = { kind: "bash" as const, path: "/bin/bash" }
const FILE_TOOLS = ["read_file", "glob_files", "grep_files", "write_file", "edit_file"]

test("shell description names every file tool when they are registered, none when they are not", () => {
  const shell = shellTool(ws(), { shell: BASH })
  const all = shell.descriptionFor!(new Set(["shell", ...FILE_TOOLS]))
  expect(all).toBe(shell.description)
  for (const name of FILE_TOOLS) expect(all).toContain(name)
  const bare = shell.descriptionFor!(new Set(["shell", "read_result"]))
  for (const name of FILE_TOOLS) expect(bare).not.toContain(name)
  expect(bare).toContain("lệnh chờ nhập từ bàn phím")
  expect(bare).toContain("output dài được lưu ra file.")
  const some = shell.descriptionFor!(new Set(["shell", "read_file"]))
  expect(some).toContain("(dùng read_file)")
  expect(some).toContain("để đọc tiếp bằng read_file")
})

test("the request's shell definition follows the registry", () => {
  const registry = new ToolRegistry()
  registry.register(shellTool(ws(), { shell: BASH }))
  const description = (registry.toToolSet({}).tools.shell as { description?: string }).description!
  for (const name of FILE_TOOLS) expect(description).not.toContain(name)
})

test("<quyen_tep>: the workspace line and the read-only mode line name only registered file tools", () => {
  const w = ws()
  expect(w.describe()).toContain("read_file; tìm file bằng glob_files, tìm chữ trong file bằng grep_files")
  expect(w.describe(new Set(FILE_TOOLS))).toBe(w.describe())
  const bare = w.describe(new Set(["shell"]))
  for (const name of FILE_TOOLS) expect(bare).not.toContain(name)
  expect(bare).toContain("Đường dẫn tương đối tính từ workspace.")
  expect(w.describe(new Set(["shell", "grep_files"]))).toContain("Đường dẫn tương đối tính từ workspace. Tìm chữ trong file bằng grep_files.")

  expect(modeNote("read-only", new Set(FILE_TOOLS))).toBe(modeNote("read-only"))
  const note = modeNote("read-only", new Set(["shell"]))
  expect(note).not.toContain("write_file")
  expect(note).not.toContain("edit_file")
  expect(note).toContain("Chạy lệnh (shell) cần người dùng duyệt")
  expect(modeNote("read-only", new Set(["write_file"]))).toContain("Ghi file (write_file) và chạy lệnh")
})

test("shell description in ▸▸▸ bypass: commands run as written, Python is named, no grammar limits (issue #309)", () => {
  const shell = shellTool(ws(), { shell: BASH, python: () => "python3" })
  const present = new Set(["shell", ...FILE_TOOLS])
  for (const mode of ["read-only", "ask", "auto"] as const) expect(shell.descriptionFor!(present, mode)).toBe(shell.description)
  const bypass = shell.descriptionFor!(present, "bypass")
  expect(bypass).toContain("Lệnh chạy ngay như đã viết, không ai duyệt")
  expect(bypass).toContain("python3 -c")
  expect(bypass).toContain(String.raw`printf "%.15g\n"`)
  expect(bypass).not.toContain("không chạy mà trả lại dạng đúng")
  expect(bypass).not.toContain("người dùng duyệt")
  expect(bypass).not.toContain("không mảng")
  const registry = new ToolRegistry()
  registry.register(shellTool(ws(), { shell: BASH, python: () => undefined }))
  registry.gate = { mode: "bypass" } as never
  expect((registry.toToolSet({}).tools.shell as { description?: string }).description).toContain("Lệnh chạy ngay như đã viết")
})

test("▸▸▸ mode line: short for a program caller, unchanged for a person (issue #309)", () => {
  const person = modeNote("bypass")
  expect(modeNote("bypass", undefined, "terminal")).toBe(person)
  const program = modeNote("bypass", undefined, "machine")
  expect(program.length).toBeLessThan(person.length * 0.6)
  for (const kept of ["không ai duyệt", "Không xoá hay ghi đè dữ liệu có sẵn", "không gửi dữ liệu ra ngoài", "không đặt lệnh hay chuyển tiền thật"]) expect(program).toContain(kept)
  expect(modeNote("read-only", undefined, "machine")).toBe(modeNote("read-only"))
})

test("▸▸▸ bypass names Python only when it really runs, and never sends PowerShell into a nested powershell (16/11)", () => {
  const present = new Set(["shell"])
  const PS = { kind: "powershell" as const, path: "powershell.exe" }
  // Windows with only the Store alias: no Python in the text, PowerShell arrays instead, no wrapping.
  const none = shellTool(ws(), { shell: PS, python: () => undefined }).descriptionFor!(present, "bypass")
  expect(none).not.toContain("Python")
  expect(none).toContain("Measure-Object")
  expect(none).toContain("không bọc thêm `powershell -Command`")
  const withPy = shellTool(ws(), { shell: PS, python: () => "python" }).descriptionFor!(present, "bypass")
  expect(withPy).toContain("`python -c`")
  expect(withPy).not.toContain("heredoc")
  // bash without Python: awk with arrays and loops.
  const bash = shellTool(ws(), { shell: BASH, python: () => undefined }).descriptionFor!(present, "bypass")
  expect(bash).not.toContain("Python")
  expect(bash).toContain("mảng và vòng lặp chạy được")
  // The probe runs only for the bypass text.
  let probes = 0
  const lazy = shellTool(ws(), { shell: BASH, python: () => (probes++, "python3") })
  for (const mode of ["read-only", "ask", "auto"] as const) lazy.descriptionFor!(present, mode)
  expect(probes).toBe(0)
})

test("tool_search shows the description the request declares for the mode, not the static one", async () => {
  const { describeTool } = await import("../src/core/tools/search")
  const registry = new ToolRegistry()
  const shell = shellTool(ws(), { shell: BASH, python: () => "python3" })
  registry.register(shell)
  registry.gate = { mode: "bypass" } as never
  // The card is the declared text (clipped): with only the shell registered it names no file tool,
  // where the static description sends the model to read_file.
  const card = describeTool(registry, shell)
  expect(card).toContain(shell.descriptionFor!(new Set(["shell"]), "bypass").slice(0, 300))
  expect(card).not.toContain("read_file")
  expect(shell.description).toContain("read_file")
})

test("detectPython returns only a command that ran a script (a Store alias or a missing one gives undefined)", async () => {
  const { detectPython } = await import("../src/core/tools/shell/run")
  const py = detectPython()
  expect(detectPython()).toBe(py) // checked once per process
  if (py) expect(Bun.spawnSync([py, "-c", "print(1)"]).exitCode).toBe(0)
})
