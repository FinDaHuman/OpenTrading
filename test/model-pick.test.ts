import { expect, test } from "bun:test"
import type { Catalog, CatalogModel } from "../src/core/catalog"
import { pickAutoModel } from "../src/core/subagents/model-pick"

const text = { input: ["text"], output: ["text"] }
const model = (id: string, context = 200_000): CatalogModel => ({ id, name: id, tool_call: true, modalities: text, limit: { context } })
const provider = (id: string, npm: string, models: CatalogModel[]) => ({
  id,
  name: id,
  env: [],
  npm,
  models: Object.fromEntries(models.map((m) => [m.id, m])),
})

test("google kết nối thì chọn gemini-3.5-flash-lite", () => {
  const catalog: Catalog = {
    google: provider("google", "@ai-sdk/google", [model("gemini-3.5-flash-lite"), model("gemini-2.5-flash")]),
    nvidia: provider("nvidia", "@ai-sdk/openai-compatible", [model("deepseek-ai/deepseek-v4.1-flash")]),
  }
  expect(pickAutoModel(catalog, ["nvidia", "google"])).toEqual({ provider: "google", model: "gemini-3.5-flash-lite" })
})

test("google không kết nối, groq kết nối thì chọn llama instant", () => {
  const catalog: Catalog = {
    groq: provider("groq", "@ai-sdk/groq", [model("llama-3.1-8b-instant"), model("qwen/qwen3.6-27b")]),
  }
  expect(pickAutoModel(catalog, ["groq"])).toEqual({ provider: "groq", model: "llama-3.1-8b-instant" })
})

test("không có ứng viên nào thì trả undefined", () => {
  const catalog: Catalog = {
    groq: provider("groq", "@ai-sdk/groq", [model("llama-3.1-8b-instant")]),
  }
  expect(pickAutoModel(catalog, ["khong-ket-noi"])).toBeUndefined()
  expect(pickAutoModel({}, ["google"])).toBeUndefined()
})

test("restrictTo chỉ xét đúng provider đó", () => {
  const catalog: Catalog = {
    google: provider("google", "@ai-sdk/google", [model("gemini-3.5-flash-lite")]),
    alibaba: provider("alibaba", "@ai-sdk/alibaba", [model("qwen3.7-flash")]),
  }
  expect(pickAutoModel(catalog, ["google", "alibaba"], "alibaba")).toEqual({ provider: "alibaba", model: "qwen3.7-flash" })
})

test("bỏ qua model không gọi được tool hoặc context dưới 64k", () => {
  const catalog: Catalog = {
    google: provider("google", "@ai-sdk/google", [
      model("gemini-3.5-flash-lite", 32_000),
      { ...model("gemini-3.1-flash-lite"), tool_call: false },
    ]),
  }
  expect(pickAutoModel(catalog, ["google"])).toBeUndefined()
})
