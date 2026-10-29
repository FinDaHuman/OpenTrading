import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"
import { z } from "zod"
import { loadedTools } from "../src/core/tools/loaded"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-agent-"))
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
      plain: { id: "plain", name: "Plain", tool_call: false, modalities: text },
      "openai/gpt-oss-20b": { id: "openai/gpt-oss-20b", name: "GPT OSS 20B", tool_call: true, reasoning: true, modalities: text },
    },
  },
}

type Body = { messages: { role: string; content?: unknown }[]; tools?: unknown[]; tool_choice?: unknown }
const bodies: Body[] = []
/** What the fake model does when the conversation has no tool results yet. */
let plan: { tool: string; args: object; always?: boolean; text?: string } | undefined
/** Several tool calls in one turn: call `script[n]` after n tool results (this turn), then answer. */
let script: { tool: string; args: object }[] | undefined
/** Mimic gemini-2.5-flash-lite: answer with nothing after a tool result. */
let emptyAfterTool: "once" | "always" | undefined
/** That empty answer still streams thoughts (a reasoning model that thinks, then says nothing). */
let emptyWithThoughts = false
/** Streamed requests answer only after this delay (stall timer tests). */
let answerDelayMs = 0
/** Non-streamed answers (the compaction summary): an error per request, then the finish reason. */
let summaryErrors: { status: number; message: string }[] = []
let summaryFinish = "stop"
/** First N streamed requests fail with 429 (retryable) to exercise the SDK retry. */
let failFirst = 0
/** Body of those 429s (default: a plain rate limit). */
let failBody: object | undefined
/** Streamed requests that already carry a tool result fail with 503 this many times. */
let failAfterTool = 0
/** Token usage reported on the answer's last chunk (Groq sends it as x_groq.usage). */
let usage: { prompt_tokens: number; completion_tokens: number } | undefined
/** Token usage reported on scripted tool-call steps. */
let toolUsage: { prompt_tokens: number; completion_tokens: number } | undefined
/** Streamed request n (0-based) answered by hand; undefined falls through to the defaults. */
let respond: ((body: Body, n: number) => Response | undefined) | undefined
const NUDGE = "Hãy trả lời câu hỏi của người dùng dựa trên kết quả tool"
const TOOL_NUDGE_START = "Nếu còn cần dữ liệu, gọi cùng lúc"

const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  })
const chunk = (delta: object, finish: string | null = null) => ({
  id: "c",
  object: "chat.completion.chunk",
  created: 1,
  model: "tooly",
  choices: [{ index: 0, delta, finish_reason: finish }],
})

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (!url.endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`)
  const body = JSON.parse(String(init?.body)) as Body & { stream?: boolean }
  bodies.push(body)
  if (respond && body.stream) {
    const custom = respond(body, bodies.filter((b) => (b as { stream?: boolean }).stream).length - 1)
    if (custom) return custom
  }
  if (answerDelayMs > 0 && body.stream) await new Promise((r) => setTimeout(r, answerDelayMs))
  if (failFirst > 0 && body.stream) {
    failFirst--
    return Response.json(failBody ?? { error: { message: "rate limited" } }, { status: 429 })
  }
  if (failAfterTool > 0 && body.stream && body.messages.some((m) => m.role === "tool")) {
    failAfterTool--
    return Response.json({ error: { message: "overloaded" } }, { status: 503 })
  }
  // generateText (the compaction summary) does not stream.
  if (!body.stream) {
    const failure = summaryErrors.shift()
    if (failure) return Response.json({ error: { message: failure.message, type: "invalid_request_error" } }, { status: failure.status })
    return Response.json({
      id: "c",
      object: "chat.completion",
      created: 1,
      model: "tooly",
      choices: [{ index: 0, message: { role: "assistant", content: "Kết quả: xong." }, finish_reason: summaryFinish }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
  }
  // Branch on the request, not on call counts: tool results present → answer in text.
  const hasToolResult = body.messages.some((m) => m.role === "tool")
  // The turn starts at the last real user message; the per-step tool nudge does not count.
  const lastUser = body.messages.findLastIndex((m) => m.role === "user" && !JSON.stringify(m.content).includes(TOOL_NUDGE_START))
  const resultsThisTurn = body.messages.slice(lastUser + 1).filter((m) => m.role === "tool").length
  const scripted = body.tool_choice !== "none" ? script?.[resultsThisTurn] : undefined
  if (scripted) {
    const id = `call_${bodies.length}`
    return sse([
      chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: scripted.tool, arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(scripted.args) } }] }),
      toolUsage ? { ...chunk({}, "tool_calls"), x_groq: { usage: toolUsage } } : chunk({}, "tool_calls"),
    ])
  }
  if (plan && body.tool_choice !== "none" && (plan.always || !hasToolResult)) {
    const id = `call_${bodies.length}`
    return sse([
      ...(plan.text ? [chunk({ role: "assistant", content: plan.text })] : []),
      chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: plan.tool, arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(plan.args) } }] }),
      chunk({}, "tool_calls"),
    ])
  }
  const nudged = JSON.stringify(body.messages.at(-1)?.content ?? "").includes(NUDGE)
  if (emptyAfterTool && hasToolResult && (emptyAfterTool === "always" || !nudged)) {
    return sse([...(emptyWithThoughts ? [chunk({ reasoning: "đang nghĩ" })] : []), chunk({ role: "assistant", content: "" }), chunk({}, "stop")])
  }
  const last = usage ? { ...chunk({}, "stop"), x_groq: { usage } } : chunk({}, "stop")
  return sse([chunk({ role: "assistant", content: "Kết quả: " }), chunk({ content: "xong." }), last])
}) as typeof fetch

const { runAgent, thoughtOptions } = await import("../src/core/agent")
const { ToolRegistry } = await import("../src/core/tools/registry")
const { currentTimeTool } = await import("../src/core/tools/builtin/current-time")
const { saveConfig } = await import("../src/core/config")
const { toolSearchTool } = await import("../src/core/tools/builtin/tool-search")
const { setKey } = await import("../src/core/auth")
const { closeDanglingToolCalls } = await import("../src/core/session/store")
type AgentEvent = import("../src/core/events").AgentEvent

beforeAll(async () => {
  await setKey("groq", "gsk_test")
  await saveConfig({ provider: "groq", model: "tooly" })
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await rm(home, { recursive: true, force: true })
})

beforeEach(async () => {
  bodies.length = 0
  respond = undefined
  plan = undefined
  script = undefined
  emptyAfterTool = undefined
  emptyWithThoughts = false
  answerDelayMs = 0
  usage = undefined
  toolUsage = undefined
  failFirst = 0
  failBody = undefined
  failAfterTool = 0
  summaryErrors = []
  summaryFinish = "stop"
  await saveConfig({ provider: "groq", model: "tooly", toolSearch: undefined, toolSearchMinTools: undefined })
})

function registry() {
  const r = new ToolRegistry()
  r.register(currentTimeTool(() => new Date("2026-09-28T02:30:00Z")))
  r.register({
    name: "boom",
    description: "always fails",
    input: z.object({}),
    readOnly: true,
    async execute() {
      throw new Error("nguồn dữ liệu sập")
    },
  })
  r.register({
    name: "hang",
    description: "waits until aborted",
    input: z.object({}),
    readOnly: true,
    execute: (_input, ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))),
  })
  return r
}

async function collect(gen: AsyncGenerator<AgentEvent>, onEvent?: (e: AgentEvent) => void) {
  const events: AgentEvent[] = []
  for await (const e of gen) {
    events.push(e)
    onEvent?.(e)
  }
  return events
}

const done = (events: AgentEvent[]) => events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }>
const tools = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "tool-start" ? [e.name] : []))

test("calls a tool, feeds the result back and answers", async () => {
  plan = { tool: "current_time", args: {} }
  const events = await collect(runAgent({ history: [], input: "Mấy giờ rồi?", skills: [], registry: registry() }))
  const types = events.map((e) => e.type)
  expect(types.indexOf("tool-start")).toBeLessThan(types.indexOf("tool-end"))
  expect(types.indexOf("tool-end")).toBeLessThan(types.indexOf("text-delta"))
  expect(types.at(-1)).toBe("done")
  const end = events.find((e) => e.type === "tool-end") as Extract<AgentEvent, { type: "tool-end" }>
  expect(end.ok).toBe(true)
  expect(end.output).toContain("28/09/2026 09:30:00")
  // The second request carried the tool result to the model.
  expect(JSON.stringify(bodies[1]!.messages)).toContain("28/09/2026 09:30:00")
  // History pairs the call with its result.
  const roles = done(events).messages.map((m) => m.role)
  expect(roles).toEqual(["user", "assistant", "tool", "assistant"])
  // The system prompt mentions tools when tools are sent.
  expect(bodies[0]!.tools).toBeDefined()
})

test("a tool that throws is reported to the model, not raised", async () => {
  plan = { tool: "boom", args: {} }
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  const end = events.find((e) => e.type === "tool-end") as Extract<AgentEvent, { type: "tool-end" }>
  expect(end.ok).toBe(false)
  expect(end.output).toContain("nguồn dữ liệu sập")
  expect(JSON.stringify(bodies[1]!.messages)).toContain("nguồn dữ liệu sập")
  expect(events.some((e) => e.type === "error")).toBe(false)
})

test("an unknown tool name does not crash the loop", async () => {
  plan = { tool: "does_not_exist", args: {} }
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(events.at(-1)!.type).toBe("done")
  expect(events.some((e) => e.type === "text-delta")).toBe(true)
  expect(bodies.length).toBeGreaterThanOrEqual(2)
})

test("hitting the step limit forces a final answer without tools", async () => {
  plan = { tool: "current_time", args: {}, always: true }
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry(), maxSteps: 3 }))
  expect(bodies).toHaveLength(3)
  expect(bodies[2]!.tool_choice).toBe("none")
  expect(bodies[2]!.tools).toBeDefined()
  expect(events.some((e) => e.type === "notice" && e.text.includes("3 bước"))).toBe(true)
  expect(events.some((e) => e.type === "text-delta")).toBe(true)
})

test("the step limit comes from config.maxSteps when the caller does not set one", async () => {
  plan = { tool: "current_time", args: {}, always: true }
  await saveConfig({ provider: "groq", model: "tooly", maxSteps: 5 })
  try {
    const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
    expect(bodies).toHaveLength(5)
    expect(bodies[4]!.tool_choice).toBe("none")
    expect(events.some((e) => e.type === "notice" && e.text.includes("5 bước"))).toBe(true)
  } finally {
    await saveConfig({ maxSteps: undefined })
  }
})

test("without a configured cap the turn is not limited to 10 steps", async () => {
  script = Array.from({ length: 12 }, () => ({ tool: "current_time", args: {} }))
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(13)
  expect(events.some((e) => e.type === "notice" && e.text.includes("bước gọi tool"))).toBe(false)
  expect(done(events).outcome).toBe("completed")
})

test("a per-minute 429 is retried until success, and every wait is shown", async () => {
  plan = { tool: "current_time", args: {} }
  failFirst = 2 // two 429s, the third attempt succeeds
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(events.some((e) => e.type === "error")).toBe(false)
  expect(done(events).outcome).toBe("completed")
  // 3 attempts for the first step, then the answer step: earlier steps never re-run.
  expect(bodies).toHaveLength(4)
  const retries = events.filter((e) => e.type === "retry")
  expect(retries.map((e) => e.type === "retry" && `${e.attempt}/${e.max}`)).toEqual(["1/2", "2/2"])
  expect(tools(events)).toEqual(["current_time"])
})

test("a daily-quota 429 is not retried and says so", async () => {
  failFirst = 1
  failBody = { error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(1)
  expect(events.some((e) => e.type === "retry")).toBe(false)
  const error = events.find((e) => e.type === "error")
  expect(error?.type === "error" && error.message).toContain("hết quota trong ngày")
})

test("a failure after a tool ran retries only the failed request", async () => {
  plan = { tool: "current_time", args: {} }
  failAfterTool = 1 // the answer step fails once with a 503
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(done(events).outcome).toBe("completed")
  // tool step once, answer step twice; current_time ran once.
  expect(bodies).toHaveLength(3)
  expect(tools(events)).toEqual(["current_time"])
})

test("each round of tool results gets one unstored nudge; the last step gets only the summary prompt", async () => {
  plan = { tool: "current_time", args: {}, always: true }
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry(), maxSteps: 4 }))
  const nudges = (b: Body) => b.messages.filter((m) => m.role === "user" && JSON.stringify(m.content).includes(TOOL_NUDGE_START)).length
  expect(bodies).toHaveLength(4)
  expect(nudges(bodies[0]!)).toBe(0) // no tool result yet
  expect(nudges(bodies[1]!)).toBe(1)
  expect(nudges(bodies[2]!)).toBe(1) // not carried over from the previous step
  expect(bodies[1]!.messages.at(-1)!.role).toBe("user")
  expect(bodies[1]!.tools).toBeDefined()
  expect(nudges(bodies[3]!)).toBe(0)
  expect(bodies[3]!.tool_choice).toBe("none")
  expect(JSON.stringify(done(events).messages)).not.toContain(TOOL_NUDGE_START)
})

test("aborting mid-tool leaves no dangling tool call in history", async () => {
  plan = { tool: "hang", args: {} }
  const controller = new AbortController()
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry(), signal: controller.signal }), (e) => {
    if (e.type === "tool-start") setTimeout(() => controller.abort(), 20)
  })
  const messages = done(events).messages
  // The started call is kept (the work is not lost) and closed, so providers accept the history.
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
  expect(JSON.stringify(messages)).toContain("tool-call")
  expect(closeDanglingToolCalls(messages).patched).toBe(0)
})

test("an empty answer after a tool result is retried once with tools disabled", async () => {
  plan = { tool: "current_time", args: {} }
  emptyAfterTool = "once"
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(3)
  expect(bodies[2]!.tool_choice).toBe("none")
  expect(bodies[2]!.tools).toBeDefined()
  expect(events.filter((e) => e.type === "text-delta").map((e) => (e as { text: string }).text).join("")).toBe("Kết quả: xong.")
  const messages = done(events).messages
  // The nudge is not kept in history; the empty answer is replaced by the real one.
  expect(JSON.stringify(messages)).not.toContain(NUDGE)
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
  expect(JSON.stringify(messages.at(-1)!.content)).toContain("Kết quả: xong.")
  expect(done(events).recoveries).toEqual([{ kind: "empty", attempt: 1 }])
})

test("a model that stays silent gets a visible notice, not a blank turn", async () => {
  plan = { tool: "current_time", args: {} }
  emptyAfterTool = "always"
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  // Two recoveries at most: tools off right after the results, then tools on.
  expect(bodies).toHaveLength(4)
  expect(bodies[2]!.tool_choice).toBe("none")
  expect(bodies[3]!.tool_choice).not.toBe("none")
  expect(done(events).unanswered).toBe(true)
  expect(events.some((e) => e.type === "notice" && e.text.includes("không trả lời sau khi gọi tool"))).toBe(true)
  expect(done(events).messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
  // A plain stop has nothing to explain: no "Lý do" on the notice, the plain placeholder saved.
  expect(events.some((e) => e.type === "notice" && e.text.includes("Lý do từ provider"))).toBe(false)
  expect(done(events).messages.at(-1)).toMatchObject({ role: "assistant", content: "(không có câu trả lời)" })
})

test("rate-limit errors wrapped in RetryError still read as quota errors", async () => {
  const { describeError } = await import("../src/core/chat")
  const quota = Object.assign(new Error("quota"), { name: "AI_APICallError", statusCode: 429 })
  const wrapped = Object.assign(new Error("Failed after 3 attempts. Last error: quota"), { name: "AI_RetryError", lastError: quota })
  expect(describeError(wrapped)).toContain("Hết quota")
})

test("context rides on the first user message; reminders are kept in history, the profile is not", async () => {
  // A marker that appears nowhere else (prompts/style.md itself mentions "bear case").
  await writeFile(path.join(home, "INVESTOR.md"), "# Hồ sơ\nHO-SO-DAU-TU-MARKER: không dùng margin.")
  const monday = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+07:00`)
  try {
    const first = await collect(runAgent({ history: [], input: "câu 1", skills: [], registry: registry(), now: monday("10:00") }))
    const turn1 = done(first)
    // Request 1: no two user messages in a row; the profile rides the static
    // system prefix (cache-marked) instead of the first user message.
    const roles1 = bodies[0]!.messages.map((m) => m.role).filter((r) => r !== "system")
    expect(roles1).toEqual(["user"])
    const systemMsg = JSON.stringify(bodies[0]!.messages.find((m) => m.role === "system"))
    expect(systemMsg).toContain("HO-SO-DAU-TU-MARKER")
    const firstUser = JSON.stringify(bodies[0]!.messages.find((m) => m.role === "user"))
    expect(firstUser).not.toContain("ho_so_nha_dau_tu")
    // No environment block: the working directory and home path are not sent to the model.
    expect(firstUser).not.toContain("moi_truong")
    expect(firstUser).toContain("câu 1")
    // Stored history keeps the reminder (so turn 2 still sees the clock) but not the profile.
    const stored = JSON.stringify(turn1.messages)
    expect(stored).toContain("<nhac_nho>")
    expect(stored).toContain("phien_giao_dich")
    expect(stored).not.toContain("HO-SO-DAU-TU-MARKER")

    bodies.length = 0
    const history = turn1.messages
    await collect(runAgent({ history, input: "câu 2", skills: [], registry: registry(), now: monday("10:05"), prevClock: turn1.clock }))
    const sent = bodies[0]!.messages
    const roles2 = sent.map((m) => m.role).filter((r) => r !== "system")
    expect(roles2).toEqual(["user", "assistant", "user"])
    for (let i = 1; i < roles2.length; i++) expect(roles2[i] === "user" && roles2[i - 1] === "user").toBe(false)
    // Same phase: the clock from turn 1 is still in history, no second copy is added.
    expect(JSON.stringify(sent).split("<phien_giao_dich>").length - 1).toBe(1)
    expect(JSON.stringify(sent.at(-1))).not.toContain("phien_giao_dich")
    // The profile is rebuilt every request into the static system prefix, never into history.
    expect(JSON.stringify(sent).split("HO-SO-DAU-TU-MARKER").length - 1).toBe(1)
    expect(JSON.stringify(sent.find((m) => m.role === "system"))).toContain("HO-SO-DAU-TU-MARKER")
    expect(sent.filter((m) => m.role === "user").every((m) => !JSON.stringify(m).includes("HO-SO-DAU-TU-MARKER"))).toBe(true)
  } finally {
    await rm(path.join(home, "INVESTOR.md"), { force: true })
  }
})

test("memory: active items reach the model (index + recall) and the UI is told; pending ones do not", async () => {
  const { FileMemory } = await import("../src/core/memory/file-memory")
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-agent-mem-"))
  const memory = new FileMemory(dir)
  await memory.add("MEM-ACTIVE người dùng không dùng margin", { status: "active", via: "user" })
  await memory.add("MEM-PENDING người dùng thích margin", { status: "pending", via: "model" })
  try {
    const events = await collect(runAgent({ history: [], input: "có nên dùng margin không", skills: [], registry: registry(), memory }))
    const sent = JSON.stringify(bodies[0])
    expect(sent).toContain("<memory>") // index in context
    expect(sent).toContain("<memory_lien_quan>") // recall in reminder
    expect(sent).toContain("<memory_policy>") // instructions in system
    expect(sent).not.toContain("MEM-PENDING")
    expect(events.some((e) => e.type === "notice" && e.text.startsWith("Dùng 1 memory"))).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("hooks: a blocking user-prompt hook stops the turn before the model is called", async () => {
  const { HookBus } = await import("../src/core/hooks")
  const hooks = new HookBus()
  hooks.on("user-prompt", (e) => (e.prompt.includes("nội gián") ? { block: "vi phạm chính sách" } : { additionalContext: "HOOK-CTX-MARKER" }))
  const blocked = await collect(runAgent({ history: [], input: "tin nội gián về FPT", skills: [], registry: registry(), hooks }))
  expect(bodies).toHaveLength(0)
  expect(blocked.some((e) => e.type === "notice" && e.text.includes("vi phạm chính sách"))).toBe(true)
  expect(done(blocked).messages).toEqual([])

  const turnEnds: number[] = []
  hooks.on("turn-end", (e) => void turnEnds.push(e.messages.length))
  await collect(runAgent({ history: [], input: "xin chào", skills: [], registry: registry(), hooks }))
  expect(JSON.stringify(bodies[0])).toContain("HOOK-CTX-MARKER")
  await new Promise((r) => setTimeout(r, 10))
  expect(turnEnds).toEqual([2])
})

test("models without tool support get no tools", async () => {
  await saveConfig({ provider: "groq", model: "plain" })
  plan = { tool: "current_time", args: {} }
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies[0]!.tools).toBeUndefined()
  expect(events.some((e) => e.type === "notice")).toBe(true)
})

test("more tools than the provider allows: capped at 128, MCP after native, told once", async () => {
  await saveConfig({ toolSearch: "off" })
  const r = bigRegistry(130)
  const first = await collect(runAgent({ history: [], input: "chào", skills: [], registry: r }))
  expect(bodies.at(-1)!.tools).toHaveLength(128)
  const names = (bodies.at(-1)!.tools as { function: { name: string } }[]).map((t) => t.function.name)
  expect(names).toContain("current_time") // native tools are never the ones dropped
  const notice = first.find((e) => e.type === "notice" && e.text.includes("tối đa 128 tool"))
  expect(notice && "text" in notice && notice.text).toContain("6 tool của big")
  const second = await collect(runAgent({ history: [], input: "chào", skills: [], registry: r }))
  expect(second.some((e) => e.type === "notice" && e.text.includes("tối đa"))).toBe(false)
})

test("images in history never reach a model that cannot see them", async () => {
  const history = [
    { role: "user" as const, content: "chụp màn hình" },
    { role: "assistant" as const, content: [{ type: "tool-call" as const, toolCallId: "s1", toolName: "current_time", input: {} }] },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "s1",
          toolName: "current_time",
          output: { type: "content" as const, value: [{ type: "text" as const, text: "đã chụp" }, { type: "image-data" as const, data: "QUJDREVGRw==", mediaType: "image/png" }] },
        },
      ],
    },
    { role: "assistant" as const, content: "Đây là ảnh." },
  ]
  await collect(runAgent({ history, input: "tiếp", skills: [], registry: registry() }))
  const sent = JSON.stringify(bodies.at(-1)!.messages)
  expect(sent).not.toContain("QUJDREVGRw==")
  expect(sent).toContain("đã chụp")
  expect(sent).toContain("ảnh image/png")
})

/** registry() + tool_search + `n` deferrable MCP tools mcp__big__t000… that echo their input. */
function bigRegistry(n: number) {
  const r = registry()
  r.register(toolSearchTool(r))
  for (let i = 0; i < n; i++) {
    const name = `mcp__big__t${String(i).padStart(3, "0")}`
    r.register({
      name,
      source: "mcp:big",
      priority: 0,
      deferrable: true,
      description: i === 7 ? "Lịch sử giá cổ phiếu theo ngày" : "x",
      input: { type: "object", properties: { symbol: { type: "string" } } },
      readOnly: true,
      execute: async (input) => `${name} ${JSON.stringify(input)}`,
    })
  }
  return r
}

const toolNames = (body: Body | undefined) => ((body?.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name)
const systemText = (body: Body | undefined) => JSON.stringify(body?.messages.filter((m) => m.role === "system") ?? [])
const ends = (events: AgentEvent[]) => events.filter((e) => e.type === "tool-end") as Extract<AgentEvent, { type: "tool-end" }>[]

test("tool search: many MCP tools go out by name only; a loaded tool is callable at the next step", async () => {
  const r = bigRegistry(130)
  script = [
    { tool: "tool_search", args: { query: "select:t001,big/t002" } },
    { tool: "mcp__big__t001", args: { symbol: "FPT" } },
  ]
  const events = await collect(runAgent({ history: [], input: "giá FPT", skills: [], registry: r }))
  // First request: built-ins + tool_search, no MCP schema; the names are in <tool_hoan>.
  expect(toolNames(bodies[0])).toContain("tool_search")
  expect(toolNames(bodies[0]).some((n) => n.startsWith("mcp__big__"))).toBe(false)
  expect(systemText(bodies[0])).toContain("tool_hoan")
  expect(systemText(bodies[0])).toContain("big (130): t000, t001")
  expect(events.some((e) => e.type === "notice" && e.text.includes("Đang hoãn 130 tool (130 MCP của big)"))).toBe(true)
  // tool_search loaded two tools; the very next step declares exactly those.
  expect(ends(events)[0]!.output.split("\n")[0]).toBe("Đã nạp tool: mcp__big__t001, mcp__big__t002")
  expect(toolNames(bodies[1])).toEqual(expect.arrayContaining(["mcp__big__t001", "mcp__big__t002"]))
  expect(toolNames(bodies[1])).not.toContain("mcp__big__t003")
  expect(ends(events)[1]).toMatchObject({ ok: true, output: 'mcp__big__t001 {"symbol":"FPT"}' })

  // Next turn: the loaded tools are still there, recovered from history alone.
  const history = done(events).messages
  bodies.length = 0
  script = undefined
  const next = await collect(runAgent({ history, input: "còn VCB?", skills: [], registry: r }))
  expect(next.some((e) => e.type === "notice" && e.text.includes("Đang hoãn"))).toBe(false)
  expect(toolNames(bodies[0])).toEqual(expect.arrayContaining(["mcp__big__t001", "mcp__big__t002"]))
  expect(toolNames(bodies[0])).not.toContain("mcp__big__t003")
})

test("tool search: keyword search finds tools by description, ignoring diacritics", async () => {
  const r = bigRegistry(60)
  script = [{ tool: "tool_search", args: { query: "lich su gia" } }]
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  expect(ends(events)[0]!.output.split("\n")[0]).toBe("Đã nạp tool: mcp__big__t007")
  expect(ends(events)[0]!.output).toContain("- symbol (string)")
  expect(toolNames(bodies[1])).toContain("mcp__big__t007")
})

test("tool search: calling a deferred tool before loading it loads it — the error says call again, with its parameters", async () => {
  const r = bigRegistry(60)
  // A short name from <tool_hoan>: it cannot run at this step (only active tools can), but
  // the call loads the full tool, so the next step declares it and the model calls it again.
  script = [{ tool: "t005", args: { symbol: "HPG" } }]
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  const end = ends(events)[0]!
  expect(end.ok).toBe(false)
  expect(end.output.startsWith("Đã nạp tool: mcp__big__t005\nTool mcp__big__t005 chưa có trong bước này")).toBe(true)
  expect(end.output).toContain("## mcp__big__t005")
  expect(end.output).not.toContain("AI_")
  expect(toolNames(bodies[1])).toContain("mcp__big__t005")
  const sent = JSON.stringify(bodies[1]!.messages)
  expect(sent).toContain("gọi lại đúng lệnh")
  expect(sent).not.toContain("AI_ToolCallRepairError")
  expect(sent).not.toContain("Error repairing tool call")
  expect(events.at(-1)!.type).toBe("done")
  // Saved history is clean too, and still loads the tool on the next turn.
  const saved = done(events).messages
  expect(JSON.stringify(saved)).not.toContain("AI_")
  expect(loadedTools(saved)).toContain("mcp__big__t005")
})

test("tool search: the exact name of a deferred tool is loaded by the call itself", async () => {
  const r = bigRegistry(60)
  script = [{ tool: "mcp__big__t007", args: { symbol: "HPG" } }]
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  expect(ends(events)[0]!.output).toContain("gọi lại đúng lệnh với tên mcp__big__t007")
  expect(toolNames(bodies[1])).toContain("mcp__big__t007")
})

test("tool search: sessions saved with the SDK's raw error strings still load the tool", () => {
  const old: ModelMessage[] = [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "t005", input: {} }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "t005",
          output: { type: "error-text", value: "AI_ToolCallRepairError: Error repairing tool call: Error: Đã nạp tool: mcp__big__t005\nTool …" },
        },
      ],
    },
  ]
  expect(loadedTools(old)).toContain("mcp__big__t005")
})

test("tool search: an unknown name tells the model to search first", async () => {
  const r = bigRegistry(60)
  script = [{ tool: "khong_co_tool_nay", args: {} }]
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  expect(ends(events)[0]!.ok).toBe(false)
  expect(JSON.stringify(bodies[1]!.messages)).toContain("tool_search")
  expect(events.at(-1)!.type).toBe("done")
})

test("tool search: few MCP tools are sent directly in auto mode; 'on' defers them anyway", async () => {
  const r = bigRegistry(5)
  await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  expect(toolNames(bodies[0])).toContain("mcp__big__t004")
  expect(systemText(bodies[0])).not.toContain("Các tool dưới đây đang hoãn")
  await saveConfig({ toolSearch: "on" })
  bodies.length = 0
  await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  expect(toolNames(bodies[0])).not.toContain("mcp__big__t004")
})

test("tool search: alwaysLoad tools are never deferred", async () => {
  const r = bigRegistry(60)
  r.register({ ...r.get("mcp__big__t010")!, name: "mcp__core__quote", source: "mcp:core", deferrable: false })
  await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  expect(toolNames(bodies[0])).toContain("mcp__core__quote")
  expect(toolNames(bodies[0])).not.toContain("mcp__big__t010")
})

test("tool search: the forced last step keeps loaded tools declared", async () => {
  const r = bigRegistry(60)
  script = [
    { tool: "tool_search", args: { query: "select:t003" } },
    { tool: "mcp__big__t003", args: {} },
    { tool: "mcp__big__t003", args: {} },
  ]
  await collect(runAgent({ history: [], input: "x", skills: [], registry: r, maxSteps: 3 }))
  expect(bodies[2]!.tool_choice).toBe("none")
  expect(toolNames(bodies[2])).toContain("mcp__big__t003")
})

test("tool search: load_skill loads the skill's deferred tools for the next step", async () => {
  const { loadSkillTool } = await import("../src/core/tools/builtin/load-skill")
  const r = bigRegistry(60)
  const skill = { name: "gia", description: "giá", dir: "/s", source: "bundled" as const, body: "Làm theo", activation: "auto" as const, requires_tools: ["big/t01*"] }
  r.register(loadSkillTool(() => [skill], () => r.list().filter((d) => d.deferrable).map((d) => d.name)))
  script = [{ tool: "load_skill", args: { name: "gia" } }]
  await collect(runAgent({ history: [], input: "x", skills: [skill], registry: r }))
  expect(toolNames(bodies[0])).not.toContain("mcp__big__t012")
  expect(toolNames(bodies[1])).toEqual(expect.arrayContaining(["mcp__big__t010", "mcp__big__t019"]))
  expect(toolNames(bodies[1])).not.toContain("mcp__big__t020")
  // The skill is listed although its tools are only deferred.
  expect(systemText(bodies[0])).toContain("- gia:")
})

test("MCP server instructions reach the system prompt", async () => {
  await collect(
    runAgent({ history: [], input: "x", skills: [], registry: registry(), serverInstructions: () => [{ server: "ot", text: "HUONG-DAN-OT" }] }),
  )
  expect(systemText(bodies[0])).toContain("HUONG-DAN-OT")
})

test("a todo_write the tool rejects is recorded as an error, so the list comes from the next valid call", async () => {
  const { todoWriteTool } = await import("../src/core/tools/builtin/todo-write")
  const { currentTodos } = await import("../src/core/tools/todos")
  const r = registry()
  r.register(todoWriteTool())
  const bad = [
    { content: "A", status: "in_progress" },
    { content: "B", status: "in_progress" },
  ]
  const good = [
    { content: "A", status: "in_progress" as const },
    { content: "B", status: "pending" as const },
  ]
  script = [{ tool: "todo_write", args: { todos: bad } }]
  const rejected = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  expect(ends(rejected)[0]).toMatchObject({ ok: false })
  expect(currentTodos(done(rejected).messages)).toEqual([])

  bodies.length = 0
  script = [
    { tool: "todo_write", args: { todos: bad } },
    { tool: "todo_write", args: { todos: good } },
  ]
  const fixed = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  // The list in force before the answer is the valid call's.
  expect(currentTodos(done(fixed).messages.slice(0, -1))).toEqual(good)
  // The model answered with it still open: retired, its items recorded as unconfirmed, never done.
  const { harnessMarks } = await import("../src/core/tools/todos")
  expect(currentTodos(done(fixed).messages)).toEqual([])
  expect(harnessMarks(done(fixed).messages.at(-1)!).retiredTodos).toEqual(good)
  expect(fixed.some((e) => e.type === "notice" && e.text.includes("CHƯA được xác nhận là xong"))).toBe(true)
})

test("done carries the context size: provider usage of the last step, else an estimate", async () => {
  usage = { prompt_tokens: 1_234, completion_tokens: 56 }
  const measured = done(await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() })))
  expect(measured.usage).toEqual({ contextTokens: 1_290, estimated: false, total: { input: 1_234, output: 56 } })
  usage = undefined
  const guessed = done(await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() })))
  expect(guessed.usage?.estimated).toBe(true)
  expect(guessed.usage!.contextTokens).toBeGreaterThan(100) // system prompt + tool schemas
})

test("near the threshold mid-turn, later steps go out with old tool results pruned; history is untouched", async () => {
  const { PRUNED_TEXT } = await import("../src/core/compact")
  const oldTurn = (n: number): ModelMessage[] => [
    { role: "user", content: `câu ${n}` },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: `old${n}`, toolName: "current_time", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: `old${n}`, toolName: "current_time", output: { type: "text", value: `CU-${n}-${"x".repeat(2_000)}` } }] },
    { role: "assistant", content: `trả lời ${n}` },
  ]
  const history = [...oldTurn(1), ...oldTurn(2)]
  script = [{ tool: "current_time", args: {} }]
  toolUsage = { prompt_tokens: 9_000, completion_tokens: 10 }
  usage = { prompt_tokens: 4_500, completion_tokens: 20 }
  const events = await collect(runAgent({ history, input: "x", skills: [], registry: registry(), compactAt: 5_000 }))
  // The answer was measured on the pruned request; the history still holds the pruned result
  // (~500 tokens), so the reported size adds it back and the next turn compacts.
  expect(done(events).usage!.contextTokens).toBeGreaterThan(4_520 + 400)
  // The first request is as before; the step after a 9k-token one prunes outside the last 2 turns.
  expect(JSON.stringify(bodies[0]!.messages)).toContain("CU-1-")
  expect(JSON.stringify(bodies[1]!.messages)).not.toContain("CU-1-")
  expect(JSON.stringify(bodies[1]!.messages)).toContain(PRUNED_TEXT)
  expect(JSON.stringify(bodies[1]!.messages)).toContain("CU-2-")
  expect(events.some((e) => e.type === "notice" && e.text.includes("1 kết quả tool cũ đã dọn"))).toBe(true)
  expect(JSON.stringify(history)).toContain("CU-1-")

  // Below the threshold, or without one, nothing is pruned.
  bodies.length = 0
  await collect(runAgent({ history, input: "x", skills: [], registry: registry(), compactAt: 50_000 }))
  expect(JSON.stringify(bodies[1]!.messages)).toContain("CU-1-")
  bodies.length = 0
  await collect(runAgent({ history, input: "x", skills: [], registry: registry() }))
  expect(JSON.stringify(bodies[1]!.messages)).toContain("CU-1-")
})

test("the compaction summary is asked with the turn's system prompt and visible tools, tools off, the prompt last", async () => {
  const { summarizeConversation } = await import("../src/core/agent")
  const r = bigRegistry(130) // MCP tools deferred: only what history loaded may be declared
  const head: ModelMessage[] = [
    { role: "user", content: "chụp" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "s", toolName: "mcp__big__t001", input: {} }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "s",
          toolName: "mcp__big__t001",
          output: { type: "content", value: [{ type: "text", text: "đã chụp" }, { type: "image-data", data: "QUJDREVGRw==", mediaType: "image/png" }] },
        },
      ],
    },
    { role: "assistant", content: "xong" },
  ]
  await collect(runAgent({ history: head, input: "x", skills: [], registry: r }))
  const turnSystem = systemText(bodies[0])
  bodies.length = 0
  const text = await summarizeConversation({ head, prompt: "TÓM-TẮT-ĐI", skills: [], registry: r })
  expect(text).toBe("Kết quả: xong.")
  const body = bodies[0]!
  expect(systemText(body)).toBe(turnSystem)
  expect(body.tool_choice).toBe("none")
  expect(JSON.stringify(body.messages.at(-1)!.content)).toContain("TÓM-TẮT-ĐI")
  // Deferred tools stay deferred; the one history used is declared.
  expect(toolNames(body)).toContain("mcp__big__t001")
  expect(toolNames(body)).not.toContain("mcp__big__t003")
  // A model without vision gets the image as a placeholder.
  expect(JSON.stringify(body.messages)).not.toContain("QUJDREVGRw==")
})

test("the compaction request uses the configured effort, like the turns (review #117)", async () => {
  const { summarizeConversation } = await import("../src/core/agent")
  await saveConfig({ provider: "groq", model: "openai/gpt-oss-20b", effort: "low" })
  try {
    bodies.length = 0
    const head: ModelMessage[] = [
      { role: "user", content: "câu 1" },
      { role: "assistant", content: "trả lời 1" },
    ]
    await summarizeConversation({ head, prompt: "TÓM-TẮT-ĐI", skills: [], registry: registry() })
    expect((bodies[0] as unknown as { reasoning_effort?: string }).reasoning_effort).toBe("low")
    // A caller's own effort wins over the config.
    bodies.length = 0
    await summarizeConversation({ head, prompt: "TÓM-TẮT-ĐI", skills: [], registry: registry(), effort: "high" })
    expect((bodies[0] as unknown as { reasoning_effort?: string }).reasoning_effort).toBe("high")
  } finally {
    await saveConfig({ provider: "groq", model: "tooly", effort: undefined })
  }
})

const threeTurns: ModelMessage[] = [1, 2, 3].flatMap((n): ModelMessage[] => [
  { role: "user", content: `câu ${n}` },
  { role: "assistant", content: `trả lời ${n}` },
])

test("a summary cut off at the output limit is rejected, not used", async () => {
  const { summarizeConversation } = await import("../src/core/agent")
  summaryFinish = "length"
  const error = await summarizeConversation({ head: threeTurns, prompt: "TÓM", skills: [], registry: registry() }).then(
    () => undefined,
    (e: Error) => e.message,
  )
  expect(error).toContain("bị cắt")
  expect(bodies).toHaveLength(1)
})

test("quota errors that mention tokens never trim the head; a real overflow drops the oldest turn and retries", async () => {
  const { summarizeConversation } = await import("../src/core/agent")
  const users = (b: Body) => b.messages.filter((m) => m.role === "user").length
  // Per-minute limit: retry.ts retries the same request, the head is kept whole.
  summaryErrors = [{ status: 429, message: "Resource exhausted: input token count per minute" }]
  expect(await summarizeConversation({ head: threeTurns, prompt: "TÓM", skills: [], registry: registry() })).toBe("Kết quả: xong.")
  expect(bodies).toHaveLength(2)
  expect(users(bodies[1]!)).toBe(users(bodies[0]!))

  // Daily quota: one request, no retry, no trimming.
  bodies.length = 0
  summaryErrors = [{ status: 429, message: "Rate limit reached for model on tokens per day (TPD)" }]
  const quota = await summarizeConversation({ head: threeTurns, prompt: "TÓM", skills: [], registry: registry() }).then(
    () => undefined,
    (e: Error) => e.message,
  )
  expect(quota).toContain("hết quota trong ngày")
  expect(bodies).toHaveLength(1)

  bodies.length = 0
  summaryErrors = [{ status: 400, message: "This model's maximum context length is 8192 tokens" }]
  const text = await summarizeConversation({ head: threeTurns, prompt: "TÓM", skills: [], registry: registry() })
  expect(text).toBe("Kết quả: xong.")
  expect(bodies).toHaveLength(2)
  expect(users(bodies[1]!)).toBe(users(bodies[0]!) - 1)
})

test("while todo items are open, the nudge after tool results lists them and asks to close them with the answer", async () => {
  const { toolNudge, TOOL_NUDGE } = await import("../src/core/agent")
  const { todoWriteTool } = await import("../src/core/tools/builtin/todo-write")
  const r = registry()
  r.register(todoWriteTool())
  script = [
    { tool: "todo_write", args: { todos: [{ content: "So sánh FPT với ngành", status: "in_progress" }] } },
    { tool: "current_time", args: {} },
  ]
  await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  // After the todo_write result and after the last tool result: both list the open item.
  const nudges = bodies.slice(1).map((b) => JSON.stringify(b.messages.at(-1)!.content))
  expect(nudges.length).toBeGreaterThanOrEqual(2)
  for (const n of nudges) expect(n).toContain("[>] So sánh FPT với ngành")
  expect(nudges.at(-1)).toContain("đóng danh sách trong cùng bước đó")
  // Nothing open: the plain nudge.
  expect(toolNudge([])).toBe(TOOL_NUDGE)
})

test("tool errors reach the model without the SDK's prefixes: a wrong argument is one Vietnamese line, never the input echoed", async () => {
  const r = registry()
  r.register({
    name: "pick",
    description: "needs two refs",
    input: z.object({ from_calls: z.array(z.string()).min(2), kind: z.enum(["a", "b"]) }),
    readOnly: true,
    execute: async () => "ok",
  })
  script = [{ tool: "pick", args: { from_calls: ["r1"], kind: "c" } }]
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  const end = ends(events)[0]!
  expect(end.output).toBe('Tham số không hợp lệ cho pick:\n- from_calls: cần ít nhất 2 phần tử\n- kind: phải là một trong: "a", "b"\nSửa tham số rồi gọi lại.')
  const sent = JSON.stringify(bodies[1]!.messages)
  expect(sent).toContain("cần ít nhất 2 phần tử")
  expect(sent).not.toContain("AI_")
  expect(sent).not.toContain("origin")
})

test("a thrown tool error reaches the model as its message, without 'Error: '", async () => {
  script = [{ tool: "boom", args: {} }]
  await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  const sent = JSON.stringify(bodies[1]!.messages)
  expect(sent).toContain("nguồn dữ liệu sập")
  expect(sent).not.toContain("Error: nguồn")
})

test("a deferred tool with wrong arguments, called before loading, is loaded (its arguments are never checked first)", async () => {
  const r = bigRegistry(60)
  r.register({ name: "mcp__big__strict", source: "mcp:big", deferrable: true, description: "x", input: z.object({ n: z.number() }), readOnly: true, execute: async () => "ok" })
  script = [{ tool: "mcp__big__strict", args: { n: "x" } }]
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  expect(ends(events)[0]!.output.startsWith("Đã nạp tool: mcp__big__strict")).toBe(true)
})

test("a loaded tool cut by the per-request cap is reported as such, not as 'loaded, call again' (no loop)", async () => {
  const r = bigRegistry(140)
  // History that loaded all 140: the cap keeps the first ones, so t139 stays out.
  const calls = Array.from({ length: 140 }, (_, i) => `mcp__big__t${String(i).padStart(3, "0")}`)
  const history: ModelMessage[] = [
    { role: "user", content: "trước" },
    { role: "assistant", content: calls.map((name, i) => ({ type: "tool-call" as const, toolCallId: `h${i}`, toolName: name, input: {} })) },
    { role: "tool", content: calls.map((name, i) => ({ type: "tool-result" as const, toolCallId: `h${i}`, toolName: name, output: { type: "text" as const, value: "ok" } })) },
    { role: "assistant", content: "xong" },
  ]
  script = [{ tool: "mcp__big__t139", args: {} }]
  const events = await collect(runAgent({ history, input: "x", skills: [], registry: r }))
  expect(ends(events)[0]!.output).toContain("chạm trần 128 tool")
  expect(ends(events)[0]!.output).not.toContain("gọi lại đúng lệnh")
})

test("the deferral notice counts built-in tools apart from MCP ones", async () => {
  const r = bigRegistry(60)
  r.register({ name: "chart_render", source: "local", deferrable: true, description: "x", input: z.object({}), readOnly: true, execute: async () => "ok" })
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: r }))
  const notice = events.find((e) => e.type === "notice" && e.text.startsWith("Đang hoãn")) as { text: string } | undefined
  expect(notice?.text).toStartWith("Đang hoãn 61 tool (60 MCP của big, 1 tool có sẵn);")
})

test("a request waiting on a 429 retry is not cut by the stall timer", async () => {
  process.env.OPENTRADING_STALL_MS = "300"
  process.env.OPENTRADING_RETRY_SCALE = "1"
  try {
    failFirst = 1
    failBody = { error: { message: "rate limited, try again in 1s" } }
    const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
    expect(events.some((e) => e.type === "retry")).toBe(true)
    expect(done(events).outcome).toBe("completed")
  } finally {
    delete process.env.OPENTRADING_STALL_MS
    process.env.OPENTRADING_RETRY_SCALE = "0"
  }
})

test("an aborted turn keeps each step's text once", async () => {
  plan = { tool: "hang", args: {}, text: "Đang kiểm tra. " }
  const controller = new AbortController()
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry(), signal: controller.signal }), (e) => {
    if (e.type === "tool-start") setTimeout(() => controller.abort(), 20)
  })
  const messages = done(events).messages
  expect(JSON.stringify(messages).split("Đang kiểm tra.").length - 1).toBe(1)
  expect(messages.map((m) => m.role).join(",")).not.toContain("assistant,assistant")
  expect(closeDanglingToolCalls(messages).patched).toBe(0)
})

test("a turn that fails after a tool keeps the result as the model sees it: no chart payload, no base64", async () => {
  plan = { tool: "pic", args: {} }
  failAfterTool = 99
  const r = registry()
  r.register({
    name: "pic",
    description: "returns a chart and an image",
    input: z.object({}),
    readOnly: true,
    async execute() {
      return { output: "đã vẽ", chart: { secret: "CHART_PAYLOAD" } as never, images: [{ mediaType: "image/png", data: "BASE64DATA" }] }
    },
  })
  const first = done(await collect(runAgent({ history: [], input: "x", skills: [], registry: r })))
  expect(first.outcome).toBe("failed")
  failAfterTool = 0
  plan = undefined
  bodies.length = 0
  await collect(runAgent({ history: first.messages, input: "tiếp", skills: [], registry: r }))
  const sent = JSON.stringify(bodies[0]!.messages.filter((m) => m.role === "tool"))
  expect(sent).toContain("đã vẽ")
  expect(sent).not.toContain("CHART_PAYLOAD")
  expect(sent).not.toContain("BASE64DATA")
})

test("a turn cut after a failed tool keeps the cleaned error, not the SDK's raw text", async () => {
  script = [{ tool: "boom", args: {} }, { tool: "hang", args: {} }]
  const controller = new AbortController()
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry(), signal: controller.signal }), (e) => {
    if (e.type === "tool-start" && e.name === "hang") setTimeout(() => controller.abort(), 20)
  })
  const kept = JSON.stringify(done(events).messages)
  expect(kept).toContain("nguồn dữ liệu sập")
  expect(kept).not.toContain("Error: nguồn")
})

test("an invalid OPENTRADING_STALL_MS falls back to the default instead of cutting every request", async () => {
  answerDelayMs = 50
  for (const value of ["abc", "0", "-5"]) {
    process.env.OPENTRADING_STALL_MS = value
    try {
      const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
      expect(done(events).outcome).toBe("completed")
    } finally {
      delete process.env.OPENTRADING_STALL_MS
    }
  }
})

test("an empty answer made of thoughts only is dropped, so two model turns never sit side by side", async () => {
  plan = { tool: "current_time", args: {} }
  emptyAfterTool = "once"
  emptyWithThoughts = true
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(events.some((e) => e.type === "progress")).toBe(true)
  expect(done(events).messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
})

test("Gemini reasoning models are asked for their thoughts; other models are left alone", () => {
  const google = (reasoning: boolean) => ({ npm: "@ai-sdk/google", models: { m: { reasoning } } })
  expect(thoughtOptions({ provider: google(true), model: "m" })).toEqual({ google: { thinkingConfig: { includeThoughts: true } } })
  expect(thoughtOptions({ provider: google(false), model: "m" })).toBeUndefined()
  expect(thoughtOptions({ provider: { npm: "@ai-sdk/groq", models: { m: { reasoning: true } } }, model: "m" })).toBeUndefined()
})

test("<quyen_tep> names the workspace, goes out once and again when /add-dir changes it", async () => {
  const { Workspace } = await import("../src/core/fs/workspace")
  const { readFileTool } = await import("../src/core/tools/fs/read")
  const { mkdir } = await import("node:fs/promises")
  const project = path.join(home, "du-an")
  const extra = path.join(home, "bctc")
  await mkdir(project, { recursive: true })
  await mkdir(extra, { recursive: true })
  const r = registry()
  const workspace = new Workspace(project, { data: path.join(home, "data") })
  r.workspace = workspace
  r.register(readFileTool(workspace))
  const userOf = (i: number) => JSON.stringify(bodies[i]!.messages.filter((m) => m.role === "user").at(-1))
  const first = done(await collect(runAgent({ history: [], input: "đọc file", skills: [], registry: r })))
  expect(userOf(0)).toContain("quyen_tep")
  expect(userOf(0)).toContain(JSON.stringify(project).slice(1, -1))
  bodies.length = 0
  const second = done(await collect(runAgent({ history: first.messages, input: "tiếp", skills: [], registry: r, prevClock: first.clock })))
  expect(userOf(0)).not.toContain("quyen_tep")
  workspace.add(extra)
  bodies.length = 0
  await collect(runAgent({ history: [...first.messages, ...second.messages], input: "thêm thư mục", skills: [], registry: r, prevClock: second.clock }))
  expect(userOf(0)).toContain("quyen_tep")
  expect(userOf(0)).toContain(JSON.stringify(extra).slice(1, -1))
})

test("read-only sends write_file/edit_file by name only; ask mode declares them; <quyen_tep> says the mode", async () => {
  const { Workspace } = await import("../src/core/fs/workspace")
  const { FileState } = await import("../src/core/fs/file-state")
  const { FileHistory } = await import("../src/core/fs/history")
  const { readFileTool } = await import("../src/core/tools/fs/read")
  const { writeFileTool, editFileTool } = await import("../src/core/tools/fs/write")
  const { PermissionGate } = await import("../src/core/permission")
  const { mkdir } = await import("node:fs/promises")
  const project = path.join(home, "du-an-ghi")
  await mkdir(project, { recursive: true })
  const r = bigRegistry(5)
  const workspace = new Workspace(project, { data: path.join(home, "data") })
  const deps = { workspace, state: new FileState(), history: new FileHistory(path.join(home, "fh")) }
  r.workspace = workspace
  r.gate = new PermissionGate({ load: async () => [], save: async () => {} })
  r.register(readFileTool(workspace, deps.state))
  r.register(writeFileTool(deps))
  r.register(editFileTool(deps))
  await saveConfig({ toolSearch: "on" })
  const userOf = (i: number) => JSON.stringify(bodies[i]!.messages.filter((m) => m.role === "user").at(-1))
  const first = done(await collect(runAgent({ history: [], input: "lập kế hoạch", skills: [], registry: r })))
  expect(toolNames(bodies[0])).not.toContain("write_file")
  expect(systemText(bodies[0])).toContain("write_file")
  expect(userOf(0)).toContain("chỉ đọc")
  r.gate.setMode("ask")
  bodies.length = 0
  await collect(runAgent({ history: first.messages, input: "ghi file đi", skills: [], registry: r, prevClock: first.clock }))
  expect(toolNames(bodies[0])).toContain("write_file")
  expect(toolNames(bodies[0])).toContain("edit_file")
  expect(userOf(0)).toContain("sửa có hỏi")
})

// --- Stop gate (loop/stop-gate.ts): a turn never ends without an answer ---

const toolCall = (name: string, args: object, id = "call_x", text?: string) =>
  sse([
    ...(text ? [chunk({ role: "assistant", content: text })] : []),
    chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
    chunk({}, "tool_calls"),
  ])
const answer = (content: string, finish = "stop") => sse([chunk({ role: "assistant", content }), chunk({}, finish)])
const lastSent = (n: number) => JSON.stringify(bodies.filter((b) => (b as { stream?: boolean }).stream)[n]!.messages.at(-1))

async function todoRegistry() {
  const { todoWriteTool } = await import("../src/core/tools/builtin/todo-write")
  const r = registry()
  r.register(todoWriteTool())
  return r
}

test("a preamble, a tool, then an empty last step: the empty step is recovered (the preamble is no answer)", async () => {
  respond = (_body, n) =>
    n === 0 ? toolCall("current_time", {}, "call_1", "Mình sẽ xem giờ trước.") : n === 1 ? answer("") : undefined
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(3)
  // Right after tool results: tools off first.
  expect(bodies[2]!.tool_choice).toBe("none")
  const messages = done(events).messages
  expect(JSON.stringify(messages.at(-1))).toContain("Kết quả: xong.")
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
  expect(done(events).recoveries).toEqual([{ kind: "empty", attempt: 1 }])
  expect(events.some((e) => e.type === "notice" && e.text.includes("dừng khi chưa viết câu trả lời"))).toBe(true)
})

test("an answer that only echoes the todo status (29/10) is recovered, tools allowed, and never stored", async () => {
  respond = (_body, n) => (n === 0 ? answer("\n*(Đã hoàn thành các việc cần làm)*") : undefined)
  const events = await collect(runAgent({ history: [], input: "Đi sâu vào mã VCB cho tôi.", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(2)
  expect(bodies[1]!.tool_choice).not.toBe("none")
  expect(lastSent(1)).toContain("chưa viết câu trả lời")
  // The nudge joins the user message the request ends with: never two user messages in a row.
  const roles = bodies[1]!.messages.map((m) => m.role).filter((r) => r !== "system")
  expect(roles).toEqual(["user"])
  const stored = JSON.stringify(done(events).messages)
  expect(stored).not.toContain("Đã hoàn thành các việc cần làm")
  expect(stored).not.toContain("chưa viết câu trả lời")
  expect(done(events).messages.map((m) => m.role)).toEqual(["user", "assistant"])
  expect(done(events).unanswered).toBeUndefined()
})

test("a cut answer (finish length) is continued and joined into one message", async () => {
  respond = (_body, n) => (n === 0 ? answer("Phần đầu, ", "length") : n === 1 ? answer("phần sau.") : undefined)
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(2)
  expect(lastSent(1)).toContain("bị cắt")
  const messages = done(events).messages
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant"])
  expect(JSON.stringify(messages[1])).toContain("Phần đầu, phần sau.")
  expect(done(events).recoveries).toEqual([{ kind: "length", attempt: 1 }])
})

test("answering and closing the todo list in one step ends the turn: no extra request", async () => {
  const done3 = { todos: [{ content: "Lấy dữ liệu", status: "completed" }, { content: "Kết luận", status: "completed" }] }
  respond = (_body, n) => (n === 0 ? toolCall("todo_write", done3, "call_t", "Câu trả lời thật.") : undefined)
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: await todoRegistry() }))
  expect(bodies).toHaveLength(1)
  expect(done(events).messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"])
  expect(done(events).recoveries).toBeUndefined()
})

test("a preamble that opens a todo list goes on (the early stop is only for a closing call)", async () => {
  const open = { todos: [{ content: "Lấy dữ liệu", status: "in_progress" }, { content: "Kết luận", status: "pending" }] }
  respond = (_body, n) => (n === 0 ? toolCall("todo_write", open, "call_t", "Để mình lấy dữ liệu.") : undefined)
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: await todoRegistry() }))
  expect(bodies).toHaveLength(2)
  expect(JSON.stringify(done(events).messages.at(-1))).toContain("Kết quả: xong.")
})

test("echoed todo lines are cut from a real answer before it is stored", async () => {
  respond = (_body, n) => (n === 0 ? answer("Câu trả lời thật.\n\n*(Đã cập nhật việc cần làm: 1/3 xong)*\n") : undefined)
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(1)
  const stored = JSON.stringify(done(events).messages)
  expect(stored).toContain("Câu trả lời thật.")
  expect(stored).not.toContain("Đã cập nhật việc cần làm")
})

test("with a step cap, a recovery run gets only the steps left and the summary still comes last", async () => {
  await saveConfig({ provider: "groq", model: "tooly", maxSteps: 2 })
  try {
    respond = (_body, n) => (n === 0 ? answer("") : undefined)
    const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
    // Request 1 is empty, the recovery run has one step left: the forced summary.
    expect(bodies).toHaveLength(2)
    expect(bodies[1]!.tool_choice).toBe("none")
    expect(JSON.stringify(done(events).messages.at(-1))).toContain("Kết quả: xong.")
  } finally {
    await saveConfig({ provider: "groq", model: "tooly", maxSteps: undefined })
  }
})

test("a malformed Gemini call is sent back with tools on, and the tool then runs", async () => {
  respond = (_body, n) => (n === 0 ? answer("", "MALFORMED_FUNCTION_CALL") : n === 1 ? toolCall("current_time", {}, "call_m") : undefined)
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(3)
  expect(bodies[1]!.tool_choice).not.toBe("none")
  expect(tools(events)).toEqual(["current_time"])
  expect(done(events).recoveries).toEqual([{ kind: "malformed", attempt: 1 }])
  expect(JSON.stringify(done(events).messages.at(-1))).toContain("Kết quả: xong.")
})

test("a provider filter gives up at once: no request spent asking again", async () => {
  respond = (_body, n) => (n === 0 ? answer("", "content_filter") : undefined)
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(1)
  expect(done(events).unanswered).toBe(true)
  expect(events.some((e) => e.type === "notice" && e.text.includes("rỗng"))).toBe(true)
})

test("a promise without a tool call is sent back once with tools on, and the tool then runs", async () => {
  respond = (_body, n) => (n === 0 ? answer("Mình sẽ lấy giờ hiện tại:") : n === 1 ? toolCall("current_time", {}, "call_p") : undefined)
  const events = await collect(runAgent({ history: [], input: "mấy giờ rồi", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(3)
  expect(bodies[1]!.tool_choice).not.toBe("none")
  expect(lastSent(1)).toContain("không gọi tool nào")
  expect(tools(events)).toEqual(["current_time"])
  expect(done(events).recoveries).toEqual([{ kind: "promise", attempt: 1 }])
  // The promise is not kept: the answer follows the tool result.
  expect(JSON.stringify(done(events).messages)).not.toContain("Mình sẽ lấy giờ hiện tại")
})

test("an answer that ends with an offer or a question costs exactly one request", async () => {
  respond = (_body, n) => (n === 0 ? answer("VCB đóng cửa 57.200đ.\n\nBạn có muốn mình lấy thêm dữ liệu khối ngoại không?") : undefined)
  const events = await collect(runAgent({ history: [], input: "giá VCB", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(1)
  expect(done(events).recoveries).toBeUndefined()
})

test("with a step cap, a summary that names what is missing is kept as the answer, not sent back", async () => {
  await saveConfig({ provider: "groq", model: "tooly", maxSteps: 2 })
  try {
    respond = (_body, n) => (n === 0 ? toolCall("current_time", {}, "call_c") : n === 1 ? answer("Tôi cần tra cứu thêm BCTC quý 3.") : undefined)
    const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
    expect(bodies).toHaveLength(2)
    expect(JSON.stringify(done(events).messages.at(-1))).toContain("Tôi cần tra cứu thêm BCTC quý 3.")
    expect(done(events).unanswered).toBeUndefined()
    expect(done(events).recoveries).toBeUndefined()
  } finally {
    await saveConfig({ provider: "groq", model: "tooly", maxSteps: undefined })
  }
})

test("next turn: the answer of an 'answer + close todo' step is sent after its tool result (30/10)", async () => {
  const closed = { todos: [{ content: "Lấy dữ liệu", status: "completed" }] }
  respond = (_body, n) => (n === 0 ? toolCall("todo_write", closed, "call_t", "Phân tích 3 mã xong.") : n === 1 ? answer("VCB: đi sâu.") : undefined)
  const r = await todoRegistry()
  const first = await collect(runAgent({ history: [], input: "Phân tích 3 mã", skills: [], registry: r }))
  const history = done(first).messages
  // Stored as streamed: the session file keeps the step's order.
  expect(history.map((m) => m.role)).toEqual(["user", "assistant", "tool"])
  await collect(runAgent({ history, input: "Đi sâu vào mã VCB", skills: [], registry: r }))
  const sent = bodies[1]!.messages.filter((m) => m.role !== "system")
  expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user"])
  expect(JSON.stringify(sent[1])).toContain("tool_calls")
  expect(JSON.stringify(sent[1])).not.toContain("Phân tích 3 mã xong.")
  expect(JSON.stringify(sent[3])).toContain("Phân tích 3 mã xong.")
  expect(JSON.stringify(sent[4])).toContain("Đi sâu vào mã VCB")
})

test("a fragment answer is sent back once with tools on and never stored", async () => {
  respond = (_body, n) => (n === 0 ? answer(" hoặc FPT không, hoặc bạn muốn mình phản biện?") : n === 1 ? answer("VCB: phân tích sâu.") : undefined)
  const events = await collect(runAgent({ history: [], input: "Đi sâu vào mã VCB", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(2)
  expect(bodies[1]!.tool_choice).not.toBe("none")
  expect(lastSent(1)).toContain("bị cụt đầu")
  expect(done(events).recoveries).toEqual([{ kind: "fragment", attempt: 1 }])
  const stored = JSON.stringify(done(events).messages)
  expect(stored).not.toContain("hoặc FPT không")
  expect(stored).toContain("VCB: phân tích sâu.")
  expect(done(events).messages.map((m) => m.role)).toEqual(["user", "assistant"])
})
