import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-eval-"))
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"
process.env.GROQ_API_KEY = "test-key"

const { resolveTarget } = await import("../src/core/chat")
const { initRuntime } = await import("../src/core/runtime")
const { rememberResult, recallResult } = await import("../src/core/tools/refs")
const { parseQuestions, prepareHome, runEval } = await import("../scripts/eval/runner")
const { TRACE_VERSION } = await import("../scripts/eval/trace")
type TraceEvent = import("../scripts/eval/trace").TraceEvent

const CATALOG = {
  groq: {
    id: "groq",
    name: "Groq",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/groq",
    models: { tooly: { id: "tooly", name: "Tooly", tool_call: true, modalities: { input: ["text"], output: ["text"] } } },
  },
}

type Body = { stream?: boolean; messages: { role: string; content?: unknown }[]; tools?: { function: { name: string } }[] }
const bodies: Body[] = []
/** Streamed requests fail with this status instead of answering. */
let failStatus: number | undefined

const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
const chunk = (delta: object, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: "tooly", choices: [{ index: 0, delta, finish_reason: finish }] })

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  const body = JSON.parse(String(init?.body)) as Body
  bodies.push(body)
  if (failStatus) return Response.json({ error: { message: "bad request" } }, { status: failStatus })
  if (body.messages.some((m) => m.role === "tool")) return sse([chunk({ role: "assistant", content: "Giá là 64,27." }), chunk({}, "stop")])
  return sse([
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${bodies.length}`, type: "function", function: { name: "fake_quote", arguments: "" } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }),
    chunk({}, "tool_calls"),
  ])
}) as typeof fetch

afterAll(async () => {
  globalThis.fetch = realFetch
  await rm(home, { recursive: true, force: true })
})

beforeEach(() => {
  bodies.length = 0
  failStatus = undefined
})

const LONG = "x".repeat(40_000)

async function run(questions: ReturnType<typeof parseQuestions>, repeat = 1) {
  const runtime = initRuntime({ home, cwd: home, skills: () => [] })
  runtime.registry.register({
    name: "fake_quote",
    description: "Giá giả",
    input: z.object({}),
    readOnly: true,
    execute: async () => {
      rememberResult("fake_quote", "[1,2,3]")
      return LONG
    },
  })
  const events: TraceEvent[] = []
  const target = await resolveTarget({ provider: "groq", model: "tooly" })
  await runEval({ runtime, skills: [], target, questions, repeat, write: (e) => events.push(e), version: "0.0.0" })
  return { events, runtime }
}

const question = (id: string, group: "A" | "F" = "A") => ({ id, group, question: "Giá FPT?", now: "2026-03-10T10:00:00+07:00" })
const of = <T extends TraceEvent["type"]>(events: TraceEvent[], type: T) => events.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type)

test("the trace holds what the model saw and what the tool really returned", async () => {
  const { events } = await run([question("q1")])
  const [header] = of(events, "run")
  expect(header).toMatchObject({ trace_version: TRACE_VERSION, harness: "opentrading", provider: "groq", model: "tooly" })
  const [call] = of(events, "tool_call")
  const [visible] = of(events, "tool_result")
  const [raw] = of(events, "tool_raw")
  expect(call).toMatchObject({ q: "q1", rep: 1, tool: "fake_quote", step: 1 })
  expect(raw!.call_id).toBe(call!.call_id)
  expect(raw!.raw).toBe(LONG)
  expect(visible!.visible.length).toBeLessThan(LONG.length)
  const [answer] = of(events, "answer")
  expect(answer).toMatchObject({ text: "Giá là 64,27.", outcome: "completed", model_steps: 2 })
})

test("every question runs at its own moment, for the prompt and for current_time", async () => {
  const { runtime } = await run([question("q1")])
  expect(JSON.stringify(bodies[0]!.messages)).toContain("10/03/2026")
  const time = await runtime.registry.get("current_time")!.execute({}, { signal: new AbortController().signal, callId: "c" })
  expect(String(typeof time === "string" ? time : time.output)).toContain("2026")
  expect(runtime.subagents.clock?.().toISOString()).toBe("2026-03-10T03:00:00.000Z")
})

test("web tools are offered only to long reports", async () => {
  await run([question("q1", "A"), question("q2", "F")])
  const names = (body: Body) => (body.tools ?? []).map((t) => t.function.name)
  expect(names(bodies[0]!)).not.toContain("web_search")
  expect(names(bodies.at(-1)!)).toContain("web_search")
})

test("questions share nothing: refs restart and each repeat is traced on its own", async () => {
  const { events } = await run([question("q1"), question("q2")], 2)
  expect(of(events, "answer").map((a) => `${a.q}#${a.rep}`)).toEqual(["q1#1", "q2#1", "q1#2", "q2#2"])
  expect(bodies.filter((b) => b.messages.filter((m) => m.role === "user").length > 2)).toEqual([])
  // Stored by the last question's tool, under that question's session.
  expect(recallResult("r1")?.session).toBe("q2#2")
})

test("a failed question is traced and the run goes on", async () => {
  failStatus = 400
  const { events } = await run([question("q1"), question("q2")])
  expect(of(events, "answer").map((a) => a.outcome)).toEqual(["failed", "failed"])
  expect(of(events, "error").length).toBeGreaterThan(0)
})

test("parseQuestions refuses a set the scorer could not trust", () => {
  const good = question("q1")
  expect(parseQuestions(JSON.stringify([good]))).toHaveLength(1)
  expect(() => parseQuestions(JSON.stringify([good, good]))).toThrow()
  expect(() => parseQuestions(JSON.stringify([{ ...good, now: "hôm nay" }]))).toThrow()
  expect(() => parseQuestions("[]")).toThrow()
})

test("prepareHome copies connections, not the user's profile, and pins the model", async () => {
  const from = await mkdtemp(path.join(os.tmpdir(), "ot-eval-from-"))
  const to = await mkdtemp(path.join(os.tmpdir(), "ot-eval-to-"))
  await writeFile(path.join(from, "auth.json"), "{}")
  await writeFile(path.join(from, "INVESTOR.md"), "hồ sơ riêng")
  await prepareHome(from, to, { provider: "groq", model: "tooly" })
  expect(await readFile(path.join(to, "auth.json"), "utf8")).toBe("{}")
  expect(await Bun.file(path.join(to, "INVESTOR.md")).exists()).toBe(false)
  expect(JSON.parse(await readFile(path.join(to, "config.json"), "utf8"))).toEqual({ provider: "groq", model: "tooly" })
  await rm(from, { recursive: true, force: true })
  await rm(to, { recursive: true, force: true })
})
