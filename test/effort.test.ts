import { expect, test } from "bun:test"
import { generateText } from "ai"
import type { CatalogProvider } from "../src/core/catalog"
import { effectiveEffort, effortDetail, effortOptions, mergeProviderOptions, stepEffort, supportedEfforts, type Effort } from "../src/core/effort"
import { AgentFrontmatter } from "../src/core/agents/schema"
import { subagentEffort } from "../src/core/subagents/manager"
import { thoughtOptions } from "../src/core/agent"
import { languageModel } from "../src/core/providers"

const target = (npm: string, model: string, extra: { reasoning?: boolean; api?: string } = {}) => ({
  provider: {
    id: npm.split("/")[1] ?? "p",
    name: "P",
    env: [],
    npm,
    ...(extra.api ? { api: extra.api } : {}),
    models: { [model]: { id: model, name: model, reasoning: extra.reasoning ?? true } },
  } as unknown as CatalogProvider,
  model,
})

test("gemini 3: thinkingLevel; Pro lacks medium so it steps down to low", () => {
  expect(effortOptions(target("@ai-sdk/google", "gemini-3.1-flash-lite"), "medium")).toEqual({ google: { thinkingConfig: { thinkingLevel: "medium" } } })
  expect(effectiveEffort(target("@ai-sdk/google", "gemini-3.1-flash-lite"), "max")).toBe("high")
  expect(effectiveEffort(target("@ai-sdk/google", "gemini-3-pro-preview"), "medium")).toBe("low")
  expect(effectiveEffort(target("@ai-sdk/google", "gemini-3-pro-preview"), "xhigh")).toBe("high")
})

test("gemini 2.5: a thinking budget; Flash tops out below Pro", () => {
  expect(effortOptions(target("@ai-sdk/google", "gemini-2.5-flash"), "high")).toEqual({ google: { thinkingConfig: { thinkingBudget: 8192 } } })
  expect(effectiveEffort(target("@ai-sdk/google", "gemini-2.5-flash"), "max")).toBe("xhigh")
  expect(effectiveEffort(target("@ai-sdk/google", "gemini-2.5-pro"), "max")).toBe("max")
})

test("anthropic: above high only on always-thinking models; older models have no knob", () => {
  expect(effortOptions(target("@ai-sdk/anthropic", "claude-opus-5-5"), "max")).toEqual({ anthropic: { effort: "max" } })
  expect(effectiveEffort(target("@ai-sdk/anthropic", "claude-fable-5-1"), "xhigh")).toBe("xhigh")
  // Thinking is not always on for these, and the harness never turns it on: capped at high.
  expect(effectiveEffort(target("@ai-sdk/anthropic", "claude-opus-5"), "max")).toBe("high")
  expect(effectiveEffort(target("@ai-sdk/anthropic", "claude-opus-4-6"), "xhigh")).toBe("high")
  expect(effectiveEffort(target("@ai-sdk/anthropic", "claude-opus-4-5"), "max")).toBe("high")
  expect(supportedEfforts(target("@ai-sdk/anthropic", "claude-sonnet-4-5"))).toEqual([])
})

test("effortDetail names what the provider receives, only for levels the model takes", () => {
  expect(effortDetail(target("@ai-sdk/google", "gemini-3.1-flash"), "high")).toBe("thinkingLevel high")
  expect(effortDetail(target("@ai-sdk/google", "gemini-3.1-pro"), "medium")).toBeUndefined()
  expect(effortDetail(target("@ai-sdk/google", "gemini-2.5-flash"), "high")).toBe("thinkingBudget 8192")
  expect(effortDetail(target("@ai-sdk/anthropic", "claude-opus-5-5"), "max")).toBe("effort max")
  expect(effortDetail(target("@ai-sdk/openai", "gpt-5-mini"), "low")).toBe("reasoningEffort low")
  expect(effortDetail(target("@ai-sdk/groq", "llama-4"), "low")).toBeUndefined()
})

test("openai: reasoningEffort on the official endpoint only", () => {
  expect(effortOptions(target("@ai-sdk/openai", "gpt-5-mini"), "xhigh")).toEqual({ openai: { reasoningEffort: "high" } })
  expect(effectiveEffort(target("@ai-sdk/openai", "gpt-5.2"), "max")).toBe("xhigh")
  expect(effortOptions(target("@ai-sdk/openai", "gpt-5-mini", { api: "https://gateway.example/v1" }), "high")).toBeUndefined()
  expect(effortOptions(target("@ai-sdk/openai", "gpt-4o"), "high")).toBeUndefined()
})

test("no level, a non-reasoning model or an unknown provider: nothing is sent", () => {
  expect(effortOptions(target("@ai-sdk/google", "gemini-3.1-flash-lite"), undefined)).toBeUndefined()
  expect(effortOptions(target("@ai-sdk/google", "gemini-3.1-flash-lite", { reasoning: false }), "high")).toBeUndefined()
  expect(effortOptions(target("@ai-sdk/openai-compatible", "qwen3"), "high")).toBeUndefined()
  expect(effortOptions(target("@ai-sdk/groq", "openai/gpt-oss-120b"), "max")).toEqual({ groq: { reasoningEffort: "high" } })
})

test("merging keeps Gemini's includeThoughts next to the level", () => {
  const t = target("@ai-sdk/google", "gemini-3.1-flash-lite")
  expect(mergeProviderOptions(thoughtOptions(t), effortOptions(t, "low"))).toEqual({ google: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } } })
  expect(mergeProviderOptions(undefined, undefined)).toBeUndefined()
})

test("the subagent's effort: call or type, then subagents.effort, then effort; junk is ignored", () => {
  expect(subagentEffort({ effort: "high" }, { effort: "low", subagents: { effort: "medium" } })).toBe("high")
  expect(subagentEffort({}, { effort: "low", subagents: { effort: "medium" } })).toBe("medium")
  expect(subagentEffort({}, { effort: "low" })).toBe("low")
  expect(subagentEffort({ effort: "ultra" }, { effort: "bogus" as Effort })).toBeUndefined()
})

test("agent frontmatter takes effort and rejects unknown levels", () => {
  expect(AgentFrontmatter.safeParse({ name: "a", description: "d", effort: "xhigh" }).success).toBe(true)
  expect(AgentFrontmatter.safeParse({ name: "a", description: "d", effort: "ultra" }).success).toBe(false)
})

test("/effort and ctrl+t step through the choices, wrapping; a level the model lacks moves to its neighbour", () => {
  const choices: (Effort | undefined)[] = [undefined, "low", "medium", "high"]
  const seen: (Effort | undefined)[] = []
  let e: Effort | undefined
  for (let i = 0; i < 5; i++) seen.push((e = stepEffort(e, choices, 1)))
  expect(seen).toEqual(["low", "medium", "high", undefined, "low"])
  expect(stepEffort(undefined, choices, -1)).toBe("high")
  // xhigh on a model that stops at high: up wraps to auto, down lands on high.
  expect(stepEffort("xhigh", choices, 1)).toBeUndefined()
  expect(stepEffort("xhigh", choices, -1)).toBe("high")
  expect(stepEffort("medium", [], 1)).toBe("medium")
})

/** The options reach the wire in each SDK's own field (no network: the request is captured). */
async function wire(npm: string, model: string, level: Effort) {
  const realFetch = globalThis.fetch
  let sent: Record<string, unknown> = {}
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    throw new Error("captured")
  }) as unknown as typeof fetch
  try {
    const t = target(npm, model)
    await generateText({ model: languageModel(t.provider, model, "x"), prompt: "hi", maxRetries: 0, providerOptions: effortOptions(t, level) }).catch(() => {})
  } finally {
    globalThis.fetch = realFetch
  }
  return sent
}

test("wire: Gemini thinkingConfig, Anthropic effort, OpenAI and Groq reasoning effort", async () => {
  const gemini = (await wire("@ai-sdk/google", "gemini-3.1-flash-lite", "medium")) as { generationConfig: { thinkingConfig: unknown } }
  expect(gemini.generationConfig.thinkingConfig).toMatchObject({ thinkingLevel: "medium" })
  expect(JSON.stringify(await wire("@ai-sdk/anthropic", "claude-opus-5-5", "xhigh"))).toContain('"effort":"xhigh"')
  expect(JSON.stringify(await wire("@ai-sdk/openai", "gpt-5-mini", "low"))).toMatch(/"(reasoning_effort|effort)":"low"/)
  expect((await wire("@ai-sdk/groq", "openai/gpt-oss-120b", "medium")).reasoning_effort).toBe("medium")
})
