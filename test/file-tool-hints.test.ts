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
