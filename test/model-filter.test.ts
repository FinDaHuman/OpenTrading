import { expect, test } from "bun:test"
import type { CatalogModel, CatalogProvider } from "../src/core/catalog"
import { chatModels, isChatModel } from "../src/core/providers"

/**
 * Entries as models.dev lists them (Google/Groq/NVIDIA, 18/10/2026): ids, tool_call,
 * modalities and status copied from the catalog, names shortened.
 */
const m = (id: string, tool_call: boolean, input: string[], output: string[], status?: CatalogModel["status"]): CatalogModel => ({
  id,
  name: id,
  tool_call,
  modalities: { input, output },
  ...(status ? { status } : {}),
})
const T = ["text"]
const TI = ["text", "image"]
const GOOGLE: CatalogModel[] = [
  m("deep-research-preview-04-2026", true, ["text", "image", "video", "audio", "pdf"], ["text", "image"]),
  m("gemini-2.5-computer-use-preview-10-2025", true, TI, T),
  m("gemini-2.5-flash", true, TI, T),
  m("gemini-2.5-flash-preview-tts", false, T, ["audio"]),
  m("gemini-3.1-flash-lite", true, TI, T),
  m("gemini-3.1-flash-lite-preview", true, TI, T, "deprecated"),
  m("gemini-3.1-flash-live-preview", true, ["text", "image", "video", "audio"], ["text", "audio"]),
  m("gemini-3.5-flash-lite", true, TI, T),
  m("gemini-embedding-001", false, T, T),
  m("gemini-embedding-2", false, TI, T),
  m("gemini-flash-latest", true, TI, T),
  m("gemma-4-31b-it", true, TI, T),
  m("lyria-3-pro-preview", false, TI, ["text", "audio"]),
  m("gemini-3.1-flash-image", false, TI, ["text", "image"]),
  m("gemini-3.1-flash-lite-image", true, TI, ["text", "image"]),
  m("veo-3.1-generate-preview", false, TI, ["video"], "beta"),
]
const OTHERS: CatalogModel[] = [
  m("groq/compound", false, T, T),
  m("meta-llama/llama-prompt-guard-2-86m", false, T, T, "beta"),
  m("openai/gpt-oss-120b", true, T, T),
  m("nvidia/nv-embedcode-7b-v1", true, T, T), // tool_call wrong in the catalog: the id still says embedding
  m("nvidia/nemotron-3.5-content-safety", true, TI, T),
  m("nvidia/llama-nemotron-rerank-vl-1b-v2", true, TI, T),
  m("o4-mini-deep-research", true, T, T),
  m("gpt-4o-audio-preview", true, T, T),
  m("qwen/qwen3-next-80b-a3b-instruct", true, T, T),
  m("mistral-ocr-latest", true, TI, T),
  m("x-alpha-model", true, T, T, "alpha"),
]
const provider = (models: CatalogModel[]): CatalogProvider => ({
  id: "p",
  name: "P",
  env: [],
  models: Object.fromEntries(models.map((x) => [x.id, x])),
})
const ids = (models: CatalogModel[]) => models.map((x) => x.id).sort()

test("Google: only chat models that call tools are offered", () => {
  expect(ids(chatModels(provider(GOOGLE)))).toEqual([
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
    "gemma-4-31b-it",
  ])
})

test("other providers: guards, rerankers, embeddings, audio, OCR and alpha are hidden; real chat models stay", () => {
  expect(ids(chatModels(provider(OTHERS)))).toEqual(["openai/gpt-oss-120b", "qwen/qwen3-next-80b-a3b-instruct"])
})

test("matching is on id segments, and a missing tool_call counts as yes", () => {
  expect(isChatModel({ id: "olive-1", name: "Olive", tool_call: true })).toBe(true) // contains "live", not the segment
  expect(isChatModel({ id: "deliver-8b", name: "x" })).toBe(true) // no tool_call, no modalities
  expect(isChatModel({ id: "imagenation-chat", name: "x" })).toBe(true)
})

test("the configured model is always listed, even when the filters hide it", () => {
  const listed = ids(chatModels(provider(GOOGLE), ["gemini-3.1-flash-live-preview", undefined]))
  expect(listed).toContain("gemini-3.1-flash-live-preview")
  expect(listed).not.toContain("gemini-embedding-001")
})
