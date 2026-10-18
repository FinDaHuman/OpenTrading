import { afterAll, beforeEach, expect, test } from "bun:test"
import { streamText, wrapLanguageModel } from "ai"
import type { CatalogProvider } from "../src/core/catalog"
import { languageModel } from "../src/core/providers"
import { retryMiddleware, type RetryNotice } from "../src/core/retry"

/**
 * End to end through the real @ai-sdk/google adapter (fetch faked): a Gemini 429 must reach
 * the retry middleware as a rejected doStream with its body, and Esc must cut a real wait.
 * The 429 bodies follow Google's documented google.rpc details (no live capture exists).
 */

const GOOGLE: CatalogProvider = {
  id: "google",
  name: "Google",
  env: ["GEMINI_API_KEY"],
  npm: "@ai-sdk/google",
  models: { "gemini-test": { id: "gemini-test", name: "Gemini test", tool_call: true } },
}

const quota = (quotaId: string, retryDelay: string) =>
  Response.json(
    {
      error: {
        code: 429,
        message: "You exceeded your current quota, please check your plan and billing details.",
        status: "RESOURCE_EXHAUSTED",
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId, quotaValue: "15" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
        ],
      },
    },
    { status: 429 },
  )

const answer = () =>
  new Response(
    `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Xong." }] }, finishReason: "STOP" }] })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  )

let replies: (() => Response)[] = []
let requests = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init)
  requests++
  const next = replies.shift()
  if (!next) throw new Error("no reply scripted")
  return next()
}) as typeof fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

beforeEach(() => {
  replies = []
  requests = 0
  process.env.OPENTRADING_RETRY_SCALE = "0"
})

async function run(signal?: AbortSignal) {
  const notices: RetryNotice[] = []
  const model = wrapLanguageModel({
    model: languageModel(GOOGLE, "gemini-test", "key"),
    middleware: retryMiddleware({ onRetry: (n) => notices.push(n) }),
  })
  const result = streamText({ model, prompt: "x", maxRetries: 0, abortSignal: signal, onError: () => {} })
  let text = ""
  let error: unknown
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text
    if (part.type === "error") error = part.error
  }
  return { text, error, notices }
}

test("Gemini per-minute 429: retried after RetryInfo, then answers", async () => {
  const minute = () => quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "7s")
  replies = [minute, minute, answer]
  const { text, error, notices } = await run()
  expect(error).toBeUndefined()
  expect(text).toBe("Xong.")
  expect(requests).toBe(3)
  expect(notices.map((n) => [n.attempt, n.delayMs])).toEqual([
    [1, 7000],
    [2, 7000],
  ])
})

test("Gemini daily quota: one request, the error says the quota is gone", async () => {
  replies = [() => quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "16s")]
  const { error, notices } = await run()
  expect(requests).toBe(1)
  expect(notices).toEqual([])
  const { describeError } = await import("../src/core/chat")
  expect(describeError(error)).toContain("hết quota trong ngày")
})

test("Esc during a real wait ends the stream at once, without another request", async () => {
  process.env.OPENTRADING_RETRY_SCALE = "1"
  const overloaded = () => Response.json({ error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" } }, { status: 503 })
  replies = [overloaded, overloaded, overloaded]
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 50)
  const started = Date.now()
  await run(controller.signal).catch(() => undefined)
  expect(Date.now() - started).toBeLessThan(1000)
  expect(requests).toBe(1)
})
