import { createAlibaba } from "@ai-sdk/alibaba"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createMistral } from "@ai-sdk/mistral"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createVercel } from "@ai-sdk/vercel"
import { createXai } from "@ai-sdk/xai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import type { Catalog, CatalogModel, CatalogProvider } from "./catalog"

export type ProviderId = string

type Options = { apiKey: string; baseURL?: string; name: string }

type GeminiContent = { role?: string; parts?: unknown[] }

/**
 * The Google SDK turns a tool message and a following user message (our per-step nudge,
 * the step-limit summary prompt) into two `user` contents in a row. Gemini expects turns to
 * alternate, and Gemini CLI itself sends extra text parts inside the function-response turn,
 * so adjacent same-role contents are merged into one.
 */
export function mergeGeminiTurns(contents: GeminiContent[]): GeminiContent[] {
  const merged: GeminiContent[] = []
  for (const content of contents) {
    const last = merged.at(-1)
    if (last && content.role && last.role === content.role) last.parts = [...(last.parts ?? []), ...(content.parts ?? [])]
    else merged.push({ ...content, parts: [...(content.parts ?? [])] })
  }
  return merged
}

const geminiFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof init?.body === "string" && init.body.includes('"contents"')) {
    try {
      const body = JSON.parse(init.body) as { contents?: GeminiContent[] }
      if (Array.isArray(body.contents)) init = { ...init, body: JSON.stringify({ ...body, contents: mergeGeminiTurns(body.contents) }) }
    } catch {
      // not JSON: send as is
    }
  }
  return globalThis.fetch(input, init)
}) as typeof globalThis.fetch
type Factory = (o: Options) => (modelId: string) => LanguageModel

/** AI SDK packages bundled with OpenTrading, keyed by the npm name models.dev uses. */
const SDK: Record<string, Factory> = {
  "@ai-sdk/openai": (o) => {
    const sdk = createOpenAI(o)
    // Third parties that reuse the OpenAI SDK usually implement Chat Completions, not Responses.
    return o.baseURL ? (id) => sdk.chat(id) : (id) => sdk(id)
  },
  "@ai-sdk/anthropic": (o) => createAnthropic(o),
  "@ai-sdk/google": (o) => createGoogleGenerativeAI({ ...o, fetch: geminiFetch }),
  "@ai-sdk/groq": (o) => createGroq(o),
  "@ai-sdk/mistral": (o) => createMistral(o),
  "@ai-sdk/xai": (o) => createXai(o),
  "@ai-sdk/deepinfra": (o) => createDeepInfra(o),
  "@ai-sdk/cerebras": (o) => createCerebras(o),
  "@ai-sdk/cohere": (o) => createCohere(o),
  "@ai-sdk/togetherai": (o) => createTogetherAI(o),
  "@ai-sdk/perplexity": (o) => createPerplexity(o),
  "@ai-sdk/vercel": (o) => createVercel(o),
  "@ai-sdk/alibaba": (o) => createAlibaba(o),
  "@openrouter/ai-sdk-provider": (o) => {
    const sdk = createOpenRouter(o)
    return (id) => sdk.chat(id)
  },
}

const COMPATIBLE = "@ai-sdk/openai-compatible"

/** Providers shown first in /connect; everything else is alphabetical. */
const PRIORITY = ["groq", "google", "nvidia", "openai", "anthropic", "openrouter", "deepseek", "xai", "mistral"]

/** Resolve which SDK and base URL a provider/model pair needs, or undefined if unsupported. */
function route(provider: CatalogProvider, model?: CatalogModel): { factory: Factory; baseURL?: string } | undefined {
  const npm = model?.provider?.npm ?? provider.npm
  const api = model?.provider?.api ?? provider.api
  // `${ACCOUNT_ID}`-style URLs need extra settings this version does not collect.
  if (api?.includes("${")) return undefined
  if (npm && npm !== COMPATIBLE && SDK[npm]) return { factory: SDK[npm]!, baseURL: api }
  // Anything else that exposes a base URL is spoken to as OpenAI-compatible.
  if (api) return { factory: (o) => createOpenAICompatible({ ...o, baseURL: o.baseURL!, includeUsage: true }), baseURL: api }
  return undefined
}

export const isSupported = (provider: CatalogProvider) => route(provider) !== undefined

/** Which SDK package and base URL a provider/model pair uses (for provider-specific tools). */
export function sdkOf(provider: CatalogProvider, modelId: string): { npm?: string; baseURL?: string } {
  const model = provider.models[modelId]
  return { npm: model?.provider?.npm ?? provider.npm, baseURL: model?.provider?.api ?? provider.api }
}

export function sortedProviders(catalog: Catalog): CatalogProvider[] {
  const rank = (id: string) => (PRIORITY.includes(id) ? PRIORITY.indexOf(id) : PRIORITY.length)
  return Object.values(catalog).sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
}

/** Chat-capable models: text in, text out, not deprecated. */
export function chatModels(provider: CatalogProvider): CatalogModel[] {
  return Object.values(provider.models)
    .filter((m) => m.status !== "deprecated")
    .filter((m) => !m.modalities || (m.modalities.input?.includes("text") && m.modalities.output?.includes("text")))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function languageModel(provider: CatalogProvider, modelId: string, apiKey: string): LanguageModel {
  const target = route(provider, provider.models[modelId])
  if (!target) throw new Error(`Provider ${provider.name} chưa được hỗ trợ trong bản này.`)
  return target.factory({ apiKey, baseURL: target.baseURL, name: provider.id })(modelId)
}
