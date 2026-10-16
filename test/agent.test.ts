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
    },
  },
}

type Body = { messages: { role: string; content?: unknown }[]; tools?: unknown[]; tool_choice?: unknown }
const bodies: Body[] = []
/** What the fake model does when the conversation has no tool results yet. */
let plan: { tool: string; args: object; always?: boolean } | undefined
/** Several tool calls in one turn: call `script[n]` after n tool results (this turn), then answer. */
let script: { tool: string; args: object }[] | undefined
/** Mimic gemini-2.5-flash-lite: answer with nothing after a tool result. */
let emptyAfterTool: "once" | "always" | undefined
/** Non-streamed answers (the compaction summary): an error per request, then the finish reason. */
let summaryErrors: { status: number; message: string }[] = []
let summaryFinish = "stop"
/** Token usage reported on the answer's last chunk (Groq sends it as x_groq.usage). */
let usage: { prompt_tokens: number; completion_tokens: number } | undefined
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
      chunk({}, "tool_calls"),
    ])
  }
  if (plan && body.tool_choice !== "none" && (plan.always || !hasToolResult)) {
    const id = `call_${bodies.length}`
    return sse([
      chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: plan.tool, arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(plan.args) } }] }),
      chunk({}, "tool_calls"),
    ])
  }
  const nudged = JSON.stringify(body.messages.at(-1)?.content ?? "").includes(NUDGE)
  if (emptyAfterTool && hasToolResult && (emptyAfterTool === "always" || !nudged)) {
    return sse([chunk({ role: "assistant", content: "" }), chunk({}, "stop")])
  }
  const last = usage ? { ...chunk({}, "stop"), x_groq: { usage } } : chunk({}, "stop")
  return sse([chunk({ role: "assistant", content: "Kết quả: " }), chunk({ content: "xong." }), last])
}) as typeof fetch

const { runAgent } = await import("../src/core/agent")
const { ToolRegistry } = await import("../src/core/tools/registry")
const { currentTimeTool } = await import("../src/core/tools/builtin/current-time")
const { saveConfig } = await import("../src/core/config")
const { toolSearchTool } = await import("../src/core/tools/builtin/tool-search")
const { setKey } = await import("../src/core/auth")
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
  plan = undefined
  script = undefined
  emptyAfterTool = undefined
  usage = undefined
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
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant"])
  expect(JSON.stringify(messages)).not.toContain("tool-call")
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
  expect(messages.at(-1)!.content).toBe("Kết quả: xong.")
})

test("a model that stays silent gets a visible notice, not a blank turn", async () => {
  plan = { tool: "current_time", args: {} }
  emptyAfterTool = "always"
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies).toHaveLength(3) // one retry only
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
    expect(firstUser.indexOf("moi_truong")).toBeLessThan(firstUser.indexOf("phien_giao_dich"))
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
  expect(currentTodos(done(fixed).messages)).toEqual(good)
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

test("a quota error that mentions tokens is not retried; a real overflow drops the oldest turn and retries", async () => {
  const { summarizeConversation } = await import("../src/core/agent")
  summaryErrors = [{ status: 429, message: "Resource exhausted: input token count per minute" }]
  const quota = await summarizeConversation({ head: threeTurns, prompt: "TÓM", skills: [], registry: registry() }).then(
    () => undefined,
    (e: Error) => e.message,
  )
  expect(quota).toBeDefined()
  expect(bodies).toHaveLength(1) // one request, no SDK retry, no head trimming

  bodies.length = 0
  summaryErrors = [{ status: 400, message: "This model's maximum context length is 8192 tokens" }]
  const text = await summarizeConversation({ head: threeTurns, prompt: "TÓM", skills: [], registry: registry() })
  expect(text).toBe("Kết quả: xong.")
  expect(bodies).toHaveLength(2)
  const users = (b: Body) => b.messages.filter((m) => m.role === "user").length
  expect(users(bodies[1]!)).toBe(users(bodies[0]!) - 1)
})

test("while todo items are open, the nudge after tool results lists them and asks to close them before answering", async () => {
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
  expect(nudges.at(-1)).toContain("trước khi viết câu trả lời cuối")
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
