import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { McpManager } from "../src/core/mcp/manager"
import { ToolRegistry } from "../src/core/tools/registry"
import { startFailureScenario } from "./fixtures/failure-scenario"

test("fixed eval scenario provides VCB and returns an MCP error for BID", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-failure-scenario-"))
  const remote = startFailureScenario()
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { data: { type: "http", url: remote.url } } }))
  const registry = new ToolRegistry()
  const mcp = new McpManager(registry, { home, cwd: home, trustFile: path.join(home, "trust.json"), callRetryDelaysMs: [] })
  try {
    await mcp.start()
    const ctx = { signal: new AbortController().signal, callId: "fixture" }
    const vcb = await registry.get("mcp__data__vcb_ratios")!.execute({}, ctx)
    expect(String(vcb)).toContain("P/E 8.4")
    await expect(Promise.resolve(registry.get("mcp__data__bid_ratios")!.execute({}, ctx))).rejects.toThrow("BID test ratios source is unavailable")
    expect(remote.calls).toEqual(["vcb_ratios", "bid_ratios"])
  } finally {
    await mcp.stop()
    remote.stop()
    await rm(home, { recursive: true, force: true })
  }
})

test("late-recovery scenario returns VCB on its third attempt and leaves BID unavailable", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-failure-scenario-"))
  const remote = startFailureScenario({ vcbFailures: 2 })
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { data: { type: "http", url: remote.url } } }))
  const registry = new ToolRegistry()
  const mcp = new McpManager(registry, { home, cwd: home, trustFile: path.join(home, "trust.json"), callRetryDelaysMs: [] })
  try {
    await mcp.start()
    const ctx = { signal: new AbortController().signal, callId: "fixture" }
    const vcb = registry.get("mcp__data__vcb_ratios")!
    for (let i = 0; i < 2; i++) await expect(Promise.resolve(vcb.execute({}, ctx))).rejects.toThrow("VCB test ratios source is unavailable")
    expect(String(await vcb.execute({}, ctx))).toContain("P/E 8.4")
    await expect(Promise.resolve(registry.get("mcp__data__bid_ratios")!.execute({}, ctx))).rejects.toThrow("BID test ratios source is unavailable")
  } finally {
    await mcp.stop()
    remote.stop()
    await rm(home, { recursive: true, force: true })
  }
})
