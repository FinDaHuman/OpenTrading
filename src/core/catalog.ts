import { stat } from "node:fs/promises"
import path from "node:path"
import { DATA_DIR } from "./paths"
import { readJson, writeJson } from "./store"

/**
 * Provider/model catalog from models.dev — the same source opencode uses.
 * Fetched once an hour, cached on disk, and usable offline from the cache.
 */

export interface CatalogModel {
  id: string
  name: string
  family?: string
  reasoning?: boolean
  tool_call?: boolean
  status?: "alpha" | "beta" | "deprecated"
  limit?: { context?: number; output?: number }
  modalities?: { input?: string[]; output?: string[] }
  provider?: { npm?: string; api?: string }
}

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
const CACHE_FILE = path.join(DATA_DIR, "cache", "models.json")
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

let pending: Promise<Catalog> | undefined

export function loadCatalog(): Promise<Catalog> {
  pending ??= load()
  return pending
}

async function load(): Promise<Catalog> {
  const age = await stat(CACHE_FILE)
    .then((s) => Date.now() - s.mtimeMs)
    .catch(() => Infinity)
  const cached = await readJson<Catalog | undefined>(CACHE_FILE, undefined)
  if (cached && age < TTL_MS) return cached
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`catalog ${res.status}`)
    const fresh = (await res.json()) as Catalog
    await writeJson(CACHE_FILE, fresh).catch(() => {})
    return fresh
  } catch {
    return cached ?? FALLBACK
  }
}
