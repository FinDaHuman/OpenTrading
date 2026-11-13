import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { generateText } from "ai"
import { z } from "zod"

const home = await mkdtemp(path.join(os.tmpdir(), "ot-ocgo-"))
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"
process.env.OPENCODE_API_KEY = "test-key"
process.env.GROQ_API_KEY = "test-key"

const { setConversation, childConversation, conversationId } = await import("../src/core/conversation")
const { languageModel, USER_AGENT } = await import("../src/core/providers")
const { resolveTarget } = await import("../src/core/chat")
const { runAgent } = await import("../src/core/agent")
const { initRuntime } = await import("../src/core/runtime")
const { parseQuestions, runEval } = await import("../scripts/eval/runner")
const { nativeSearch } = await import("../src/core/tools/web/side-model")
const { onModelRequest } = await import("../src/core/requests")
type CatalogProvider = import("../src/core/catalog").CatalogProvider

const MODEL = { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", tool_call: true, modalities: { input: ["text"], output: ["text"] } }
const GO = "https://opencode.ai/inference/go/openai/v1"
const CATALOG = {
  "opencode-go": { id: "opencode-go", name: "OpenCode Go", env: ["OPENCODE_API_KEY"], npm: "@ai-sdk/openai-compatible", api: GO, models: { [MODEL.id]: MODEL } },
  groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], npm: "@ai-sdk/groq", models: { tooly: { ...MODEL, id: "tooly" } } },
}

type Sent = { url: string; ua: string | null; session: string | null; stream: boolean; tool: boolean }
const sent: Sent[] = []
const sse = (chunks: object[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
const chunk = (delta: object, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: MODEL.id, choices: [{ index: 0, delta, finish_reason: finish }] })

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  const headers = new Headers(init?.headers)
  const body = JSON.parse(String(init?.body)) as { stream?: boolean; messages: { role: string }[] }
  const tool = body.messages.some((m) => m.role === "tool")
  sent.push({ url, ua: headers.get("user-agent"), session: headers.get("x-opencode-session"), stream: body.stream === true, tool })
  if (!body.stream) return Response.json({ id: "c", model: MODEL.id, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] })
  if (tool || !url.includes("opencode")) return sse([chunk({ role: "assistant", content: "Giá là 64,27." }), chunk({}, "stop")])
  return sse([
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${sent.length}`, type: "function", function: { name: "fake_quote", arguments: "{}" } }] }),
    chunk({}, "tool_calls"),
  ])
}) as typeof fetch

afterAll(async () => {
  globalThis.fetch = realFetch
  setConversation(undefined)
  await rm(home, { recursive: true, force: true })
})

beforeEach(async () => {
  sent.length = 0
  setConversation(undefined)
  await writeFile(path.join(home, "config.json"), JSON.stringify({ provider: "opencode-go", model: MODEL.id }))
})

const provider = (id: string, npm: string, api?: string) => ({ id, name: id, env: [], npm, ...(api ? { api } : {}), models: {} }) as unknown as CatalogProvider
const ask = (p: CatalogProvider, conversation?: string) => generateText({ model: languageModel(p, MODEL.id, "k", { conversation }), prompt: "x", maxRetries: 0 })

test("OpenCode gets our own user agent and the current conversation, read at request time", async () => {
  expect(USER_AGENT).toMatch(/^opentrading\/\d+\.\d+\.\d+ \(\w+ \w+\)$/)
  const go = provider("opencode-go", "@ai-sdk/openai-compatible", GO)
  const model = languageModel(go, MODEL.id, "k")
  setConversation("20261108-101500-ab12")
  await generateText({ model, prompt: "x", maxRetries: 0 })
  // The same model object, a later conversation: the header follows the conversation.
  setConversation("20261108-120000-cd34")
  await generateText({ model, prompt: "x", maxRetries: 0 })
  expect(sent.map((s) => [s.ua, s.session])).toEqual([
    [USER_AGENT, "20261108-101500-ab12"],
    [USER_AGENT, "20261108-120000-cd34"],
  ])
})

test("a subagent's own id wins; no conversation sends no session header; other hosts get neither", async () => {
  setConversation("s1")
  await ask(provider("opencode-go", "@ai-sdk/openai-compatible", GO), childConversation("s1", "ag-k3x9q0"))
  setConversation(undefined)
  await ask(provider("opencode", "@ai-sdk/openai-compatible", "https://opencode.ai/inference/openai/v1"))
  setConversation("s1")
  await ask(provider("groq", "@ai-sdk/groq"))
  await ask(provider("lookalike", "@ai-sdk/openai-compatible", "https://opencode.ai.evil.example/v1"))
  expect(sent[0]!.session).toBe("s1/ag-k3x9q0")
  expect(sent[1]).toMatchObject({ ua: USER_AGENT, session: null })
  for (const other of sent.slice(2)) {
    expect(other.session).toBeNull()
    expect(other.ua).not.toBe(USER_AGENT)
  }
  expect(childConversation(undefined, "ag-1")).toBe("session/ag-1")
})

test("the agent loop sends a run's conversationId on every step", async () => {
  const runtime = initRuntime({ home, cwd: home, skills: () => [] })
  runtime.registry.register({ name: "fake_quote", description: "Giá giả", input: z.object({}), readOnly: true, execute: async () => "64,27" })
  setConversation("main-session")
  for await (const _ of runAgent({ history: [], input: "Giá FPT?", skills: [], registry: runtime.registry, target: await resolveTarget(), role: "subagent", conversationId: "main-session/ag-1" })) {
    // drain
  }
  const chats = sent.filter((s) => s.stream)
  expect(chats.length).toBe(2)
  for (const chat of chats) expect(chat.session).toBe("main-session/ag-1")
})

test("each eval question is its own conversation", async () => {
  const runtime = initRuntime({ home, cwd: home, skills: () => [] })
  runtime.registry.register({ name: "fake_quote", description: "Giá giả", input: z.object({}), readOnly: true, execute: async () => "64,27" })
  const questions = parseQuestions(JSON.stringify(["q1", "q2"].map((id) => ({ id, group: "A", question: "Giá FPT?", now: "2026-03-10T10:00:00+07:00" }))))
  await runEval({ runtime, skills: [], target: await resolveTarget(), questions, write: () => {}, version: "0.0.0", conversationStamp: "t1" })
  const sessions = [...new Set(sent.filter((s) => s.stream).map((s) => s.session))]
  expect(sessions).toEqual(["eval-t1-q1#1", "eval-t1-q2#1"])
  expect(conversationId()).toBe("eval-t1-q2#1")
})

test("subagents and every conversation entry point set the id", async () => {
  // Guards against a path that would send OpenCode requests without a session: the TUI session,
  // `ot -p`, and the subagent manager's child runs.
  const src = (file: string) => readFile(path.join(import.meta.dir, "..", file), "utf8")
  expect(await src("src/tui/session.ts")).toContain("setConversation(current.id)")
  expect(await src("src/cli/print.ts")).toContain("setConversation(session.id)")
  expect(await src("src/core/subagents/manager.ts")).toContain("conversationId: childConversation(run.sessionId ?? conversationId(), run.id)")
})

test("native search on an OpenCode Anthropic model sends the headers and is counted", async () => {
  // Go serves claude-haiku-5-5 through its Anthropic endpoint; web_search builds that client itself.
  const models = { "claude-haiku-5-5": { ...MODEL, id: "claude-haiku-5-5", provider: { npm: "@ai-sdk/anthropic", api: "https://opencode.ai/inference/go/anthropic/v1" } } }
  const go = { id: "opencode-go", name: "OpenCode Go", env: [], npm: "@ai-sdk/openai-compatible", api: GO, models } as unknown as CatalogProvider
  const counted: string[] = []
  const stop = onModelRequest((r) => counted.push(`${r.provider}/${r.model}`))
  const seen: { session: string | null; ua: string | null }[] = []
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    seen.push({ session: headers.get("x-opencode-session"), ua: headers.get("user-agent") })
    return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "kết quả" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } })
  }) as typeof fetch
  setConversation("s-web")
  try {
    const found = await nativeSearch("giá FPT", { provider: go, model: "claude-haiku-5-5", apiKey: "k" }, {}, AbortSignal.timeout(5000))
    expect(found?.backend).toBe("anthropic-web-search")
  } finally {
    stop()
  }
  expect(seen).toEqual([{ session: "s-web", ua: USER_AGENT }])
  expect(counted).toEqual(["opencode-go/claude-haiku-5-5"])
})
