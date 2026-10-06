import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fillPromptArgs, promptCommands } from "../src/tui/commands"
import { McpManager } from "../src/core/mcp/manager"
import { ToolRegistry } from "../src/core/tools/registry"

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
  await expect(manager.getPrompt("demo", "khong-ton-tai", {})).rejects.toThrow()
  await expect(manager.getPrompt("server-khong-co", "anything", {})).rejects.toThrow()
}, 30_000)
