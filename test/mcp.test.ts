import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expandConfig, expandEnv, loadServers } from "../src/core/mcp/config"
import { resultToOutput, resultToText } from "../src/core/mcp/convert"
import { McpManager } from "../src/core/mcp/manager"
import { MAX_TOOL_NAME, toolName } from "../src/core/mcp/naming"
import { ToolRegistry } from "../src/core/tools/registry"

const DEMO = path.resolve(import.meta.dir, "../examples/mcp-demo/server.ts")
// Spawn with the running Bun binary so the test never depends on PATH (Windows CI).
const demoConfig = { command: process.execPath, args: [DEMO] }

const dirs: string[] = []
const managers: McpManager[] = []

async function setup(global?: object, project?: object) {
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-home-"))
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ot-cwd-"))
  dirs.push(home, cwd)
  if (global) await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: global }))
  if (project) await writeFile(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: project }))
  const registry = new ToolRegistry()
  const manager = new McpManager(registry, { home, cwd, trustFile: path.join(home, "mcp-trust.json") })
  managers.push(manager)
  return { home, cwd, registry, manager }
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.stop()))
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const ctx = { signal: new AbortController().signal, callId: "c1" }

/** Resolve to the rejection message (Bun's `.rejects` hung on SDK promises in practice). */
async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return "(no error)"
}

test("tool names are sanitised, length-limited and collision-free", () => {
  expect(toolName("vn stock", "get.quote")).toBe("mcp__vn_stock__get_quote")
  const long = toolName("server", "x".repeat(100))
  expect(long.length).toBe(MAX_TOOL_NAME)
  expect(long).toMatch(/^mcp__server__x+_[0-9a-f]{8}$/)
  const first = toolName("s", "a.b")
  const second = toolName("s", "a_b", new Set([first]))
  expect(second).not.toBe(first)
  expect(second).toMatch(/^[A-Za-z0-9_-]+$/)
})

test("env expansion supports defaults and reports missing variables", () => {
  const env = { TOKEN: "abc" }
  expect(expandEnv("Bearer ${TOKEN}", env).value).toBe("Bearer abc")
  expect(expandEnv("${HOST:-localhost}:8080", env).value).toBe("localhost:8080")
  expect(expandEnv("${NOPE}", env).missing).toEqual(["NOPE"])
  const { config, missing } = expandConfig({ command: "x", env: { KEY: "${TOKEN}", OTHER: "${MISSING}" } }, env)
  expect("env" in config && config.env).toEqual({ KEY: "abc", OTHER: "" })
  expect(missing).toEqual(["MISSING"])
})

test("MCP results: text, structured fallback, images kept for the model, isError throws", () => {
  expect(resultToText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\n\nb")
  expect(resultToText({ content: [], structuredContent: { x: 1 } })).toContain('"x": 1')
  expect(resultToText({ content: [{ type: "image", mimeType: "image/png" }] })).toContain("image/png")
  expect(() => resultToText({ isError: true, content: [{ type: "text", text: "hỏng" }] })).toThrow("hỏng")
  expect(resultToOutput({ content: [{ type: "text", text: "chụp" }, { type: "image", data: "AAA=", mimeType: "image/png" }] })).toEqual({
    output: "chụp",
    images: [{ data: "AAA=", mediaType: "image/png" }],
  })
  expect(resultToOutput({ content: [{ type: "resource", resource: { uri: "file:///a.png", blob: "BBB=", mimeType: "image/png" } }] })).toEqual({
    output: "(tool trả về 1 ảnh)",
    images: [{ data: "BBB=", mediaType: "image/png" }],
  })
  expect(resultToOutput({ content: [{ type: "resource", resource: { uri: "file:///a.pdf", blob: "CCC=", mimeType: "application/pdf" } }] })).toBe(
    "[tài nguyên: file:///a.pdf (application/pdf)]",
  )
})

test("config: project overrides global, invalid entries become errors", async () => {
  const { home, cwd } = await setup({ demo: demoConfig, bad: { args: [] } }, { demo: { type: "http", url: "https://x.test/mcp" } })
  const servers = await loadServers(home, cwd)
  const demo = servers.find((s) => s.name === "demo")!
  expect(demo.scope).toBe("project")
  expect(servers.find((s) => s.name === "bad")!.error).toContain("không hợp lệ")
})

test("config: a UTF-8 BOM is read; a file that does not parse is an error, not 'no servers'", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-mcp-bom-"))
  try {
    const file = path.join(home, "mcp.json")
    await writeFile(file, "﻿" + JSON.stringify({ mcpServers: { tat: { command: "x", disabled: true } } }), "utf8")
    expect((await loadServers(home, home)).map((s) => [s.name, s.error])).toEqual([["tat", undefined]])
    await writeFile(file, "{ mcpServers: ", "utf8")
    const [broken] = await loadServers(home, home)
    expect(broken!.error).toContain("không phải JSON hợp lệ")
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("connects to the demo server over stdio and calls its tools", async () => {
  const { registry, manager } = await setup({ demo: demoConfig })
  await manager.start()
  const status = manager.status()[0]!
  expect(status.error).toBeUndefined()
  expect(status.state).toBe("connected")
  expect(status.tools.sort()).toEqual(["mcp__demo__add", "mcp__demo__echo", "mcp__demo__fail", "mcp__demo__ghi_chu"])

  const add = registry.get("mcp__demo__add")!
  expect(add.readOnly).toBe(true)
  // Server instructions and _meta hints reach the harness.
  expect(manager.instructions()).toEqual([{ server: "demo", text: expect.stringContaining("echo để thử kết nối") }])
  expect(registry.get("mcp__demo__echo")!.searchHint).toBe("lap lai van ban | repeat ping")
  expect(registry.get("mcp__demo__echo")!.deferrable).toBe(true)
  expect(add.deferrable).toBe(false) // _meta["anthropic/alwaysLoad"]
  expect(await add.execute({ a: 2, b: 3 }, ctx)).toBe("5")
  expect(await errorOf(registry.get("mcp__demo__fail")!.execute({}, ctx))).toContain("cố ý")

  await manager.stop()
  expect(registry.list()).toHaveLength(0)
  expect(manager.instructions()).toEqual([])
}, 30_000)

test("stop() leaves no server process behind", async () => {
  const { manager } = await setup({ demo: demoConfig })
  await manager.start()
  const pid = (manager as unknown as { live: Map<string, { transport: { pid: number | null } }> }).live.get("demo")!.transport.pid!
  expect(pid).toBeGreaterThan(0)
  await manager.stop()
  await new Promise((r) => setTimeout(r, 300))
  let alive = true
  try {
    process.kill(pid, 0)
  } catch {
    alive = false
  }
  expect(alive).toBe(false)
}, 30_000)

test("a server that cannot start is reported as failed, not thrown", async () => {
  const { manager } = await setup({ broken: { command: "opentrading-no-such-command-xyz" } })
  await manager.start()
  const status = manager.status()[0]!
  expect(status.state).toBe("failed")
  expect(status.error).toBeTruthy()
}, 40_000)

test("missing env vars fail fast with the variable name", async () => {
  const { manager } = await setup({ demo: { ...demoConfig, env: { API: "${OT_TEST_UNSET_VAR}" } } })
  await manager.start()
  const status = manager.status()[0]!
  expect(status.state).toBe("failed")
  expect(status.error).toContain("Thiếu biến: OT_TEST_UNSET_VAR")
  expect(status.error).toContain("opentrading mcp secret set OT_TEST_UNSET_VAR")
})

test("project servers wait for approval, then connect", async () => {
  const { manager, registry } = await setup(undefined, { demo: demoConfig })
  await manager.start()
  expect(manager.status()[0]!.state).toBe("untrusted")
  expect(registry.list()).toHaveLength(0)
  await manager.trust("demo")
  expect(manager.status()[0]!.state).toBe("connected")
}, 30_000)

test("approval is tied to what runs: changing env or cwd asks again", async () => {
  const { trustKey } = await import("../src/core/mcp/trust")
  const base = { command: "node", args: ["server.js"] }
  const key = trustKey("/p", "s", base)
  expect(trustKey("/p", "s", { ...base })).toBe(key)
  expect(trustKey("/p", "s", { ...base, env: { NODE_OPTIONS: "--require evil.js" } })).not.toBe(key)
  expect(trustKey("/p", "s", { ...base, cwd: "../other" })).not.toBe(key)
  expect(trustKey("/other", "s", base)).not.toBe(key)
})

test("disabled servers are not started", async () => {
  const { manager } = await setup({ demo: { ...demoConfig, enabled: false } })
  await manager.start()
  expect(manager.status()[0]!.state).toBe("disabled")
})

// Regression tests for the QA reports of 27/10/2026.
const PAGED = path.resolve(import.meta.dir, "fixtures/mcp-paged-server.ts")
const paged = (env: Record<string, string>) => ({ command: process.execPath, args: [PAGED], env })

test("pagination stops at the caps: 1500+1500 tools → 2048, 400+400 prompts → 512, 700+700 resources → 1000 (BUG-OT-20261027-003)", async () => {
  const { manager } = await setup({ big: paged({ PAGES: "1500,1500" }) })
  await manager.start()
  const status = manager.status()[0]!
  expect(status.state).toBe("connected")
  expect(status.tools).toHaveLength(2048)
  expect(status.capped).toEqual(["tools"])
  await manager.stop()

  const prompts = await setup({ big: paged({ PAGES: "400,400" }) })
  await prompts.manager.start()
  expect(prompts.manager.allPrompts()).toHaveLength(512)
  expect(prompts.manager.status()[0]!.capped).toEqual(["prompts"])
  await prompts.manager.stop()

  const resources = await setup({ big: paged({ PAGES: "700,700" }) })
  await resources.manager.start()
  expect(await resources.manager.listResources()).toHaveLength(1000)
  await resources.manager.stop()
}, 60_000)

test("pagination at the cap boundary: cap-1 and cap exactly are not marked capped, cap+1 is", async () => {
  for (const [pages, tools, capped] of [["2047", 2047, undefined], ["2000,48", 2048, undefined], ["2000,49", 2048, ["tools"]]] as const) {
    const { manager } = await setup({ edge: paged({ PAGES: pages }) })
    await manager.start()
    expect(manager.status()[0]!.tools).toHaveLength(tools)
    expect(manager.status()[0]!.capped).toEqual(capped ? [...capped] : undefined)
    await manager.stop()
  }
}, 60_000)

test("a raw tool name equal to another tool's shortened name never makes them share one (BUG-OT-20261027-004)", async () => {
  const long = "x".repeat(100)
  const shortened = toolName("paged", long)
  const raw = shortened.slice("mcp__paged__".length)
  // The unit case: a shortened name that is taken gets a different hash.
  expect(toolName("paged", long, new Set([shortened]))).not.toBe(shortened)
  // Through McpManager: the short raw name registers first and takes the name as is.
  const { registry, manager } = await setup({ paged: paged({ NAME_CLASH: JSON.stringify([raw, long]) }) })
  await manager.start()
  const names = manager.status()[0]!.tools
  expect(names).toHaveLength(2)
  expect(new Set(names).size).toBe(2)
  expect(names.every((n) => n.length <= MAX_TOOL_NAME)).toBe(true)
  expect(registry.list().filter((t) => t.name.startsWith("mcp__paged__"))).toHaveLength(2)
}, 30_000)
