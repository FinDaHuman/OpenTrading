import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fillPromptArgs, promptCommands } from "../src/tui/commands"
import { resetApprovals, setApprovalHandler } from "../src/core/approvals"
import { McpManager } from "../src/core/mcp/manager"
import { ToolRegistry, TURN_TOOL_BUDGET } from "../src/core/tools/registry"
import { z } from "zod"

test("prompt slash commands expose required args", () => {
  const commands = promptCommands([
    { server: "opentrading", name: "ticker_analysis", description: "7 bước analyze một mã", arguments: [{ name: "symbol", required: true }] },
    { server: "opentrading", name: "morning_briefing", description: "brief đầu phiên", arguments: [{ name: "scope", required: false }] },
  ])
  expect(commands.map((c) => ({ name: c.name, args: c.args }))).toEqual([
    { name: "ticker_analysis", args: "symbol" },
    { name: "morning_briefing", args: undefined },
  ])
  expect(commands[0]!.description).toContain("opentrading")
  expect(commands[0]!.description).toContain("7 bước")
})

test("fillPromptArgs accepts named, positional and rejects missing/extra", () => {
  const args = [{ name: "symbol" }, { name: "days" }]
  expect(fillPromptArgs(args, "symbol=VCB days=5")).toEqual({ symbol: "VCB", days: "5" })
  expect(fillPromptArgs(args, "VCB 5")).toEqual({ symbol: "VCB", days: "5" })
  expect(fillPromptArgs(args, "VCB")).toContain("Thiếu tham số")
  expect(fillPromptArgs(args, "")).toContain("Thiếu tham số")
  expect(fillPromptArgs([], "x")).toContain("thừa")
  expect(fillPromptArgs([{ name: "symbol" }], "symbol=\"VCB Corp\"")).toEqual({ symbol: "VCB Corp" })
})

const dirs: string[] = []
const managers: McpManager[] = []
const DEMO = path.resolve(import.meta.dir, "../examples/mcp-demo/server.ts")

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.stop()))
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

test("a server without prompts reports none; getPrompt fails cleanly", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-p-"))
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ot-p-"))
  dirs.push(home, cwd)
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { demo: { command: process.execPath, args: [DEMO] } } }))
  const manager = new McpManager(new ToolRegistry(), { home, cwd, trustFile: path.join(home, "t.json") })
  managers.push(manager)
  await manager.start()
  expect(manager.status()[0]!.prompts).toEqual([])
  await expect(manager.promptByName("anything", {})).rejects.toThrow("Không có MCP prompt")
}, 30_000)

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
const simpleTool = () => ({
  name: "t",
  description: "",
  input: z.object({}),
  readOnly: true,
  execute: async () => "ok",
})

test("doom-loop: 3rd identical call asks; deny blocks without executing", async () => {
  const registry = new ToolRegistry()
  let runs = 0
  registry.register({ ...simpleTool(), execute: async () => (runs++, "ran") })
  resetApprovals()
  const off = setApprovalHandler(async () => "deny")
  const set = registry.toToolSet() as Record<string, { execute: (i: unknown, o: object) => Promise<string> }>
  const call = () => set["t"]!.execute({}, { toolCallId: "1" })
  expect(await call()).toBe("ran")
  expect(await call()).toBe("ran")
  expect(await call()).toContain("Đã chặn vòng lặp")
  expect(runs).toBe(2)
  off()
})

test("doom-loop: allow keeps going; a different input resets the counter", async () => {
  const registry = new ToolRegistry()
  let runs = 0
  registry.register({ ...simpleTool(), input: z.object({ x: z.string().optional() }), execute: async ({ x }: { x?: string }) => (runs++, `ran ${x ?? ""}`) })
  resetApprovals()
  let ask = 0
  const off = setApprovalHandler(async () => (ask++, "once"))
  const set = registry.toToolSet() as Record<string, { execute: (i: unknown, o: object) => Promise<string> }>
  expect(await set["t"]!.execute({}, { toolCallId: "1" })).toBe("ran ")
  expect(await set["t"]!.execute({}, { toolCallId: "1" })).toBe("ran ")
  expect(await set["t"]!.execute({}, { toolCallId: "1" })).toBe("ran ") // 3rd → asked, allowed
  expect(ask).toBe(1)
  expect(await set["t"]!.execute({ x: "other" }, { toolCallId: "1" })).toBe("ran other") // different input: no ask
  expect(ask).toBe(1)
  off()
})

test("turn budget: after the cap the wrapper answers with a summary nudge", async () => {
  const registry = new ToolRegistry()
  let runs = 0
  registry.register({ ...simpleTool(), execute: async () => (runs++, "ran") })
  const set = registry.toToolSet() as Record<string, { execute: (i: unknown, o: object) => Promise<string> }>
  registry.resetTurnBudgets()
  for (let i = 0; i < TURN_TOOL_BUDGET; i++) await set["t"]!.execute({}, { toolCallId: "1" })
  expect(runs).toBe(TURN_TOOL_BUDGET)
  expect(await set["t"]!.execute({}, { toolCallId: "1" })).toContain("Đã hết ngân sách tool")
  expect(runs).toBe(TURN_TOOL_BUDGET)
})
