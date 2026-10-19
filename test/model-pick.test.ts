import { expect, test } from "bun:test"
import type { Catalog, CatalogModel } from "../src/core/catalog"
import { pickAutoModel } from "../src/core/subagents/model-pick"

const text = { input: ["text"], output: ["text"] }
const model = (id: string, context = 200_000, release_date?: string): CatalogModel => ({ id, name: id, tool_call: true, modalities: text, limit: { context }, release_date })
const provider = (id: string, npm: string, models: CatalogModel[]) => ({
  id,
  name: id,
  env: [],
  npm,
  models: Object.fromEntries(models.map((m) => [m.id, m])),
})

test("with google connected it picks gemini-3.5-flash-lite", () => {
  const catalog: Catalog = {
    google: provider("google", "@ai-sdk/google", [model("gemini-3.5-flash-lite"), model("gemini-2.5-flash")]),
    nvidia: provider("nvidia", "@ai-sdk/openai-compatible", [model("deepseek-ai/deepseek-v4.1-flash")]),
  }
  expect(pickAutoModel(catalog, ["nvidia", "google"])).toEqual({ provider: "google", model: "gemini-3.5-flash-lite" })
})

test("without google, a connected groq gives llama instant", () => {
  const catalog: Catalog = {
    groq: provider("groq", "@ai-sdk/groq", [model("llama-3.1-8b-instant"), model("qwen/qwen3.6-27b")]),
  }
  expect(pickAutoModel(catalog, ["groq"])).toEqual({ provider: "groq", model: "llama-3.1-8b-instant" })
})

test("no candidate gives undefined", () => {
  const catalog: Catalog = {
    groq: provider("groq", "@ai-sdk/groq", [model("llama-3.1-8b-instant")]),
  }
  expect(pickAutoModel(catalog, ["khong-ket-noi"])).toBeUndefined()
  expect(pickAutoModel({}, ["google"])).toBeUndefined()
})

test("restrictTo looks at that provider only", () => {
  const catalog: Catalog = {
    google: provider("google", "@ai-sdk/google", [model("gemini-3.5-flash-lite")]),
    alibaba: provider("alibaba", "@ai-sdk/alibaba", [model("qwen3.7-flash")]),
  }
  expect(pickAutoModel(catalog, ["google", "alibaba"], "alibaba")).toEqual({ provider: "alibaba", model: "qwen3.7-flash" })
})

test("models without tool calls or under 64k context are skipped", () => {
  const catalog: Catalog = {
    google: provider("google", "@ai-sdk/google", [
      model("gemini-3.5-flash-lite", 32_000),
      { ...model("gemini-3.1-flash-lite"), tool_call: false },
    ]),
  }
  expect(pickAutoModel(catalog, ["google"])).toBeUndefined()
})

test("among a pattern's matches the newest release wins, not the first by name", () => {
  const catalog: Catalog = {
    anthropic: provider("anthropic", "@ai-sdk/anthropic", [model("claude-haiku-4-5", 200_000, "2025-10-15"), model("claude-haiku-5-5", 200_000, "2026-10-07")]),
    openai: provider("openai", "@ai-sdk/openai", [model("gpt-4.1-mini", 200_000, "2025-04-14"), model("gpt-5-mini", 200_000, "2025-08-07")]),
  }
  expect(pickAutoModel(catalog, ["anthropic"])).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" })
  expect(pickAutoModel(catalog, ["openai"])).toEqual({ provider: "openai", model: "gpt-5-mini" })
  // A haiku without the exact id still resolves to the newest one.
  delete catalog.anthropic!.models["claude-haiku-5-5"]
  catalog.anthropic!.models["claude-haiku-4-0"] = model("claude-haiku-4-0", 200_000, "2025-05-01")
  expect(pickAutoModel(catalog, ["anthropic"])).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" })
})
