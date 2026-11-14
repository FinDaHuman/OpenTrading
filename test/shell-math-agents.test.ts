import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { READ_ONLY, toolFilter } from "../src/core/agents/resolve"
import { Workspace } from "../src/core/fs/workspace"
import { PermissionGate } from "../src/core/permission"
import { childRegistry, childTools } from "../src/core/subagents/manager"
import { ToolRegistry } from "../src/core/tools/registry"
import { shellTool } from "../src/core/tools/shell/shell"
import type { ToolDef } from "../src/core/tools/types"
import { RwLock, runTool } from "../src/core/tools/wrap"

const root = mkdtempSync(path.join(os.tmpdir(), "ot-shell-math-agents-"))
const data = path.join(root, "home", ".opentrading")
const project = path.join(root, "project")
mkdirSync(data, { recursive: true })
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true }))

const win = process.platform === "win32"
const ws = () => new Workspace(project, { home: path.join(root, "home"), data })
const ctx = () => ({ signal: new AbortController().signal, callId: "a" })
const text = (r: string | { output: string }) => (typeof r === "string" ? r : r.output)
const quote: ToolDef = { name: "mcp__data__quote", description: "q", input: z.object({}), readOnly: true, source: "mcp:data", execute: async () => "q" }
const ARITH = win ? "[math]::Round(31250/4520, 2)" : String.raw`awk 'BEGIN{printf "%.2f\n", 31250/4520}'`

function parent() {
  const registry = new ToolRegistry()
  registry.gate = new PermissionGate({ load: async () => [], save: async () => {} })
  registry.workspace = ws()
  registry.register(shellTool(ws()))
  registry.register(quote)
  return registry
}

test("read-only agents (@chi-doc, ultradesk) get shell for arithmetic only; typed tool lists and the main agent keep theirs", () => {
  const reg = parent()
  const full = reg.get("shell")!
  expect(full.readOnly).toBe(false)
  expect(full.readOnlyVariant?.readOnly).toBe(true)

  const chiDoc = childTools(reg.list(), toolFilter({ tools: [READ_ONLY] }))
  const shell = chiDoc.find((t) => t.name === "shell")!
  expect(shell).toBe(full.readOnlyVariant!)
  expect(shell.effect).toBeUndefined()
  expect(shell.description).toContain("Máy tính")

  // The ultradesk filter: read-only tools only.
  expect(childTools(reg.list(), (d) => d.readOnly).map((t) => t.name).sort()).toEqual(["mcp__data__quote", "shell"])
  // A type that lists its tools by name gets no shell; one with every tool gets the full one.
  expect(childTools(reg.list(), toolFilter({ tools: ["mcp__data__*"] })).map((t) => t.name)).toEqual(["mcp__data__quote"])
  expect(childTools(reg.list(), toolFilter({ tools: [READ_ONLY], disallowedTools: ["shell"] })).map((t) => t.name)).toEqual(["mcp__data__quote"])
  expect(childTools(reg.list(), toolFilter({})).find((t) => t.name === "shell")).toBe(full)
})

test("a @chi-doc subagent's shell runs arithmetic and refuses anything else without asking the user", async () => {
  const reg = parent()
  reg.gate!.setMode("read-only")
  const child = childRegistry(reg, { id: "ag-1", type: "phan-tich", description: "x" }, toolFilter({ tools: [READ_ONLY] }))
  const shell = child.get("shell")!
  expect(text(await runTool(shell, { command: ARITH }, ctx(), new RwLock(), child.gate))).toContain("6.91")
  // Anything else: never put to the user (not interactive, an ask would say "headless"); the
  // model reads a tool error with the accepted form, not a denial telling it to stop.
  const other = win ? "Get-Date" : "date"
  expect(await child.gate!.check(shell, { command: other }, new AbortController().signal)).toEqual({ allow: true })
  const error = await runTool(shell, { command: other }, ctx(), new RwLock(), child.gate).then(
    () => "",
    (e: Error) => e.message,
  )
  expect(error).toContain("không phải phép tính thuần")
  expect(error).toContain(win ? "[math]::Round" : "awk 'BEGIN{")
  expect(error).not.toContain("Đừng thử lại")
  // Without a gate the tool itself still refuses.
  await expect(shell.execute({ command: other }, ctx())).rejects.toThrow("phép tính thuần")
}, 30_000)
