import { afterEach, expect, test } from "bun:test"
import { generateText } from "ai"
import type { CatalogProvider } from "../src/core/catalog"
import { languageModel } from "../src/core/providers"
import { onModelRequest } from "../src/core/requests"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const provider = (id: string, npm: string, api?: string) => ({ id, name: id, env: [], npm, ...(api ? { api } : {}), models: {} }) as unknown as CatalogProvider

test("every provider request is reported, Gemini's merged turns still reach the wire", async () => {
  const seen: { provider: string; model: string }[] = []
  const stop = onModelRequest((request) => seen.push(request))
  let body: { contents: { role: string }[] } | undefined
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: {} })
  }) as typeof fetch
  await generateText({
    model: languageModel(provider("google", "@ai-sdk/google"), "gemini-x", "k"),
    messages: [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ],
    maxRetries: 0,
  })
  stop()
  expect(seen).toEqual([{ provider: "google", model: "gemini-x" }])
  expect(body!.contents.map((c) => c.role)).toEqual(["user"])
})

test("a stopped listener hears nothing more", async () => {
  const seen: unknown[] = []
  onModelRequest((request) => seen.push(request))()
  globalThis.fetch = (async () => Response.json({ error: { message: "no" } }, { status: 400 })) as unknown as typeof fetch
  await generateText({ model: languageModel(provider("groq", "@ai-sdk/groq"), "m", "k"), prompt: "x", maxRetries: 0 }).catch(() => {})
  expect(seen).toEqual([])
})
