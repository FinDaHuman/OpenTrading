import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-subagent-"))
process.env.OPENTRADING_HOME = home

const text = { input: ["text"], output: ["text"] }
const CATALOG = {
  groq: {
    id: "groq",
    name: "Groq",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/groq",
    models: {
      tooly: { id: "tooly", name: "Tooly", tool_call: true, modalities: text },
      other: { id: "other", name: "Other", tool_call: true, modalities: text },
      plain: { id: "plain", name: "Plain", tool_call: false, modalities: text },
    },
  },
}

type Msg = { role: string; content?: unknown; tool_calls?: unknown[] }
type Body = { model: string; messages: Msg[]; tools?: { function: { name: string } }[]; tool_choice?: unknown; stream?: boolean }
type Call = { name: string; args: object }

const parentBodies: Body[] = []
const childBodies: Body[] = []
/** The parent's first answer: these tool calls (all in one step); then plain text. */
let parentCalls: Call[] = []
/** A child's first answer: this tool call (or none); then its report. */
let childCall: Call | undefined
let childReport = "Báo cáo: FPT ổn."
let childStatus: number | undefined
let childUsage = { prompt_tokens: 1_000, completion_tokens: 200 }

const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  })
const chunk = (delta: object, finish: string | null = null, extra: object = {}) => ({
  id: "c",
  object: "chat.completion.chunk",
  created: 1,
  model: "tooly",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...extra,
})
let ids = 0
const toolCalls = (calls: Call[]) =>
  sse([
    chunk({
      role: "assistant",
      tool_calls: calls.map((c, index) => ({ index, id: `call_${++ids}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    }),
    chunk({}, "tool_calls"),
  ])
const answer = (content: string, usage?: object) =>
  sse([chunk({ role: "assistant", content }), chunk({}, "stop", usage ? { x_groq: { usage } } : {})])

const isChild = (body: Body) => typeof body.messages[0]?.content === "string" && (body.messages[0].content as string).includes("<subagent>")

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (!url.endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`)
  const body = JSON.parse(String(init?.body)) as Body
  const hasToolResult = body.messages.some((m) => m.role === "tool")
  if (isChild(body)) {
    childBodies.push(body)
    if (childStatus) return Response.json({ error: { message: "upstream down", type: "server_error" } }, { status: childStatus })
    if (childCall && !hasToolResult && body.tool_choice !== "none") return toolCalls([childCall])
    return answer(childReport, childUsage)
  }
  parentBodies.push(body)
  if (parentCalls.length > 0 && !hasToolResult && body.tool_choice !== "none") return toolCalls(parentCalls)
  return answer("Đã tổng hợp.")
}) as typeof fetch

const { runAgent } = await import("../src/core/agent")
const { ToolRegistry } = await import("../src/core/tools/registry")
const { currentTimeTool } = await import("../src/core/tools/builtin/current-time")
const { saveConfig } = await import("../src/core/config")
const { setKey } = await import("../src/core/auth")
const { PermissionGate } = await import("../src/core/permission")
const { SubagentManager } = await import("../src/core/subagents/manager")
const { spawnSubagentTool } = await import("../src/core/tools/subagent/spawn")
const { parseTrailer } = await import("../src/core/subagents/result")
type AgentEvent = import("../src/core/events").AgentEvent

beforeAll(async () => {
  await setKey("groq", "gsk_test")
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await rm(home, { recursive: true, force: true })
})

beforeEach(async () => {
  parentBodies.length = 0
  childBodies.length = 0
  parentCalls = []
  childCall = undefined
  childReport = "Báo cáo: FPT ổn."
  childStatus = undefined
  childUsage = { prompt_tokens: 1_000, completion_tokens: 200 }
  await saveConfig({ provider: "groq", model: "tooly", subagents: undefined })
})

function setup(extra: (r: InstanceType<typeof ToolRegistry>) => void = () => {}) {
  const registry = new ToolRegistry()
  registry.register(currentTimeTool(() => new Date("2026-09-28T02:30:00Z")))
  extra(registry)
  const manager = new SubagentManager({ parent: registry, skills: () => [] })
  registry.register(spawnSubagentTool(manager))
  return { registry, manager }
}

async function collect(gen: AsyncGenerator<AgentEvent>) {
  const events: AgentEvent[] = []
  for await (const e of gen) events.push(e)
  return events
}
const ends = (events: AgentEvent[]) => events.filter((e) => e.type === "tool-end") as Extract<AgentEvent, { type: "tool-end" }>[]
const spawn = (description: string) => ({ name: "spawn_subagent", args: { description, prompt: `Phân tích ${description}` } })

test("end to end: the child runs its own loop and the parent gets its report with a metadata trailer", async () => {
  const { registry, manager } = setup()
  const sessionDir = path.join(home, "sessions", "2026", "10", "s-1")
  manager.attachSession({ id: "s-1", dir: sessionDir })
  parentCalls = [spawn("Định giá FPT")]
  childCall = { name: "current_time", args: {} }

  const events = await collect(runAgent({ history: [], input: "định giá FPT", skills: [], registry }))
  const [end] = ends(events)
  expect(end!.ok).toBe(true)
  expect(end!.output).toContain("Báo cáo: FPT ổn.")
  const trailer = parseTrailer(end!.output)!
  expect(trailer).toMatchObject({ type: "nghien-cuu", status: "xong", tools: 1, tokens: 1_200 }) // only the answer reports usage in this mock
  expect(trailer.agentId).toMatch(/^ag-[a-z0-9]{6}$/)

  // The child's own prompt: subagent notes + invariants, no identity/style; no nesting tools.
  const child = childBodies[0]!
  const system = child.messages[0]!.content as string
  expect(system).toContain("<subagent>")
  expect(system).toContain("<bat_bien>")
  expect(system).not.toContain("<style>")
  expect(system).not.toContain("<identity>")
  const childTools = child.tools!.map((t) => t.function.name)
  expect(childTools).toContain("current_time")
  expect(childTools).not.toContain("spawn_subagent")
  expect(child.messages.at(-1)).toMatchObject({ role: "user" })
  expect(JSON.stringify(child.messages)).toContain("Phân tích Định giá FPT")
  // The parent's system prompt is untouched by the subagent role.
  expect(parentBodies[0]!.messages[0]!.content as string).toContain("<identity>")

  // Sidechain written next to the session (before the parent file even exists).
  await new Promise((r) => setTimeout(r, 50))
  const files = (await readdir(path.join(sessionDir, "subagents"))).sort()
  expect(files).toEqual([`agent-${trailer.agentId}.jsonl`, `agent-${trailer.agentId}.meta.json`])
  const entries = (await readFile(path.join(sessionDir, "subagents", files[0]!), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
  expect(entries[0]).toMatchObject({ type: "agent_meta", agentType: "nghien-cuu", parentSessionId: "s-1", model: "tooly" })
  expect(entries.at(-1)).toMatchObject({ type: "agent_end", status: "completed", toolCount: 1 })
  expect(entries.filter((e) => e.type === "message").length).toBeGreaterThanOrEqual(3)
  expect(manager.list()[0]).toMatchObject({ status: "completed", toolCount: 1, usage: { input: 1_000, output: 200 } })
})

test("parallel spawns beyond subagents.maxConcurrent wait for a slot instead of failing", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { maxConcurrent: 2 } })
  let active = 0
  let peak = 0
  const { registry, manager } = setup((r) =>
    r.register({
      name: "cham",
      description: "slow read",
      input: z.object({}),
      readOnly: true,
      async execute() {
        active++
        peak = Math.max(peak, active)
        await new Promise((res) => setTimeout(res, 60))
        active--
        return "ok"
      },
    }),
  )
  let queuedSeen = 0
  manager.limiter.onChange(() => (queuedSeen = Math.max(queuedSeen, manager.limiter.stats().waiting)))
  parentCalls = [spawn("FPT"), spawn("CMG"), spawn("ELC")]
  childCall = { name: "cham", args: {} }

  const events = await collect(runAgent({ history: [], input: "so sánh", skills: [], registry }))
  expect(ends(events).map((e) => e.ok)).toEqual([true, true, true])
  expect(peak).toBe(2)
  expect(queuedSeen).toBeGreaterThan(0)
  expect(manager.limiter.stats()).toEqual({ running: 0, waiting: 0, max: 2 })
})

test("a child that fails with nothing to show fails the call; the error reaches the parent model", async () => {
  const { registry } = setup()
  parentCalls = [spawn("FPT")]
  childStatus = 500
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry }))
  const [end] = ends(events)
  expect(end!.ok).toBe(false)
  expect(end!.output).toContain("Subagent lỗi")
  expect(end!.output).toContain("upstream down")
})

test("stopping the parent stops the child and frees its slot", async () => {
  let started!: () => void
  const running = new Promise<void>((r) => (started = r))
  const { registry, manager } = setup((r) =>
    r.register({
      name: "treo",
      description: "waits until aborted",
      input: z.object({}),
      readOnly: true,
      execute: (_i, ctx) =>
        new Promise((_, reject) => {
          started()
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    }),
  )
  parentCalls = [spawn("FPT")]
  childCall = { name: "treo", args: {} }
  const controller = new AbortController()
  const turn = collect(runAgent({ history: [], input: "x", skills: [], registry, signal: controller.signal }))
  await running
  controller.abort()
  await turn
  await new Promise((r) => setTimeout(r, 20))
  expect(manager.list()[0]!.status).toBe("stopped")
  expect(manager.limiter.stats().running).toBe(0)
})

test("a child's write tool asks in the parent's gate, labelled with the subagent", async () => {
  let wrote = 0
  const { registry, manager } = setup((r) =>
    r.register({
      name: "watchlist_local_add",
      description: "add to watchlist",
      input: z.object({ symbol: z.string() }),
      readOnly: false,
      async execute() {
        wrote++
        return "đã thêm"
      },
    }),
  )
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.interactive = true
  registry.gate = gate
  parentCalls = [spawn("Thêm FPT")]
  childCall = { name: "watchlist_local_add", args: { symbol: "FPT" } }

  const turn = collect(runAgent({ history: [], input: "x", skills: [], registry }))
  while (!gate.head()) await new Promise((r) => setTimeout(r, 5))
  const request = gate.head()!
  const agent = manager.list()[0]!
  expect(request.agent).toEqual({ id: agent.id, type: "nghien-cuu", description: "Thêm FPT" })
  expect(agent.tools[0]).toMatchObject({ callId: request.callId, name: "watchlist_local_add", status: "running" })
  await gate.respond(request.id, "once")
  const events = await turn
  expect(wrote).toBe(1)
  expect(ends(events)[0]!.ok).toBe(true)
})

test("config subagents.model sends children to another model; a model without tools fails fast", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { provider: "groq", model: "other" } })
  const { registry } = setup()
  parentCalls = [spawn("FPT")]
  await collect(runAgent({ history: [], input: "x", skills: [], registry }))
  expect(childBodies[0]!.model).toBe("other")
  expect(parentBodies[0]!.model).toBe("tooly")

  await saveConfig({ provider: "groq", model: "tooly", subagents: { provider: "groq", model: "plain" } })
  childBodies.length = 0
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry }))
  expect(childBodies).toHaveLength(0)
  expect(ends(events)[0]!.output).toContain("không hỗ trợ gọi tool")
})

test("a denied child write reaches the child as a denial; without a UI (headless) it is refused", async () => {
  let wrote = 0
  const write = {
    name: "watchlist_local_add",
    description: "add to watchlist",
    input: z.object({ symbol: z.string() }),
    readOnly: false,
    async execute() {
      wrote++
      return "đã thêm"
    },
  }
  const { registry } = setup((r) => r.register(write))
  const gate = new PermissionGate({ load: async () => [], save: async () => {} })
  gate.interactive = true
  registry.gate = gate
  parentCalls = [spawn("Thêm FPT")]
  childCall = { name: "watchlist_local_add", args: { symbol: "FPT" } }
  const turn = collect(runAgent({ history: [], input: "x", skills: [], registry }))
  while (!gate.head()) await new Promise((r) => setTimeout(r, 5))
  await gate.respond(gate.head()!.id, "deny", "đừng thêm")
  await turn
  expect(wrote).toBe(0)
  const toolResult = JSON.stringify(childBodies.at(-1)!.messages.find((m) => m.role === "tool"))
  expect(toolResult).toContain("Người dùng từ chối chạy tool này")
  expect(toolResult).toContain("đừng thêm")

  // Headless (scripts, chat.ts): nobody to ask, so the child's write is refused.
  gate.interactive = false
  childBodies.length = 0
  await collect(runAgent({ history: [], input: "x", skills: [], registry }))
  expect(wrote).toBe(0)
  expect(JSON.stringify(childBodies.at(-1)!.messages.find((m) => m.role === "tool"))).toContain("không có giao diện để hỏi")
})

test("a subagent model that cannot be used falls back to the session's model", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { provider: "nokey", model: "x" } })
  const { registry } = setup()
  parentCalls = [spawn("FPT")]
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry }))
  expect(ends(events)[0]!.ok).toBe(true)
  expect(childBodies[0]!.model).toBe("tooly")
})

test("the main agent's prompt does not change with the subagent role in place; identity.md is sent whole", async () => {
  const { assemble, promptFile } = await import("../src/core/prompt/assemble")
  const input = { tier: "A" as const, tools: ["current_time", "spawn_subagent"], skills: [], sticky: [], input: "x", now: new Date("2026-10-07T03:00:00Z") }
  const plain = assemble(input)
  expect(assemble({ ...input, role: "main" }).system).toBe(plain.system)
  expect(plain.system).toContain(promptFile("identity")!)
  expect(plain.system).not.toContain("<subagent>")
  const child = assemble({ ...input, role: "subagent", agentPrompt: "CHỈ-DẪN" })
  expect(child.system).toContain("<subagent>")
  expect(child.system).toContain("<thu_tu_uu_tien>")
  expect(child.system).toContain("<chi_dan_agent>\nCHỈ-DẪN\n</chi_dan_agent>")
  expect(child.system).not.toContain("Bạn là OpenTrading, trợ lý")
})
