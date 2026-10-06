import { expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { generateText, type LanguageModel, type ModelMessage } from "ai"
import { toolSetOptions } from "../src/core/agent"

/**
 * Where does a tool-result image end up in each provider's request body? An image must sit
 * in its own field (a real image part). If the base64 is inside a text string, the provider
 * would read megabytes of characters — that combination must have images turned off.
 */
const B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

const history: ModelMessage[] = [
  { role: "user", content: "chụp" },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "shot", input: {} }] },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "shot",
        output: { type: "content", value: [{ type: "text", text: "đã chụp" }, { type: "image-data", data: B64, mediaType: "image/png" }] },
      },
    ],
  },
  { role: "user", content: "mô tả ảnh" },
]

async function placement(make: (fetch: typeof globalThis.fetch) => LanguageModel) {
  let body = ""
  const spy = (async (_url: unknown, init?: RequestInit) => {
    body = String(init?.body)
    throw new Error("captured")
  }) as unknown as typeof globalThis.fetch
  await generateText({ model: make(spy), messages: history, maxRetries: 0 }).catch(() => {})
  const found: ("field" | "text")[] = []
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      if (node === B64 || node === `data:image/png;base64,${B64}`) found.push("field")
      else if (node.includes(B64)) found.push("text")
    } else if (node && typeof node === "object") Object.values(node).forEach(walk)
  }
  walk(JSON.parse(body))
  return found
}

const vision = { modalities: { input: ["text", "image"] } }
const opts = (npm: string, model: string, api?: string) => toolSetOptions({ provider: { npm, api, models: { [model]: vision } }, model })

test("images are enabled exactly where the SDK sends them as real image parts", async () => {
  const cases: [string, ReturnType<typeof opts>, (f: typeof fetch) => LanguageModel][] = [
    ["anthropic", opts("@ai-sdk/anthropic", "claude-sonnet-4-5"), (fetch) => createAnthropic({ apiKey: "x", fetch })("claude-sonnet-4-5")],
    ["openai responses", opts("@ai-sdk/openai", "gpt-5"), (fetch) => createOpenAI({ apiKey: "x", fetch })("gpt-5")],
    [
      "openai-sdk chat (own base URL)",
      opts("@ai-sdk/openai", "gpt-4o", "https://x.test/v1"),
      (fetch) => createOpenAI({ apiKey: "x", fetch, baseURL: "https://x.test/v1" }).chat("gpt-4o"),
    ],
    ["gemini 3", opts("@ai-sdk/google", "gemini-3-flash-preview"), (fetch) => createGoogleGenerativeAI({ apiKey: "x", fetch })("gemini-3-flash-preview")],
  ]
  for (const [name, options, make] of cases) {
    const where = await placement(make)
    // Enabled ⇒ the SDK puts the image in a real field, never inside text.
    if (options.images) expect({ name, where }).toEqual({ name, where: ["field"] })
    else expect({ name, images: options.images, where }).toEqual({ name, images: false, where: ["text"] })
  }
})

test("unverified shapes stay off: Gemini 2.x, OpenAI-compatible, models without vision", () => {
  expect(opts("@ai-sdk/google", "gemini-2.5-flash-lite").images).toBe(false)
  expect(opts("@ai-sdk/openai-compatible", "nv/model", "https://integrate.api.nvidia.com/v1").images).toBe(false)
  expect(toolSetOptions({ provider: { npm: "@ai-sdk/anthropic", models: { c: { modalities: { input: ["text"] } } } }, model: "c" }).images).toBe(false)
})
