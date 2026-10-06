import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { McpManager } from "../src/core/mcp/manager"
import { ToolRegistry } from "../src/core/tools/registry"

const dirs: string[] = []
const managers: McpManager[] = []
const DEMO = path.resolve(import.meta.dir, "../examples/mcp-demo/server.ts")

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.stop()))
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

// `expect(promise).rejects` hangs on MCP SDK promises (see test/mcp.test.ts), so catch by hand.
async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return "(no error)"
}

test("getPrompt fails with a message for an unknown prompt or server", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-p-"))
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ot-p-"))
  dirs.push(home, cwd)
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { demo: { command: process.execPath, args: [DEMO] } } }))
  const manager = new McpManager(new ToolRegistry(), { home, cwd, trustFile: path.join(home, "t.json") })
  managers.push(manager)
  await manager.start()
  expect(manager.allPrompts().map((p) => p.server)).toContain("demo")
  expect(await errorOf(manager.getPrompt("demo", "missing", {}))).not.toBe("(no error)")
  expect(await errorOf(manager.getPrompt("nope", "anything", {}))).toContain("chưa kết nối")
})
