import { stat } from "node:fs/promises"
import { catalogCacheFile } from "./paths"
import { readJson, writeJson } from "./store"

/**
 * Provider/model catalog from models.dev — the same source opencode uses.
 * Cached on disk and refreshed once an hour: a cache past that is still used at once while a
 * fresh copy downloads in the background (about 6 MB), so a start never waits on the network
 * unless there is no cache at all. Usable offline from the cache.
 */

export interface CatalogModel {
  id: string
  name: string
  family?: string
  /** models.dev release date (YYYY-MM-DD or YYYY-MM). */
  release_date?: string
  reasoning?: boolean
  /**
   * How the model's reasoning can be set (models.dev): effort levels, an on/off toggle, a token
   * budget. Shapes as cached on 30/10: `{type:"effort", values}` (4560 models), `{type:"toggle"}`
   * (1426), `{type:"budget_tokens", min?, max?}` (606).
   */
  reasoning_options?: ReasoningOption[]
  tool_call?: boolean
  status?: "alpha" | "beta" | "deprecated"
  /** `input`: some models accept less input than their context (GPT-5: 400k context, 272k input). */
  limit?: { context?: number; input?: number; output?: number }
  modalities?: { input?: string[]; output?: string[] }
  provider?: { npm?: string; api?: string }
}

export type ReasoningOption =
  | { type: "effort"; values: string[] }
  | { type: "toggle" }
  | { type: "budget_tokens"; min?: number; max?: number }

export interface CatalogProvider {
  id: string
  name: string
  env: string[]
  npm?: string
  api?: string
  doc?: string
  models: Record<string, CatalogModel>
}

export type Catalog = Record<string, CatalogProvider>

export const CATALOG_URL = process.env.OPENTRADING_MODELS_URL ?? "https://models.opencode.ai/api.json"
const TTL_MS = 60 * 60 * 1000

/** Used only when the catalog has never been fetched and the network is down. */
const FALLBACK: Catalog = {
  groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], npm: "@ai-sdk/groq", models: {} },
  google: {
    id: "google",
    name: "Google",
    env: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
    npm: "@ai-sdk/google",
    models: {},
  },
  nvidia: {
    id: "nvidia",
    name: "Nvidia",
    env: ["NVIDIA_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://integrate.api.nvidia.com/v1",
    models: {},
  },
}

/**
 * One load per cache file, so a process only fetches once — but a different state dir
 * (another OPENTRADING_HOME) gets its own catalog instead of a stale shared one.
 */
const pending = new Map<string, Promise<Catalog>>()

export function loadCatalog(): Promise<Catalog> {
  const file = catalogCacheFile()
  let promise = pending.get(file)
  if (!promise) {
    promise = load(file)
    pending.set(file, promise)
    // Offline fallback is not cached, so the next call retries the network.
    void promise.then((catalog) => catalog === FALLBACK && pending.delete(file))
  }
  return promise
}

async function load(file: string): Promise<Catalog> {
  const age = await stat(file)
    .then((s) => Date.now() - s.mtimeMs)
    .catch(() => Infinity)
  const cached = await readJson<Catalog | undefined>(file, undefined)
  if (cached && age < TTL_MS) return cached
  if (cached) {
    // Stale: answer with it now; later calls in this process get the fresh copy once it lands.
    const stale = pending.get(file)
    void download(file).then((fresh) => {
      if (fresh && pending.get(file) === stale) pending.set(file, Promise.resolve(fresh))
    })
    return cached
  }
  return (await download(file)) ?? FALLBACK
}

/** The catalog from the network, written to the cache; undefined when it could not be fetched. */
async function download(file: string): Promise<Catalog | undefined> {
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`catalog ${res.status}`)
    const fresh = (await res.json()) as Catalog
    await writeJson(file, fresh).catch(() => {})
    return fresh
  } catch {
    return undefined
  }
}
