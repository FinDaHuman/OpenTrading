import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { APICallError, generateText } from "ai"
import { z } from "zod"

const home = await mkdtemp(path.join(os.tmpdir(), "ot-orpin-"))
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"
process.env.OPENROUTER_API_KEY = "test-key"
process.env.GROQ_API_KEY = "test-key"

const { routingFor, cleanRouting, describeRouting } = await import("../src/core/openrouter-routing")
const { describeError, resolveTarget } = await import("../src/core/chat")
const { languageModel } = await import("../src/core/providers")
const { initRuntime } = await import("../src/core/runtime")
const { parseQuestions, prepareHome, routingFromFlags, runEval, servedSummary } = await import("../scripts/eval/runner")
type CatalogProvider = import("../src/core/catalog").CatalogProvider
type TraceEvent = import("../scripts/eval/trace").TraceEvent

const MODEL = { id: "deepseek/deepseek-v4.1-flash-1017", name: "DeepSeek", tool_call: true, modalities: { input: ["text"], output: ["text"] } }
const CATALOG = {
  openrouter: { id: "openrouter", name: "OpenRouter", env: ["OPENROUTER_API_KEY"], npm: "@openrouter/ai-sdk-provider", api: "https://openrouter.ai/api/v1", models: { [MODEL.id]: MODEL, "google/gemini-x": { ...MODEL, id: "google/gemini-x" } } },
  groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], npm: "@ai-sdk/groq", models: { tooly: { ...MODEL, id: "tooly" } } },
}

type Body = { provider?: unknown; messages: { role: string }[] }
const bodies: Body[] = []
const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
// OpenRouter puts the upstream provider on every chunk.
const chunk = (delta: object, finish: string | null = null) => ({ id: "c", provider: "DeepSeek", object: "chat.completion.chunk", created: 1, model: MODEL.id, choices: [{ index: 0, delta, finish_reason: finish }] })

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  const body = JSON.parse(String(init?.body)) as Body
  bodies.push(body)
  if (!(body as { stream?: boolean }).stream) return Response.json({ id: "c", provider: "DeepSeek", model: MODEL.id, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] })
  if (body.messages.some((m) => m.role === "tool")) return sse([chunk({ role: "assistant", content: "Giá là 64,27." }), chunk({}, "stop")])
  return sse([
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${bodies.length}`, type: "function", function: { name: "fake_quote", arguments: "{}" } }] }),
    chunk({}, "tool_calls"),
  ])
}) as typeof fetch

afterAll(async () => {
  globalThis.fetch = realFetch
  await rm(home, { recursive: true, force: true })
})

beforeEach(async () => {
  bodies.length = 0
  await writeFile(path.join(home, "config.json"), "{}")
})

const PIN = { order: ["deepseek"], allow_fallbacks: false }

test("a model's own block wins over '*' key by key; wrong values are dropped", () => {
  const config = { openrouter: { routing: { "*": { quantizations: ["fp8"], allow_fallbacks: true, sort: "price" }, [MODEL.id]: PIN } } }
  expect(routingFor(config, MODEL.id)).toEqual({ quantizations: ["fp8"], allow_fallbacks: false, sort: "price", order: ["deepseek"] })
  expect(routingFor(config, "other/model")).toEqual({ quantizations: ["fp8"], allow_fallbacks: true, sort: "price" })
  expect(routingFor({}, MODEL.id)).toBeUndefined()
  expect(routingFor({ openrouter: { routing: { [MODEL.id]: { order: "deepseek", allow_fallbacks: "no", sort: "fast", only: [1, " novita "] } } } }, MODEL.id)).toEqual({ only: ["novita"] })
  expect(cleanRouting(null)).toEqual({})
  expect(cleanRouting({ max_price: { prompt: 1, completion: "x", image: Number.NaN } })).toEqual({ max_price: { prompt: 1, completion: "x" } })
  expect(describeRouting({ order: ["deepseek"], allow_fallbacks: false, quantizations: ["fp8"] })).toBe("order deepseek · không fallback · fp8")
  expect(describeRouting(undefined)).toBe("không ghim")
})

const provider = (id: string, npm: string, api?: string) => ({ id, name: id, env: [], npm, ...(api ? { api } : {}), models: {} }) as unknown as CatalogProvider

test("the pin reaches OpenRouter's request body, and only OpenRouter's", async () => {
  const send = (p: CatalogProvider, routing?: typeof PIN) => generateText({ model: languageModel(p, MODEL.id, "k", { routing }), prompt: "x", maxRetries: 0 })
  await send(provider("openrouter", "@openrouter/ai-sdk-provider", "https://openrouter.ai/api/v1"), PIN)
  expect(bodies.at(-1)!.provider).toEqual(PIN)
  // No pin: no `provider` key at all, OpenRouter's defaults apply.
  await send(provider("openrouter", "@openrouter/ai-sdk-provider", "https://openrouter.ai/api/v1"))
  expect(bodies.at(-1)!.provider).toBeUndefined()
  // A gateway that reuses the OpenRouter SDK does not get OpenRouter's routing.
  await send(provider("standardcompute", "@openrouter/ai-sdk-provider", "https://api.standardcompute.example/v1"), PIN)
  expect(bodies.at(-1)!.provider).toBeUndefined()
})

test("resolveTarget pins the model finally chosen, for OpenRouter only", async () => {
  await writeFile(path.join(home, "config.json"), JSON.stringify({ provider: "openrouter", model: MODEL.id, openrouter: { routing: { [MODEL.id]: PIN } } }))
  expect((await resolveTarget()).routing).toEqual(PIN)
  // A subagent override to another OpenRouter model gets that model's routing (none here).
  expect((await resolveTarget({ model: "google/gemini-x" })).routing).toBeUndefined()
  expect((await resolveTarget({ provider: "groq", model: "tooly" })).routing).toBeUndefined()
})

test("every model call site passes the target's routing", async () => {
  // A call site that forgets it would send that request unpinned: main agent, auto-mode reviewer, title, web side calls.
  const root = path.join(import.meta.dir, "..", "src")
  const files = (await readdir(root, { recursive: true })).filter((f) => /\.tsx?$/.test(f))
  const calls: string[] = []
  for (const file of files) {
    const text = await readFile(path.join(root, file), "utf8")
    for (const match of text.matchAll(/languageModel\(([^)]*)\)/g)) if (!file.endsWith("providers.ts")) calls.push(`${file}: ${match[1]}`)
  }
  expect(calls.length).toBeGreaterThanOrEqual(4)
  for (const call of calls) expect(call).toContain("routing:")
})

test("an eval run sends the pin on every request and records who answered", async () => {
  await writeFile(path.join(home, "config.json"), JSON.stringify({ provider: "openrouter", model: MODEL.id, openrouter: { routing: { [MODEL.id]: PIN } } }))
  const runtime = initRuntime({ home, cwd: home, skills: () => [] })
  runtime.registry.register({ name: "fake_quote", description: "Giá giả", input: z.object({}), readOnly: true, execute: async () => "64,27" })
  const events: TraceEvent[] = []
  const target = await resolveTarget()
  const question = { id: "q1", group: "A", question: "Giá FPT?", now: "2026-03-10T10:00:00+07:00" }
  await runEval({ runtime, skills: [], target, questions: parseQuestions(JSON.stringify([question])), write: (e) => events.push(e), version: "0.0.0" })
  const chats = bodies.filter((b) => (b as { stream?: boolean }).stream)
  expect(chats.length).toBe(2)
  for (const body of chats) expect(body.provider).toEqual(PIN)
  const answer = events.find((e) => e.type === "answer")
  expect(answer).toMatchObject({ model_steps: 2, served_by: { DeepSeek: 2 } })
  expect(servedSummary([...events, ...events])).toEqual({ DeepSeek: 4 })
})

test("eval flags map one key each and refuse another provider", async () => {
  expect(routingFromFlags("openrouter", { orProvider: "deepseek, deepinfra/fp8", noFallback: true, quant: "fp8" })).toEqual({
    routing: { order: ["deepseek", "deepinfra/fp8"], quantizations: ["fp8"], allow_fallbacks: false },
    warnings: [],
  })
  expect(routingFromFlags("openrouter", { orProvider: "deepseek" }).warnings[0]).toContain("--or-no-fallback")
  const none = routingFromFlags("openrouter", {})
  expect(none.routing).toBeUndefined()
  expect(none.warnings[0]).toContain("--or-provider")
  expect(routingFromFlags("groq", { noFallback: true }).error).toContain("openrouter")
  expect(routingFromFlags("groq", {})).toEqual({ warnings: [] })
  // The run's home holds the pin from the flags, keyed by the measured model.
  const from = await mkdtemp(path.join(os.tmpdir(), "ot-orpin-from-"))
  const to = await mkdtemp(path.join(os.tmpdir(), "ot-orpin-to-"))
  await prepareHome(from, to, { provider: "openrouter", model: MODEL.id }, undefined, PIN)
  expect(JSON.parse(await readFile(path.join(to, "config.json"), "utf8"))).toEqual({ provider: "openrouter", model: MODEL.id, openrouter: { routing: { [MODEL.id]: PIN } } })
  await Promise.all([rm(from, { recursive: true, force: true }), rm(to, { recursive: true, force: true })])
})

test("OpenRouter's 'no provider' error reads in Vietnamese and points at the pin, whatever the status", () => {
  for (const [status, message] of [
    [404, "No allowed providers are available for the selected model."],
    [503, "No endpoints found matching your data policy"],
  ] as const) {
    const error = new APICallError({ message, url: "https://openrouter.ai/api/v1/chat/completions", requestBodyValues: {}, statusCode: status, responseBody: "{}" })
    const text = describeError(error)
    expect(text).toStartWith(`OpenRouter không có provider nào phục vụ được request này (${status}): ${message.replace(/\.$/, "")}.`)
    expect(text).toContain("openrouter.routing")
  }
})

test("OpenRouter's routing funnel keeps why the pinned provider was dropped, with long lists counted", () => {
  // Shape of a real 404 (08/11, pin order deepseek, no fallback); the fallback list is trimmed here.
  const fallback = Array.from({ length: 45 }, (_, i) => `p${i}/fp8`).join(", ")
  const message = `No endpoints found for deepseek/deepseek-v4.1-flash-1017. Every candidate endpoint was removed during routing: Filter by Tier Endpoint Rows removed particle-ai/us/flex, deepinfra/fp8/flex, fireworks/ultrafast (Excluded tier endpoint rows the request did not opt into); Filter by Guardrails removed deepseek (Paid model training violation (account settings)); Filter by Fallback removed ${fallback}.`
  const error = new APICallError({ message, url: "https://openrouter.ai/api/v1/chat/completions", requestBodyValues: {}, statusCode: 404, responseBody: "{}" })
  const text = describeError(error)
  expect(text).toContain("No endpoints found for deepseek/deepseek-v4.1-flash-1017. ")
  expect(text).toContain("Guardrails loại deepseek (Paid model training violation (account settings))")
  expect(text).toContain("Fallback loại 45 provider")
  expect(text).not.toContain("p44/fp8")
  expect(text).toContain("openrouter.ai/settings/privacy")
  expect(text).toContain("openrouter.routing")
  // Without a funnel the provider's words stay as they were, and no account hint is added.
  const plain = describeError(new APICallError({ message: "No allowed providers are available for the selected model.", url: "https://openrouter.ai/api/v1/chat/completions", requestBodyValues: {}, statusCode: 404, responseBody: "{}" }))
  expect(plain).not.toContain("settings/privacy")
})
