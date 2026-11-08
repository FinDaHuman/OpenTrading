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
import pkg from "../../package.json"
import { build } from "./build-info"
import { conversationId } from "./conversation"
import { countedFetch } from "./requests"
import type { OpenRouterRouting } from "./openrouter-routing"

export type ProviderId = string

type Options = { apiKey: string; baseURL?: string; name: string; fetch: typeof globalThis.fetch; routing?: OpenRouterRouting }

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

const geminiFetch = (base: typeof globalThis.fetch) => (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof init?.body === "string" && init.body.includes('"contents"')) {
    try {
      const body = JSON.parse(init.body) as { contents?: GeminiContent[] }
      if (Array.isArray(body.contents)) init = { ...init, body: JSON.stringify({ ...body, contents: mergeGeminiTurns(body.contents) }) }
    } catch {
      // not JSON: send as is
    }
  }
  return base(input, init)
}) as typeof globalThis.fetch
type Factory = (o: Options) => (modelId: string) => Exclude<LanguageModel, string>

/** AI SDK packages bundled with OpenTrading, keyed by the npm name models.dev uses. */
const SDK: Record<string, Factory> = {
  "@ai-sdk/openai": (o) => {
    const sdk = createOpenAI(o)
    // Third parties that reuse the OpenAI SDK usually implement Chat Completions, not Responses.
    return o.baseURL ? (id) => sdk.chat(id) : (id) => sdk(id)
  },
  "@ai-sdk/anthropic": (o) => createAnthropic(o),
  "@ai-sdk/google": (o) => createGoogleGenerativeAI({ ...o, fetch: geminiFetch(o.fetch) }),
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
    const { routing, ...rest } = o
    const own = isOpenRouter(o.baseURL)
    const sdk = createOpenRouter({ ...rest, ...(own ? OPENROUTER_APP : {}) })
    // Provider routing is OpenRouter's own; gateways that reuse the SDK do not get it.
    const settings = own && routing ? { provider: routing as never } : undefined
    return (id) => (settings ? sdk.chat(id, settings) : sdk.chat(id))
  },
}

/**
 * OpenRouter app attribution (openrouter.ai/docs/app-attribution): HTTP-Referer identifies
 * the app, X-OpenRouter-Title names it (X-Title is the older name), and the category files
 * it with the coding agents. Some free models only answer apps it can attribute
 * ("only available on agentic harnesses"); opencode and Cline send the same headers.
 */
const OPENROUTER_APP = {
  appName: "OpenTrading",
  appUrl: "https://github.com/FinDaHuman/OpenTrading",
  headers: { "X-Title": "OpenTrading", "X-OpenRouter-Categories": "cli-agent" },
}

/** Other gateways reuse the OpenRouter SDK (models.dev: standardcompute); they get no OpenRouter headers. */
function isOpenRouter(baseURL: string | undefined) {
  if (!baseURL) return true
  try {
    const host = new URL(baseURL).hostname
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai")
  } catch {
    return false
  }
}

/**
 * OpenCode Go/Zen (opencode.ai/docs/go, "Where can I use it?"): a client "should" identify
 * itself with its own user agent rather than an SDK name, and send "a stable session ID in
 * `x-opencode-session` for each conversation" for routing and prompt caching. Clients that
 * send it on some paths only are listed there as problematic, so it is added here, on the
 * fetch every request to that host goes through, whatever the SDK or call site.
 */
function isOpenCode(baseURL: string | undefined) {
  if (!baseURL) return false
  try {
    const host = new URL(baseURL).hostname
    return host === "opencode.ai" || host.endsWith(".opencode.ai")
  } catch {
    return false
  }
}

export const USER_AGENT = `opentrading/${build?.version ?? pkg.version} (${process.platform} ${process.arch})`

/** `conversation`: this request's conversation id (a subagent's own); unset = the process's current one. */
const openCodeFetch = (base: typeof globalThis.fetch, conversation: string | undefined) =>
  ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    // Set last, so it replaces the SDK's "ai/<version> …" user agent.
    headers.set("user-agent", USER_AGENT)
    const session = conversation ?? conversationId()
    if (session) headers.set("x-opencode-session", session)
    return base(input, { ...init, headers })
  }) as typeof globalThis.fetch

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

/**
 * Ids of models that are not chat models even when the catalog lists text in and out:
 * embeddings, speech, image/video/music generation, realtime/live, rerankers, guard and
 * safety classifiers, deep-research and computer-use agents. Matched on whole id segments
 * (`gemini-3.1-flash-live-preview`, `nvidia/nv-embedcode-7b-v1`), so a name merely
 * containing the letters is kept. A backstop for catalog entries; `tool_call` does most.
 */
const NOT_CHAT =
  /(^|[-/_.:])(embed\w*|embedding|tts|whisper|transcribe|image|imagen|veo|lyria|live|realtime|audio|rerank\w*|guard|safety|moderation|deep-research|computer-use|ocr)([-/_.:]|$)/i

/**
 * Models offered by /model and /config: chat models that can call tools — the agent loop
 * is tool-driven, so a model without tools answers with no data. Like opencode, deprecated
 * and alpha entries are hidden. A missing `tool_call` counts as yes, as in the agent loop.
 * `keep` (the configured models) are always listed, whatever the filters say.
 */
export function chatModels(provider: CatalogProvider, keep: (string | undefined)[] = []): CatalogModel[] {
  return Object.values(provider.models)
    .filter((m) => keep.includes(m.id) || isChatModel(m))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function isChatModel(m: CatalogModel): boolean {
  if (m.status === "deprecated" || m.status === "alpha") return false
  if (m.modalities && !(m.modalities.input?.includes("text") && m.modalities.output?.includes("text"))) return false
  if (m.tool_call === false) return false
  return !NOT_CHAT.test(m.id)
}

/**
 * Per-request extras: `routing` = OpenRouter provider pinning (ignored by other providers);
 * `conversation` = the conversation id OpenCode gets (a subagent's own; unset = conversation.ts).
 */
export interface ModelOptions {
  routing?: OpenRouterRouting
  conversation?: string
}

export function languageModel(provider: CatalogProvider, modelId: string, apiKey: string, opts: ModelOptions = {}): Exclude<LanguageModel, string> {
  const target = route(provider, provider.models[modelId])
  if (!target) throw new Error(`Provider ${provider.name} chưa được hỗ trợ trong bản này.`)
  const counted = countedFetch(provider.id, modelId)
  const fetch = isOpenCode(target.baseURL) ? openCodeFetch(counted, opts.conversation) : counted
  const options: Options = { apiKey, baseURL: target.baseURL, name: provider.id, fetch }
  return target.factory(opts.routing ? { ...options, routing: opts.routing } : options)(modelId)
}
