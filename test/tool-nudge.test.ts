import { expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { generateText, type LanguageModel, type ModelMessage } from "ai"
import { TOOL_NUDGE, nudgeAfterTools } from "../src/core/agent"
import type { CatalogProvider } from "../src/core/catalog"
import { languageModel, mergeGeminiTurns } from "../src/core/providers"

/** What a step after tool results looks like in each provider's request body (no network). */
const messages: ModelMessage[] = [
  { role: "user", content: "giá FPT" },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "quote", input: {} }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "quote", output: { type: "text", value: "98.5" } }] },
  { role: "user", content: TOOL_NUDGE },
]

async function body(make: (fetch: typeof globalThis.fetch) => LanguageModel) {
  let sent = ""
  const spy = (async (_url: unknown, init?: RequestInit) => {
    sent = String(init?.body)
    throw new Error("captured")
  }) as unknown as typeof globalThis.fetch
  await generateText({ model: make(spy), messages, maxRetries: 0 }).catch(() => {})
  return JSON.parse(sent)
}

test("anthropic: the nudge joins the tool results in one user turn", async () => {
  const sent = await body((fetch) => createAnthropic({ apiKey: "x", fetch })("claude-sonnet-4-5"))
  const roles = sent.messages.map((m: { role: string }) => m.role)
  expect(roles).toEqual(["user", "assistant", "user"])
  const last = sent.messages.at(-1).content.map((p: { type: string }) => p.type)
  expect(last).toEqual(["tool_result", "text"])
})

test("google: the nudge is merged into the function-response turn, so turns alternate", async () => {
  const realFetch = globalThis.fetch
  let sent: { contents: { role: string; parts: Record<string, unknown>[] }[] } | undefined
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    throw new Error("captured")
  }) as unknown as typeof fetch
  try {
    const provider = { id: "google", name: "Google", env: [], npm: "@ai-sdk/google", models: { "gemini-3-flash-preview": { id: "gemini-3-flash-preview", name: "g" } } }
    const model = languageModel(provider as unknown as CatalogProvider, "gemini-3-flash-preview", "x")
    await generateText({ model, messages, maxRetries: 0 }).catch(() => {})
  } finally {
    globalThis.fetch = realFetch
  }
  const turns = sent!.contents.map((c) => [c.role, ...c.parts.map((p) => Object.keys(p)[0])])
  expect(turns).toEqual([
    ["user", "text"],
    ["model", "functionCall"],
    ["user", "functionResponse", "text"],
  ])
})

test("mergeGeminiTurns only joins neighbours with the same role", () => {
  const merged = mergeGeminiTurns([
    { role: "user", parts: [{ text: "a" }] },
    { role: "user", parts: [{ text: "b" }] },
    { role: "model", parts: [{ text: "c" }] },
    { role: "user", parts: [{ text: "d" }] },
  ])
  expect(merged.map((c) => [c.role, c.parts!.length])).toEqual([
    ["user", 2],
    ["model", 1],
    ["user", 1],
  ])
})

test("the nudge is sent only on routes whose request shape was checked", () => {
  const target = (npm: string, api?: string) => ({ provider: { npm, api, models: { m: {} } }, model: "m" })
  expect(nudgeAfterTools(target("@ai-sdk/anthropic"))).toBe(true)
  expect(nudgeAfterTools(target("@ai-sdk/google"))).toBe(true)
  expect(nudgeAfterTools(target("@ai-sdk/openai"))).toBe(true)
  expect(nudgeAfterTools(target("@ai-sdk/mistral"))).toBe(false)
  expect(nudgeAfterTools(target("@ai-sdk/openai", "https://x.test/v1"))).toBe(false)
  expect(nudgeAfterTools(target("@ai-sdk/openai-compatible", "https://x.test/v1"))).toBe(false)
  expect(nudgeAfterTools(undefined)).toBe(false)
})
