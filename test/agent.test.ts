import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

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
/** Mimic gemini-2.5-flash-lite: answer with nothing after a tool result. */
let emptyAfterTool: "once" | "always" | undefined
const NUDGE = "Hãy trả lời câu hỏi của người dùng dựa trên kết quả tool"

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
  const body = JSON.parse(String(init?.body)) as Body
  bodies.push(body)
  // Branch on the request, not on call counts: tool results present → answer in text.
  const hasToolResult = body.messages.some((m) => m.role === "tool")
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
  return sse([chunk({ role: "assistant", content: "Kết quả: " }), chunk({ content: "xong." }), chunk({}, "stop")])
}) as typeof fetch

const { runAgent } = await import("../src/core/agent")
const { ToolRegistry } = await import("../src/core/tools/registry")
const { currentTimeTool } = await import("../src/core/tools/builtin/current-time")
const { saveConfig } = await import("../src/core/config")
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
  emptyAfterTool = undefined
  await saveConfig({ provider: "groq", model: "tooly" })
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
})

test("rate-limit errors wrapped in RetryError still read as quota errors", async () => {
  const { describeError } = await import("../src/core/chat")
  const quota = Object.assign(new Error("quota"), { name: "AI_APICallError", statusCode: 429 })
  const wrapped = Object.assign(new Error("Failed after 3 attempts. Last error: quota"), { name: "AI_RetryError", lastError: quota })
  expect(describeError(wrapped)).toContain("Hết quota")
})

test("models without tool support get no tools", async () => {
  await saveConfig({ provider: "groq", model: "plain" })
  plan = { tool: "current_time", args: {} }
  const events = await collect(runAgent({ history: [], input: "x", skills: [], registry: registry() }))
  expect(bodies[0]!.tools).toBeUndefined()
  expect(events.some((e) => e.type === "notice")).toBe(true)
})
