import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { tempDirs } from "./helpers/temp"
import { chunkFor, sse } from "./helpers/chat"

const temp = tempDirs()

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-eval-"))
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"
process.env.GROQ_API_KEY = "test-key"

const { resolveTarget } = await import("../src/core/chat")
const { initRuntime } = await import("../src/core/runtime")
const { rememberResult, recallResult } = await import("../src/core/tools/refs")
const { parseAblations, parseQuestions, prepareHome, runEval, skillsFor } = await import("../scripts/eval/runner")
const { TRACE_VERSION } = await import("../scripts/eval/trace")
const { ledgerFile, RequestLedger, spentToday } = await import("../scripts/eval/ledger")
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
/** The first answer invents figures with no tool call, so the stop gate sends it back. */
let invent = false
/** Requests get no answer until they are aborted. */
let hang = false
/** Streamed requests fail with 429 this many times, then work. */
let failFirst = 0

const chunk = chunkFor("tooly")

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  const body = JSON.parse(String(init?.body)) as Body
  bodies.push(body)
  if (hang) {
    await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))
  }
  if (failStatus) return Response.json({ error: { message: "bad request" } }, { status: failStatus })
  if (failFirst > 0) {
    failFirst--
    return Response.json({ error: { message: "rate limited" } }, { status: 429 })
  }
  if (invent) {
    const first = bodies.length === 1
    return sse([chunk({ role: "assistant", content: first ? INVENTED : "Không có dữ liệu." }), chunk({}, "stop")])
  }
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
  invent = false
  failFirst = 0
  hang = false
})

const LONG = "x".repeat(40_000)
const INVENTED = "Tôi đã lấy dữ liệu. P/E 12,3 lần, ROE 24,1%.\nNguồn: financial_ratios"

async function run(questions: ReturnType<typeof parseQuestions>, repeat = 1, ledger?: import("../scripts/eval/ledger").RequestLedger, ablated?: import("../scripts/eval/runner").Ablated, timeoutMs?: number) {
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
  await runEval({ runtime, skills: [], target, questions, repeat, write: (e) => events.push(e), version: "0.0.0", ledger, timeoutMs, ablated })
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

test("every tool_raw belongs to the question that made the call", async () => {
  const { events } = await run([question("q1"), question("q2")], 2)
  const raws = of(events, "tool_raw")
  expect(raws.map((r) => `${r.q}#${r.rep}`)).toEqual(["q1#1", "q2#1", "q1#2", "q2#2"])
  const calls = of(events, "tool_call")
  for (const raw of raws) expect(calls.find((c) => c.call_id === raw.call_id)).toMatchObject({ q: raw.q, rep: raw.rep })
})

test("the answer is what the harness kept, and the thrown-away draft stays visible apart", async () => {
  invent = true
  const { events } = await run([question("q1")])
  const [answer] = of(events, "answer")
  expect(answer!.recoveries.map((r) => r.kind)).toEqual(["unfetched"])
  expect(answer!.text).toBe("Không có dữ liệu.")
  expect(answer!.streamed).toContain("12,3")
})

test("requests count retries, which model steps do not", async () => {
  failFirst = 1
  const { events } = await run([question("q1")])
  const [answer] = of(events, "answer")
  expect(answer).toMatchObject({ model_steps: 2, requests: 3 })
  expect(answer!.requests).toBe(bodies.length)
})

test("the ledger adds up across runs and the cap stops the run before the next question", async () => {
  const file = ledgerFile(await temp.make("ot-eval-usage-"))
  await run([question("q1")], 1, await RequestLedger.open(file, "groq/tooly", 100))
  expect(await spentToday(file, "groq/tooly")).toBe(2)
  const { events } = await run([question("q2"), question("q3")], 1, await RequestLedger.open(file, "groq/tooly", 4))
  expect(of(events, "answer").map((a) => a.q)).toEqual(["q2"])
  expect(of(events, "stopped")).toEqual([{ type: "stopped", reason: "request-cap", spent: 4, cap: 4 }])
  expect(await spentToday(file, "groq/tooly")).toBe(4)
})

test("reaching the cap mid-question aborts it, and the requests still reach the ledger", async () => {
  const file = ledgerFile(await temp.make("ot-eval-usage-"))
  const { events } = await run([question("q1")], 1, await RequestLedger.open(file, "groq/tooly", 1))
  const [answer] = of(events, "answer")
  expect(answer).toMatchObject({ outcome: "aborted", abort: "cap" })
  expect(await spentToday(file, "groq/tooly")).toBe(1)
})

test("a side model on another provider does not spend the cap, and is booked apart", async () => {
  const file = ledgerFile(await temp.make("ot-eval-usage-"))
  const ledger = await RequestLedger.open(file, "groq/tooly", 1)
  ledger.note("google/side")
  expect(ledger.exhausted).toBe(false)
  await ledger.flush()
  expect(await spentToday(file, "google/side")).toBe(1)
  expect(await spentToday(file, "groq/tooly")).toBe(0)
})

test("a timed-out question says so, apart from a cap", async () => {
  hang = true
  const { events } = await run([question("q1")], 1, undefined, undefined, 20)
  expect(of(events, "answer")[0]).toMatchObject({ outcome: "aborted", abort: "timeout" })
})

test("the gate goes back to refusing when the run ends", async () => {
  const { runtime } = await run([question("q1")])
  expect(runtime.permissions.interactive).toBe(false)
})

test("--yolo: a tool that would ask runs unanswered, and the header records the bypass mode", async () => {
  for (const yolo of [false, true]) {
    const runtime = initRuntime({ home, cwd: home, skills: () => [] })
    let ran = 0
    // Not read-only: without --yolo the unattended list refuses it.
    runtime.registry.register({ name: "fake_quote", description: "Giá giả", input: z.object({}), readOnly: false, permissionScope: "fake@1", execute: async () => (ran++, "64,27") })
    const events: TraceEvent[] = []
    const target = await resolveTarget({ provider: "groq", model: "tooly" })
    await runEval({ runtime, skills: [], target, questions: parseQuestions(JSON.stringify([question("q1")])), write: (e) => events.push(e), version: "0.0.0", yolo })
    expect(of(events, "run")[0]!.permission_mode).toBe(yolo ? "bypass" : "read-only")
    expect(ran).toBe(yolo ? 1 : 0)
    // The gate goes back to refusing when the run ends, --yolo or not.
    expect(runtime.permissions.mode).toBe("read-only")
    runtime.permissions.setMode("bypass")
    expect(runtime.permissions.mode).toBe("read-only")
  }
})

test("--memory notebook: each question gets an empty notebook (guide in the prompt, memory_read offered); none has neither", async () => {
  for (const memory of ["none", "notebook"] as const) {
    bodies.length = 0
    const runtime = initRuntime({ home, cwd: home, skills: () => [] })
    runtime.registry.register({ name: "fake_quote", description: "Giá giả", input: z.object({}), readOnly: true, execute: async () => "64,27" })
    const events: TraceEvent[] = []
    const target = await resolveTarget({ provider: "groq", model: "tooly" })
    const opened: string[] = []
    const questions = parseQuestions(JSON.stringify([question("q1"), question("q2")]))
    await runEval({ runtime, skills: [], target, questions, write: (e) => (e.type === "question" && opened.push(runtime.memory.id), events.push(e)), version: "0.0.0", memory })
    expect(of(events, "run")[0]!.memory).toBe(memory)
    const streamed = bodies.filter((b) => b.stream)
    const system = streamed.map((b) => JSON.stringify(b.messages.find((m) => m.role === "system")?.content ?? ""))
    const offered = streamed.map((b) => (b.tools ?? []).some((t) => t.function.name === "memory_read"))
    if (memory === "notebook") {
      expect(system.every((s) => s.includes("Sổ ghi nhớ là ghi chép"))).toBe(true)
      expect(offered.some(Boolean)).toBe(true)
    } else {
      expect(system.some((s) => s.includes("Sổ ghi nhớ là ghi chép"))).toBe(false)
      expect(offered.some(Boolean)).toBe(false)
    }
    expect(opened).toEqual([memory, memory])
  }
  // The home is shared by this file's tests: no notebook left behind for the constraints reader.
  for (const suffix of ["", "-wal", "-shm"]) await rm(path.join(home, `memory.db${suffix}`), { force: true })
})

test("a rule switched off stays off, notice included, and the rest still run", async () => {
  invent = true
  const { events } = await run([question("q1")], 1, undefined, parseAblations(["gate-unfetched"]))
  const [answer] = of(events, "answer")
  expect(answer!.recoveries).toEqual([])
  expect(answer!.text).toContain("12,3")
  expect(of(events, "notice")).toEqual([])
})

test("the nudge after tool results can go, alone or with only its todo part", async () => {
  const sent = () => JSON.stringify(bodies.at(-1)!.messages)
  await run([question("q1")])
  expect(sent()).toContain("Nếu còn cần dữ liệu, gọi cùng lúc")
  bodies.length = 0
  await run([question("q1")], 1, undefined, parseAblations(["tool-nudge"]))
  expect(sent()).not.toContain("Nếu còn cần dữ liệu, gọi cùng lúc")
})

test("setup ablations take their tools away and reach the config", async () => {
  const { runtime } = await run([question("q1")], 1, undefined, parseAblations(["todo", "skills"]))
  expect(runtime.registry.get("todo_write")).toBeUndefined()
  expect(runtime.registry.get("load_skill")).toBeUndefined()
  const to = await mkdtemp(path.join(os.tmpdir(), "ot-eval-to-"))
  await prepareHome(to, to, { provider: "groq", model: "tooly" }, parseAblations(["tool-deferral"]))
  expect(JSON.parse(await readFile(path.join(to, "config.json"), "utf8"))).toMatchObject({ toolSearch: "off" })
  await rm(to, { recursive: true, force: true })
})

test("without skills, the runtime that feeds subagents has none either", () => {
  const skills = [{ name: "a" }] as never[]
  expect(skillsFor(skills)).toBe(skills)
  expect(skillsFor(skills, parseAblations(["skills"]))).toEqual([])
})

test("a mistyped ablation stops the run instead of measuring the full harness", () => {
  expect(() => parseAblations(["gate-unfetchd"])).toThrow("gate-unfetchd")
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
