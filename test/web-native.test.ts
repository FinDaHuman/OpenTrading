import { afterAll, expect, test } from "bun:test"
import { nativeSearch, nativeSearchSetup } from "../src/core/tools/web/side-model"
import type { Target } from "../src/core/chat"

const realFetch = globalThis.fetch
const bodies: { url: string; body: Record<string, unknown> }[] = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  bodies.push({ url, body: JSON.parse(String(init?.body ?? "{}")) })
  return Response.json({
    candidates: [
      {
        content: { role: "model", parts: [{ text: "VCB báo lãi quý 3 tăng mạnh." }] },
        finishReason: "STOP",
        groundingMetadata: {
          webSearchQueries: ["VCB lợi nhuận quý 3"],
          groundingChunks: [{ web: { uri: "https://cafef.vn/vcb-q3.chn", title: "cafef.vn" } }, { web: { uri: "https://vneconomy.vn/vcb.htm", title: "vneconomy.vn" } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 },
  })
}) as typeof fetch

afterAll(() => {
  globalThis.fetch = realFetch
})

const target = (npm: string, baseURL?: string, model = "gemini-3.1-flash-lite"): Target => ({
  provider: { id: "p", name: "P", env: [], npm, ...(baseURL ? { api: baseURL } : {}), models: { [model]: { id: model, name: model } as never } },
  model,
  apiKey: "k",
})

test("Gemini: the side call sends only google_search and returns the grounding sources", async () => {
  const out = await nativeSearch("VCB lợi nhuận quý 3", target("@ai-sdk/google"), {}, new AbortController().signal)
  expect(out?.backend).toBe("gemini-grounding")
  expect(out?.text).toContain("VCB báo lãi")
  expect(out?.sources.map((s) => s.url)).toEqual(["https://cafef.vn/vcb-q3.chn", "https://vneconomy.vn/vcb.htm"])
  const sent = bodies.at(-1)!
  expect(sent.url).toContain("generativelanguage")
  expect(JSON.stringify(sent.body.tools)).toContain("googleSearch")
  expect(JSON.stringify(sent.body.tools)).not.toContain("functionDeclarations")
})

test("which providers get a native search: OpenAI only on its own API; others fall back to keyed search", () => {
  expect(nativeSearchSetup(target("@ai-sdk/anthropic"), { allowed: ["cafef.vn"] })?.backend).toBe("anthropic-web-search")
  expect(nativeSearchSetup(target("@ai-sdk/openai"), {})?.backend).toBe("openai-web-search")
  expect(nativeSearchSetup(target("@ai-sdk/openai", "https://proxy.example/v1"), {})).toBeUndefined()
  expect(nativeSearchSetup(target("@ai-sdk/openai"), { blocked: ["x.vn"] })).toBeUndefined()
  expect(nativeSearchSetup(target("@ai-sdk/groq"), {})).toBeUndefined()
})
