import { afterEach, expect, test } from "bun:test"
import { generateText } from "ai"
import type { CatalogProvider } from "../src/core/catalog"
import { languageModel } from "../src/core/providers"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Headers of the one request a generateText call sends, answered with an empty completion. */
async function headersOf(provider: CatalogProvider, model: string) {
  let headers: Headers | undefined
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    headers = new Headers(init?.headers)
    const body = { id: "x", model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
  }) as typeof fetch
  await generateText({ model: languageModel(provider, model, "k"), prompt: "hi", maxRetries: 0 })
  return headers!
}

const provider = (id: string, api: string): CatalogProvider =>
  ({ id, name: id, npm: "@openrouter/ai-sdk-provider", api, env: [], models: { "a/b": { id: "a/b", name: "a/b" } } }) as unknown as CatalogProvider

test("OpenRouter requests carry the app attribution headers (32f: harness-only free models)", async () => {
  const h = await headersOf(provider("openrouter", "https://openrouter.ai/api/v1"), "a/b")
  expect(h.get("HTTP-Referer")).toBe("https://github.com/FinDaHuman/OpenTrading")
  expect(h.get("X-OpenRouter-Title")).toBe("OpenTrading")
  expect(h.get("X-Title")).toBe("OpenTrading")
  expect(h.get("X-OpenRouter-Categories")).toBe("cli-agent")
})

test("another gateway on the OpenRouter SDK gets none of them", async () => {
  const h = await headersOf(provider("standardcompute", "https://api.stdcmpt.com/v1"), "a/b")
  for (const name of ["HTTP-Referer", "X-OpenRouter-Title", "X-Title", "X-OpenRouter-Categories"]) expect(h.get(name)).toBeNull()
})
