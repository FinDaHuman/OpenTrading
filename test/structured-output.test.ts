import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-structured-"))
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"

const text = { input: ["text"], output: ["text"] }
const CATALOG = {
  groq: {
    id: "groq",
    name: "Groq",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/groq",
    models: { tooly: { id: "tooly", name: "Tooly", tool_call: true, modalities: text } },
  },
}

type Msg = { role: string; content?: unknown }
type Body = { messages: Msg[]; tools?: { function: { name: string } }[]; tool_choice?: unknown }
type Reply = { call: { name: string; args: object } } | { text: string } | { status: number; message: string }

const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
const chunk = (delta: object, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: "tooly", choices: [{ index: 0, delta, finish_reason: finish }] })
let ids = 0

/** What the child answers, request by request; the last reply repeats. */
let replies: Reply[] = []
const bodies: Body[] = []

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (!url.endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`)
  const body = JSON.parse(String(init?.body)) as Body
  bodies.push(body)
  const reply = replies[Math.min(bodies.length - 1, replies.length - 1)]!
  if ("status" in reply) return Response.json({ error: { message: reply.message, type: "rate_limit" } }, { status: reply.status })
  if ("call" in reply) {
    const id = `call_${++ids}`
    return sse([
      chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: reply.call.name, arguments: JSON.stringify(reply.call.args) } }] }),
      chunk({}, "tool_calls"),
    ])
  }
  return sse([chunk({ role: "assistant", content: reply.text }), chunk({}, "stop")])
}) as typeof fetch

const { ToolRegistry } = await import("../src/core/tools/registry")
const { currentTimeTool } = await import("../src/core/tools/builtin/current-time")
const { saveConfig } = await import("../src/core/config")
const { setKey } = await import("../src/core/auth")
const { SubagentManager } = await import("../src/core/subagents/manager")
const { MAX_RESULT_ATTEMPTS, RESULT_REMINDER, RESULT_TOOL } = await import("../src/core/subagents/structured")

beforeAll(async () => {
  await setKey("groq", "gsk_test")
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await rm(home, { recursive: true, force: true })
})

beforeEach(async () => {
  bodies.length = 0
  replies = []
  await saveConfig({ provider: "groq", model: "tooly", subagents: undefined })
})

const SCORE = z.object({ ticker: z.string(), score: z.number().min(0).max(10), notes: z.string().optional() })

function manager() {
  const registry = new ToolRegistry()
  registry.register(currentTimeTool(() => new Date("2026-10-21T02:30:00Z")))
  return new SubagentManager({ parent: registry, skills: () => [] })
}

const lastUser = (body: Body) => [...body.messages].reverse().find((m) => m.role === "user")?.content

test("a valid tra_ket_qua call ends the run with its data, without another request", async () => {
  replies = [{ call: { name: RESULT_TOOL, args: { ticker: "FPT", score: 7 } } }]
  const run = manager().start({ description: "chấm FPT", prompt: "Chấm điểm FPT", schema: SCORE, deskRunId: "dk-1" })
  expect(run.deskRunId).toBe("dk-1")
  const result = await run.done
  expect(result.status).toBe("completed")
  expect(result.data).toEqual({ ticker: "FPT", score: 7 })
  expect(result.failure).toBeUndefined()
  expect(bodies).toHaveLength(1)
  expect(bodies[0]!.tools?.map((t) => t.function.name)).toContain(RESULT_TOOL)
})

test("the last allowed step is forced to call tra_ket_qua", async () => {
  replies = [{ call: { name: "current_time", args: {} } }, { call: { name: RESULT_TOOL, args: { ticker: "MWG", score: 5 } } }]
  const result = await manager().start({ description: "chấm MWG", prompt: "Chấm điểm MWG", schema: SCORE, maxSteps: 2 }).done
  expect(result.data).toEqual({ ticker: "MWG", score: 5 })
  // Step 1 is free; step 2 (the last) may only call the result tool.
  expect(bodies[0]!.tool_choice).not.toEqual({ type: "function", function: { name: RESULT_TOOL } })
  expect(bodies[1]!.tool_choice).toEqual({ type: "function", function: { name: RESULT_TOOL } })
  expect(bodies[1]!.tools?.map((t) => t.function.name)).toEqual([RESULT_TOOL])
})

test("an input that breaks the schema goes back to the model, which corrects it in the same turn", async () => {
  replies = [{ call: { name: RESULT_TOOL, args: { ticker: "HPG", score: 42 } } }, { call: { name: RESULT_TOOL, args: { ticker: "HPG", score: 4 } } }]
  const result = await manager().start({ description: "chấm HPG", prompt: "Chấm điểm HPG", schema: SCORE }).done
  expect(result.data).toEqual({ ticker: "HPG", score: 4 })
  expect(bodies).toHaveLength(2)
  expect(bodies[1]!.messages.some((m) => m.role === "tool")).toBe(true)
})

test("prose instead of the tool: reminder turns, then failed as invalid-output after the cap", async () => {
  replies = [{ text: "FPT khoảng 7 điểm." }]
  const result = await manager().start({ description: "chấm FPT", prompt: "Chấm điểm FPT", schema: SCORE, maxSteps: 1 }).done
  expect(result.status).toBe("failed")
  expect(result.failure).toBe("invalid-output")
  expect(result.data).toBeUndefined()
  expect(bodies).toHaveLength(MAX_RESULT_ATTEMPTS)
  // The reminder turn's request carries the reminder, then the forced last-step prompt.
  expect(JSON.stringify(bodies[1]!.messages)).toContain(RESULT_REMINDER.slice(0, 20))
  expect(lastUser(bodies[1]!)).toContain(RESULT_TOOL)
})

test("a reminder turn has one step, forced from its first request, and can still succeed", async () => {
  replies = [{ text: "để tôi nghĩ" }, { call: { name: RESULT_TOOL, args: { ticker: "VNM", score: 6 } } }]
  const result = await manager().start({ description: "chấm VNM", prompt: "Chấm điểm VNM", schema: SCORE, maxSteps: 6 }).done
  expect(result.status).toBe("completed")
  expect(result.data).toEqual({ ticker: "VNM", score: 6 })
  expect(bodies).toHaveLength(2)
  expect(bodies[0]!.tool_choice).not.toEqual({ type: "function", function: { name: RESULT_TOOL } })
  expect(bodies[1]!.tool_choice).toEqual({ type: "function", function: { name: RESULT_TOOL } })
})

test("an invalid forced call is never followed by a tools-off retry (it could not bring data)", async () => {
  replies = [{ call: { name: RESULT_TOOL, args: { ticker: "SSI", score: 99 } } }]
  const result = await manager().start({ description: "chấm SSI", prompt: "Chấm điểm SSI", schema: SCORE, maxSteps: 1 }).done
  expect(result.failure).toBe("invalid-output")
  expect(bodies.some((b) => b.tool_choice === "none")).toBe(false)
  // At most maxSteps + MAX_RESULT_ATTEMPTS - 1 requests.
  expect(bodies.length).toBeLessThanOrEqual(1 + MAX_RESULT_ATTEMPTS - 1)
})

test("failure kinds: a daily quota is told apart from other errors", async () => {
  replies = [{ status: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 500 PerDay" }]
  const quota = await manager().start({ description: "x", prompt: "x", schema: SCORE }).done
  expect(quota.status).toBe("failed")
  expect(quota.failure).toBe("daily-quota")

  replies = [{ status: 400, message: "bad request" }]
  const bad = await manager().start({ description: "y", prompt: "y" }).done
  expect(bad.failure).toBe("fatal")
})

test("a run without a schema has no result tool and no data", async () => {
  replies = [{ text: "Báo cáo." }]
  const result = await manager().start({ description: "z", prompt: "z" }).done
  expect(result.status).toBe("completed")
  expect(result.data).toBeUndefined()
  expect(bodies[0]!.tools?.map((t) => t.function.name) ?? []).not.toContain(RESULT_TOOL)
})

test("a schema with a transform: the SDK's parsed output is the data, transformed once (review #118)", async () => {
  const schema = z.object({ score: z.string().transform(Number), label: z.string().transform((s) => `[${s}]`) })
  replies = [{ call: { name: RESULT_TOOL, args: { score: "7", label: "FPT" } } }]
  const result = await manager().start({ description: "chấm", prompt: "Chấm", schema }).done
  expect(result.status).toBe("completed")
  // A second parse would reject the number, or wrap the label twice ("[[FPT]]").
  expect(result.data).toEqual({ score: 7, label: "[FPT]" })
})

test("tra_ket_qua is kept under the provider's tool cap, ahead of every other tool (review #118)", async () => {
  await saveConfig({ provider: "groq", model: "tooly", toolSearch: "off" })
  try {
    const registry = new ToolRegistry()
    registry.register(currentTimeTool(() => new Date("2026-10-21T02:30:00Z")))
    for (let i = 0; i < 140; i++) {
      registry.register({ name: `mcp__big__t${String(i).padStart(3, "0")}`, description: "dữ liệu", input: z.object({}), readOnly: true, source: "mcp:big", priority: 0, async execute() { return "x" } })
    }
    replies = [{ call: { name: RESULT_TOOL, args: { ticker: "FPT", score: 7 } } }]
    const result = await new SubagentManager({ parent: registry, skills: () => [] }).start({ description: "chấm", prompt: "Chấm", schema: SCORE }).done
    const names = bodies[0]!.tools?.map((t) => t.function.name) ?? []
    expect(names.length).toBeLessThanOrEqual(128)
    expect(names).toContain(RESULT_TOOL)
    expect(result.data).toEqual({ ticker: "FPT", score: 7 })
  } finally {
    await saveConfig({ toolSearch: undefined })
  }
})

test("a continued schema run must produce its own result, never return the previous one (review #118)", async () => {
  const m = manager()
  replies = [{ call: { name: RESULT_TOOL, args: { ticker: "FPT", score: 7 } } }]
  const run = m.start({ description: "chấm", prompt: "Chấm FPT", schema: SCORE, maxSteps: 1 })
  expect((await run.done).data).toEqual({ ticker: "FPT", score: 7 })
  // The continuation answers in prose only: no data, not the stale FPT result.
  bodies.length = 0
  replies = [{ text: "Không chấm thêm." }]
  expect(await m.continue(run.id, "Chấm lại với dữ liệu mới", () => ({}))).toBe("resumed")
  // continue() resumes the same run object: its `done` is the continuation's.
  const result = await run.done
  expect(result.data).toBeUndefined()
  expect(result.failure).toBe("invalid-output")
})

test("an agent restored from its sidechain keeps its desk run id (review #118)", async () => {
  const sessionDir = path.join(home, "sessions", "2026", "10", "s-desk")
  const first = manager()
  first.attachSession({ id: "s-desk", dir: sessionDir })
  replies = [{ text: "Báo cáo." }]
  const run = first.start({ description: "tra cứu", prompt: "Tra FPT", deskRunId: "dk-keep01" })
  await run.done
  await first.flush()
  // A new manager (a resumed session): the agent is rebuilt from disk.
  const second = manager()
  second.attachSession({ id: "s-desk", dir: sessionDir })
  replies = [{ text: "Thêm." }]
  await second.continue(run.id, "Thêm", () => ({}))
  expect(second.get(run.id)?.deskRunId).toBe("dk-keep01")
  await second.flush()
})
