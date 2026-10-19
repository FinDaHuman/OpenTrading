import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-subagent-"))
process.env.OPENTRADING_HOME = home
// Retries do not sleep in tests (retry.ts scales every wait).
process.env.OPENTRADING_RETRY_SCALE = "0"

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
      "llama-3.1-8b-instant": { id: "llama-3.1-8b-instant", name: "Llama Instant", tool_call: true, modalities: text, limit: { context: 131_072 } },
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
/** Child requests wait for this before answering. */
let childGate: Promise<void> | undefined
/** Reasoning chunks prepended to every answer() (test for the progress event). */
let answerReasoning: string[] = []
/** The child answers with a slow reasoning stream, one chunk per 80ms (idleMs tests). */
let childSlowReasoning = false
/** The child sends one reasoning chunk, then the stream never closes (stall tests). */
let childDanglingStream = false

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
  sse([
    ...answerReasoning.map((r) => chunk({ reasoning: r })),
    chunk({ role: "assistant", content }),
    chunk({}, "stop", usage ? { x_groq: { usage } } : {}),
  ])

/** A response body that streams reasoning chunks with real gaps, then the answer. */
const sseSlow = (reasoning: string[], content: string, gapMs: number) => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string) => {
        try {
          controller.enqueue(encoder.encode(event))
        } catch {
          // The reader went away (stopped agent): nothing left to send.
        }
      }
      for (const r of reasoning) {
        send(`data: ${JSON.stringify(chunk({ reasoning: r }))}\n\n`)
        await new Promise((res) => setTimeout(res, gapMs))
      }
      send(`data: ${JSON.stringify(chunk({ role: "assistant", content }))}\n\n`)
      send(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`)
      send("data: [DONE]\n\n")
      try {
        controller.close()
      } catch {
        // already closed by the abort
      }
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream" } })
}

/** A response body that sends one reasoning chunk and then never closes. */
const sseDangling = () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ reasoning: "bắt đầu nghĩ" }))}\n\n`))
      } catch {
        // closed already
      }
      // Never closes: the reader waits until the request is aborted.
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream" } })
}

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
    // Held requests still end when the caller aborts (stop_agent, Esc).
    await Promise.race([
      childGate,
      new Promise<void>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    ])
    if (childStatus) return Response.json({ error: { message: "upstream down", type: "server_error" } }, { status: childStatus })
    if (childCall && !hasToolResult && body.tool_choice !== "none") return toolCalls([childCall])
    if (childDanglingStream) return sseDangling()
    if (childSlowReasoning) return sseSlow(Array.from({ length: 15 }, (_, i) => `nghĩ bước ${i}`), childReport, 80)
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
const { sendMessageTool, spawnSubagentTool, stopAgentTool } = await import("../src/core/tools/subagent/spawn")
const { parseTrailer } = await import("../src/core/subagents/result")
const { closeDanglingToolCalls } = await import("../src/core/session/store")
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
  childGate = undefined
  answerReasoning = []
  childSlowReasoning = false
  childDanglingStream = false
  await saveConfig({ provider: "groq", model: "tooly", subagents: undefined })
})

type AgentDefinition = import("../src/core/agents/schema").AgentDefinition

function setup(extra: (r: InstanceType<typeof ToolRegistry>) => void = () => {}, agents: AgentDefinition[] = []) {
  const registry = new ToolRegistry()
  registry.register(currentTimeTool(() => new Date("2026-09-28T02:30:00Z")))
  extra(registry)
  const manager = new SubagentManager({ parent: registry, skills: () => [] })
  registry.register(spawnSubagentTool(manager, agents))
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

  // Sidechain written next to the session (before the parent file even exists). The write
  // is fire-and-forget: wait until it has landed (a fixed 50ms was too short on Windows CI).
  const sidechainDone = async () => {
    const names = await readdir(path.join(sessionDir, "subagents")).catch(() => [] as string[])
    const log = names.find((n) => n.endsWith(".jsonl"))
    if (names.length < 2 || !log) return false
    return (await readFile(path.join(sessionDir, "subagents", log), "utf8").catch(() => "")).includes('"agent_end"')
  }
  for (let i = 0; i < 500 && !(await sidechainDone()); i++) await new Promise((r) => setTimeout(r, 10))
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
  childStatus = 500 // retried (without sleeping in tests), then the child fails
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
  // The child settles after the parent's turn returns: wait for it rather than a fixed 20ms.
  for (let i = 0; i < 500 && (manager.list()[0]!.status !== "stopped" || manager.limiter.stats().running > 0); i++)
    await new Promise((r) => setTimeout(r, 10))
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
  const { registry, manager } = setup()
  parentCalls = [spawn("FPT")]
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry }))
  expect(ends(events)[0]!.ok).toBe(true)
  expect(childBodies[0]!.model).toBe("tooly")
  expect(manager.list()[0]!.notice).toContain("dùng model của phiên")
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

test("an agent type brings its instructions, tool filter, step limit and model", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { provider: "groq", model: "other" } })
  const thu: AgentDefinition = {
    name: "thu",
    description: "loại thử",
    tools: ["@chi-doc"],
    maxSteps: 2,
    model: "tooly",
    body: "CHỈ-DẪN-THỬ",
    file: "thu.md",
    source: "project",
  }
  const { registry, manager } = setup(
    (r) =>
      r.register({
        name: "watchlist_local_add",
        description: "add",
        input: z.object({ symbol: z.string() }),
        readOnly: false,
        execute: async () => "x",
      }),
    [thu],
  )
  parentCalls = [{ name: "spawn_subagent", args: { description: "Giá FPT", prompt: "giá FPT", subagent_type: "thu" } }]
  childCall = { name: "current_time", args: {} }
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry }))
  expect(ends(events)[0]!.ok).toBe(true)
  const first = childBodies[0]!
  expect(first.messages[0]!.content as string).toContain("<chi_dan_agent>\nCHỈ-DẪN-THỬ\n</chi_dan_agent>")
  const names = first.tools!.map((t) => t.function.name)
  expect(names).toContain("current_time")
  expect(names).not.toContain("watchlist_local_add")
  // The type's own model beats config subagents.model; its 2 steps end with a forced summary.
  expect(first.model).toBe("tooly")
  expect(childBodies).toHaveLength(2)
  expect(childBodies[1]!.tool_choice).toBe("none")
  expect(manager.list()[0]).toMatchObject({ type: "thu", toolCount: 1 })
  expect(parseTrailer(ends(events)[0]!.output)?.type).toBe("thu")
})

const ctxOf = () => ({ signal: new AbortController().signal, callId: "c" })
const waitFor = async (pred: () => boolean) => {
  for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(pred()).toBe(true)
}

test("background: the call returns at once with the id; the result arrives through onFinished; Esc on the parent does not stop it", async () => {
  const { registry, manager } = setup()
  const finished: string[] = []
  manager.onFinished((v) => finished.push(`${v.id}:${v.status}:${v.text}`))
  let release!: () => void
  childGate = new Promise((r) => (release = r))
  parentCalls = [{ name: "spawn_subagent", args: { description: "Định giá FPT", prompt: "định giá", run_in_background: true } }]
  const controller = new AbortController()
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry, signal: controller.signal }))
  const [end] = ends(events)
  expect(end!.ok).toBe(true)
  expect(end!.output).toMatch(/^Đã chạy nền subagent ag-[a-z0-9]{6} \(nghien-cuu · Định giá FPT\)/)
  const id = /ag-[a-z0-9]{6}/.exec(end!.output)![0]
  controller.abort() // the parent turn is over (and even aborted): the background agent goes on
  expect(manager.get(id)).toMatchObject({ background: true })
  expect(finished).toEqual([])
  release()
  await waitFor(() => finished.length === 1)
  expect(finished[0]).toBe(`${id}:completed:Báo cáo: FPT ổn.`)
})

test("send_message: queued for a running agent, resumes a finished one with its conversation, and rebuilds one from its sidechain", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-sub-session-"))
  const { manager } = setup()
  manager.attachSession({ id: "s-2", dir })
  const finished: string[] = []
  manager.onFinished((v) => finished.push(v.id))
  const send = sendMessageTool(manager)

  // Running: the message waits for the end of the current turn, then gets its own turn.
  let release!: () => void
  childGate = new Promise((r) => (release = r))
  const run = manager.start({ description: "FPT", prompt: "VIỆC-ĐẦU", background: true })
  await waitFor(() => childBodies.length === 1)
  expect(await send.execute({ to: run.id, message: "VIỆC-THÊM" }, ctxOf())).toContain("Đã xếp tin")
  release()
  await run.done
  expect(childBodies).toHaveLength(2)
  const second = JSON.stringify(childBodies[1]!.messages)
  expect(second).toContain("VIỆC-ĐẦU")
  expect(second).toContain("VIỆC-THÊM")
  expect(finished).toEqual([run.id])

  // Finished, in memory: resumes in the background with the whole conversation.
  childGate = undefined
  expect(await send.execute({ to: run.id, message: "VIỆC-BA" }, ctxOf())).toContain("đang chạy tiếp ở chế độ nền")
  await waitFor(() => finished.length === 2)
  expect(JSON.stringify(childBodies[2]!.messages)).toContain("VIỆC-THÊM")
  expect(JSON.stringify(childBodies[2]!.messages)).toContain("VIỆC-BA")

  // A fresh manager (resumed session): rebuilt from the sidechain file.
  await manager.flush()
  const { manager: other } = setup()
  other.attachSession({ id: "s-2", dir })
  const later: string[] = []
  other.onFinished((v) => later.push(v.text))
  await sendMessageTool(other).execute({ to: run.id, message: "VIỆC-BỐN" }, ctxOf())
  await waitFor(() => later.length === 1)
  const rebuilt = JSON.stringify(childBodies.at(-1)!.messages)
  expect(rebuilt).toContain("VIỆC-ĐẦU")
  expect(rebuilt).toContain("VIỆC-BA")
  expect(rebuilt).toContain("VIỆC-BỐN")

  await expect(sendMessageTool(other).execute({ to: "ag-zzzzzz", message: "x" }, ctxOf())).rejects.toThrow('Không có subagent "ag-zzzzzz"')
  // Another session's agent cannot be continued from here.
  other.attachSession({ id: "s-3", dir: path.join(dir, "khac") })
  await expect(sendMessageTool(other).execute({ to: run.id, message: "x" }, ctxOf())).rejects.toThrow("Không có subagent")
  await rm(dir, { recursive: true, force: true })
})

test("stop_agent stops a running background agent; its partial result still notifies", async () => {
  const { manager } = setup()
  const finished: string[] = []
  manager.onFinished((v) => finished.push(v.status))
  childGate = new Promise(() => {}) // never answers
  const run = manager.start({ description: "FPT", prompt: "x", background: true })
  await waitFor(() => childBodies.length === 1)
  const stop = stopAgentTool(manager)
  expect(await stop.execute({ id: run.id }, ctxOf())).toBe(`Đã dừng subagent ${run.id}.`)
  await run.done
  expect(finished).toEqual(["stopped"])
  expect(await stop.execute({ id: run.id }, ctxOf())).toContain("không còn chạy")
  await expect(stop.execute({ id: "ag-nope00" }, ctxOf())).rejects.toThrow("Không có subagent")
})

test("a subagent's sidechain holds tool errors cleaned, like the main history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-sub-errors-"))
  const { manager } = setup((r) =>
    r.register({
      name: "boom",
      description: "fails",
      input: z.object({}),
      readOnly: true,
      async execute() {
        throw new Error("nguồn dữ liệu sập")
      },
    }),
  )
  manager.attachSession({ id: "s-err", dir })
  childCall = { name: "boom", args: {} }
  const run = manager.start({ description: "FPT", prompt: "Phân tích FPT", background: true })
  await run.done
  await manager.flush()
  const files = await readdir(path.join(dir, "subagents"))
  const text = await readFile(path.join(dir, "subagents", files.find((f) => f.endsWith(".jsonl"))!), "utf8")
  expect(text).toContain("nguồn dữ liệu sập")
  expect(text).not.toContain("Error: nguồn")
  expect(JSON.stringify(childBodies[1]!.messages)).not.toContain("Error: nguồn")
})

test("reasoning-delta phát event progress cho UI/watchdog", async () => {
  answerReasoning = ["nghĩ 1", "nghĩ 2"]
  const { registry } = setup()
  const events = await collect(runAgent({ history: [], input: "chào", skills: [], registry }))
  expect(events.some((e) => e.type === "progress")).toBe(true)
})

test("watchdog không giết run còn reasoning khi idleMs nhỏ", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { idleMs: 1200, maxConcurrent: 5 } })
  childSlowReasoning = true
  const { registry, manager } = setup()
  parentCalls = [spawn("Kỹ thuật HPG")]
  await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  expect(manager.list()[0]).toMatchObject({ status: "completed" })
})

test("watchdog đọc idleMs: run im lặng bị dừng theo idleMs thay vì chờ 5 phút", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { idleMs: 1200, maxConcurrent: 5 } })
  childGate = new Promise(() => {})
  const { registry, manager } = setup()
  parentCalls = [spawn("Kỹ thuật HPG")]
  await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  const view = manager.list()[0]!
  expect(view.status).toBe("stopped")
  expect(view.error).toContain("không có tiến triển trong 1.2 giây")
})

test("request treo trước part đầu bị cắt bằng lỗi stall", async () => {
  process.env.OPENTRADING_STALL_MS = "300"
  try {
    childGate = new Promise(() => {}) // treo hẳn, không trả gì
    const { registry } = setup()
    parentCalls = [spawn("Kỹ thuật HPG")]
    const events = await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
    const [end] = ends(events)
    expect(end!.ok).toBe(false)
    expect(end!.output).toContain("không gửi dữ liệu")
  } finally {
    delete process.env.OPENTRADING_STALL_MS
  }
})

test("stream treo giữa chừng (sau 1 reasoning chunk) bị cắt bằng lỗi stall", async () => {
  process.env.OPENTRADING_STALL_MS = "300"
  try {
    childDanglingStream = true
    const { registry } = setup()
    parentCalls = [spawn("Kỹ thuật HPG")]
    const events = await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
    const [end] = ends(events)
    expect(end!.ok).toBe(false)
    expect(end!.output).toContain("không gửi dữ liệu")
  } finally {
    delete process.env.OPENTRADING_STALL_MS
  }
})

test("dừng giữa chừng vẫn giữ tool call/result đã hoàn thành trong sidechain", async () => {
  const { registry, manager } = setup()
  const sessionDir = path.join(home, "sessions", "2026", "10", "s-keep")
  manager.attachSession({ id: "s-keep", dir: sessionDir })
  parentCalls = [spawn("Kỹ thuật HPG")]
  childCall = { name: "current_time", args: {} }
  let release1!: () => void
  childGate = new Promise<void>((r) => (release1 = r)) // giữ request 1 tới khi test cho chạy
  const running = collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  await waitFor(() => childBodies.length === 1)
  childGate = new Promise(() => {}) // request 2 của con bị giữ hẳn (sau khi tool đã xong)
  release1()
  await waitFor(() => childBodies.some((b) => b.messages.some((m) => m.role === "tool")))
  const id = manager.list()[0]!.id
  manager.stop(id)
  await running
  await manager.flush()
  const log = await readFile(path.join(sessionDir, "subagents", `agent-${id}.jsonl`), "utf8")
  expect(log).toContain('"tool-result"')
  expect(log).toContain("2026-09-28")
  const messages = log
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "message")
    .map((e) => e.message)
  expect(closeDanglingToolCalls(messages).patched).toBe(0)
})

test("subagents.model auto: con chạy model lite tự chọn và có notice", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { model: "auto", maxConcurrent: 5 } })
  const { registry, manager } = setup()
  parentCalls = [spawn("Kỹ thuật HPG")]
  await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  expect(childBodies[0]!.model).toBe("llama-3.1-8b-instant")
  expect(manager.list()[0]!.notice).toContain("tự chọn model")
})

test("subagents.model auto: không có model khớp thì quay về model phiên + notice", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { provider: "anthropic", model: "auto", maxConcurrent: 5 } })
  const { registry, manager } = setup()
  parentCalls = [spawn("Kỹ thuật HPG")]
  await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  expect(childBodies[0]!.model).toBe("tooly")
  expect(manager.list()[0]!.notice).toContain("Không tìm thấy model lite")
})

test("idleMs không hợp lệ (0) bị bỏ qua, dùng mặc định 5 phút", async () => {
  await saveConfig({ provider: "groq", model: "tooly", subagents: { idleMs: 0, maxConcurrent: 5 } })
  childSlowReasoning = true
  const { registry, manager } = setup()
  parentCalls = [spawn("Kỹ thuật HPG")]
  await collect(runAgent({ history: [], input: "phân tích HPG", skills: [], registry }))
  expect(manager.list()[0]).toMatchObject({ status: "completed" })
})
