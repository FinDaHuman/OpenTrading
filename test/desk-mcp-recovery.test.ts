import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { chunkFor, sse } from "./helpers/chat"
import { startHttpServer } from "./fixtures/remote-mcp"

const home = await mkdtemp(path.join(os.tmpdir(), "ot-desk-mcp-"))
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"

const text = { input: ["text"], output: ["text"] }
const catalog = { groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], npm: "@ai-sdk/groq", models: { tooly: { id: "tooly", name: "Tooly", tool_call: true, modalities: text } } } }
const chunk = chunkFor("tooly")
const originalFetch = globalThis.fetch
let callId = 0
let recovery: { seen: number; allFailed: () => void; allowA: Promise<void> } | undefined
let plainReports = false

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(catalog)
  if (!url.endsWith("/chat/completions")) return originalFetch(input, init)
  const body = JSON.parse(String(init?.body)) as { messages: { role: string; content?: unknown }[] }
  const tools = body.messages.filter((message) => message.role === "tool")
  const tool = tools.at(-1)
  const source = JSON.stringify(body.messages).match(/SOURCE_[ABC]/)?.[0]
  if (!source) throw new Error("Missing agent source")
  if (tool && plainReports) return sse([chunk({ role: "assistant", content: `Report for ${source}` }), chunk({}, "stop")])
  if (recovery && tools.length === 1) {
    if (++recovery.seen === 3) recovery.allFailed()
    if (source === "SOURCE_A") await recovery.allowA
  }
  const retry = recovery && source === "SOURCE_A" && tools.length === 1
  const call = tool && !retry
    ? { name: "tra_ket_qua", args: { source, evidence: JSON.stringify(tool.content) } }
    : { name: "mcp__data__echo", args: { text: source } }
  return sse([
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${++callId}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }),
    chunk({}, "tool_calls"),
  ])
}) as typeof fetch

const { ToolRegistry } = await import("../src/core/tools/registry")
const { McpManager } = await import("../src/core/mcp/manager")
const { SubagentManager } = await import("../src/core/subagents/manager")
const { DeskEngine } = await import("../src/core/desk/engine")
const { deskNotification } = await import("../src/core/desk/notification")
const { saveConfig } = await import("../src/core/config")
const { setKey } = await import("../src/core/auth")

beforeAll(async () => {
  await setKey("groq", "gsk_test")
  await saveConfig({ provider: "groq", model: "tooly", toolSearch: "off", subagents: { maxConcurrent: 3 } })
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await rm(home, { recursive: true, force: true })
})

const resultSchema = z.object({ source: z.string(), evidence: z.string() })
const agents = [{ name: "tra-cuu", description: "lookup", tools: ["@chi-doc"], body: "", file: "lookup.md", source: "bundled" as const }]
const playbook = {
  meta: { name: "parallel", version: "1", description: "lookup", whenToUse: "lookup", args: z.object({}), agentTypes: ["tra-cuu"], phases: ["lookup"], estimate: () => ({ agents: 3, requests: 9 }) },
  run: (ctx: { agent: (prompt: string, opts: object) => Promise<unknown> }) => Promise.all(["SOURCE_A", "SOURCE_B", "SOURCE_C"].map((source) => ctx.agent(source, { label: source, schema: resultSchema }))),
}

async function runDesk(remote: ReturnType<typeof startHttpServer>) {
  const registry = new ToolRegistry()
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { data: { type: "http", url: remote.url } } }))
  const mcp = new McpManager(registry, { home, cwd: home, trustFile: path.join(home, "trust.json"), retryDelaysMs: [10], reconnectDelaysMs: [10], callRetryDelaysMs: [10] })
  try {
    await mcp.start()
    const manager = new SubagentManager({ parent: registry, skills: () => [] })
    const desk = new DeskEngine({ starter: manager, agents: () => agents, playbooks: () => [playbook], config: async () => ({ desk: { staggerMs: 0, maxConcurrent: 3 } }) })
    const view = await (await desk.start("parallel", {})).done
    expect(view.status).toBe("done")
    expect(view.agents).toHaveLength(3)
    expect(view.agents.every((agent) => !agent.dataGaps?.length)).toBe(true)
    const results = z.array(resultSchema).parse(view.result)
    for (const source of ["SOURCE_A", "SOURCE_B", "SOURCE_C"]) {
      expect(results.find((result) => result.source === source)?.evidence).toContain(source)
    }
    expect(deskNotification(view)).not.toContain("Missing data:")
  } finally {
    await mcp.stop()
    remote.stop()
  }
}

test("three desk agents share a single restart when their MCP session expires", async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    let initializations = 0
    let arrived = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const remote = startHttpServer({ onRequest: async (_request, method) => {
      if (method === "initialize") initializations++
      if (method !== "tools/call" || arrived >= 3) return
      arrived++
      if (arrived === 3) release()
      await barrier
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found" } }, { status: 404 })
    } })
    await runDesk(remote)
    expect(arrived).toBe(3)
    expect(initializations).toBe(2)
  }
}, 20_000)

test("ordinary subagents tell the main agent about each unrecovered source", async () => {
  plainReports = true
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      let arrived = 0
      let release!: () => void
      const barrier = new Promise<void>((resolve) => { release = resolve })
      const remote = startHttpServer({ onRequest: async (_request, method) => {
        if (method !== "tools/call") return
        if (++arrived === 3) release()
        await barrier
        return new Response("unavailable", { status: 503 })
      } })
      const registry = new ToolRegistry()
      await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { data: { type: "http", url: remote.url } } }))
      const mcp = new McpManager(registry, { home, cwd: home, trustFile: path.join(home, "trust.json"), callRetryDelaysMs: [] })
      try {
        await mcp.start()
        const manager = new SubagentManager({ parent: registry, skills: () => [] })
        const results = await Promise.all(["SOURCE_A", "SOURCE_B", "SOURCE_C"].map((source) => manager.start({ description: source, prompt: source }).done))
        expect(arrived).toBe(3)
        for (const result of results) {
          expect(result.dataGaps).toEqual(["echo"])
          expect(result.text).toContain("failed sources not recovered in this run: echo")
        }
      } finally {
        await mcp.stop()
        remote.stop()
      }
    }
  } finally {
    plainReports = false
  }
}, 20_000)

test("three desk agents wait for one reconnect after a 503 outage", async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    let initializations = 0
    let arrived = 0
    let probes = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const remote = startHttpServer({ onRequest: async (_request, method) => {
      if (method === "initialize") initializations++
      if (method === "ping" && arrived >= 3 && probes === 0) {
        probes++
        return new Response("unavailable", { status: 503 })
      }
      if (method !== "tools/call" || arrived >= 3) return
      arrived++
      if (arrived === 3) release()
      await barrier
      return new Response("unavailable", { status: 503 })
    } })
    await runDesk(remote)
    expect(arrived).toBe(3)
    expect(probes).toBe(1)
    expect(initializations).toBe(2)
  }
}, 20_000)

test("an open breaker refuses calls, then one recovering agent clears only its own gap", async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    let clock = 0
    let arrivals = 0
    let online = false
    let initializations = 0
    let probeStarted!: () => void
    const probeArrived = new Promise<void>((resolve) => { probeStarted = resolve })
    let releaseProbe!: () => void
    const probeGate = new Promise<void>((resolve) => { releaseProbe = resolve })
    let releaseRequests!: () => void
    const barrier = new Promise<void>((resolve) => { releaseRequests = resolve })
    let allFailed!: () => void
    const failures = new Promise<void>((resolve) => { allFailed = resolve })
    let releaseA!: () => void
    const allowA = new Promise<void>((resolve) => { releaseA = resolve })
    recovery = { seen: 0, allFailed, allowA }
    const remote = startHttpServer({ onRequest: async (_request, method) => {
      if (method === "initialize" && ++initializations > 1 && !online) return new Response("unavailable", { status: 503 })
      if (method === "ping" && !online) return new Response("unavailable", { status: 503 })
      if (method !== "tools/call") return
      arrivals++
      if (arrivals > 3) {
        probeStarted()
        await probeGate
        return
      }
      if (arrivals === 3) releaseRequests()
      await barrier
      return new Response("unavailable", { status: 503 })
    } })
    const registry = new ToolRegistry()
    await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { data: { type: "http", url: remote.url, startupTimeoutMs: 300 } } }))
    const mcp = new McpManager(registry, { home, cwd: home, trustFile: path.join(home, "trust.json"), retryDelaysMs: [10], reconnectDelaysMs: [10], callRetryDelaysMs: [], breakerOpenMs: 1000, breakerNow: () => clock })
    try {
      await mcp.start()
      const manager = new SubagentManager({ parent: registry, skills: () => [] })
      const desk = new DeskEngine({ starter: manager, agents: () => agents, playbooks: () => [playbook], config: async () => ({ desk: { staggerMs: 0, maxConcurrent: 3 } }) })
      const run = await desk.start("parallel", {})
      await failures
      const echo = registry.get("mcp__data__echo")!
      const ctx = { signal: new AbortController().signal, callId: "blocked" }
      await expect(Promise.resolve(echo.execute({ text: "blocked" }, ctx))).rejects.toThrow("this call was not sent")
      expect(arrivals).toBe(3)
      online = true
      clock = 1001
      releaseA()
      await probeArrived
      await expect(Promise.resolve(echo.execute({ text: "second probe" }, ctx))).rejects.toThrow("this call was not sent")
      expect(arrivals).toBe(4)
      releaseProbe()
      const view = await run.done
      expect(view.status).toBe("done")
      expect(arrivals).toBe(4)
      expect(view.agents.find((agent) => agent.label === "SOURCE_A")?.dataGaps).toBeUndefined()
      for (const source of ["SOURCE_B", "SOURCE_C"]) expect(view.agents.find((agent) => agent.label === source)?.dataGaps).toEqual(["echo"])
      const notice = deskNotification(view)
      expect(notice).toContain("SOURCE_B (echo)")
      expect(notice).toContain("SOURCE_C (echo)")
      expect(notice).not.toContain("SOURCE_A (echo)")
    } finally {
      releaseA()
      releaseProbe()
      recovery = undefined
      await mcp.stop()
      remote.stop()
    }
  }
}, 20_000)
