import { connectedProviders } from "../auth"
import type { Catalog } from "../catalog"
import { loadCatalog } from "../catalog"
import { resolveTarget, type Target } from "../chat"
import { chatModels, isSupported } from "../providers"

/** The config value that asks the harness to pick a small, cheap subagent model. */
export const AUTO_MODEL = "auto"

/** A subagent carries real research context: a lite model below this is not worth it. */
const MIN_CONTEXT = 64_000

/**
 * Preferred lite models, in order: provider, then patterns tried in sequence against
 * tool-capable models of that provider. The first match wins. Edit this data to change
 * the policy (the doc in docs/subagents.md mirrors it).
 */
export const LITE_SHORTLIST: ReadonlyArray<readonly [string, ...RegExp[]]> = [
  ["google", /^gemini-3\.5-flash-lite$/, /^gemini-3\.1-flash-lite$/, /flash-lite$/],
  ["opencode-go", /^claude-haiku-5-5$/, /^glm-5\.3-flash$/, /flash$/],
  ["alibaba", /^qwen3\.7-flash$/, /^qwen-flash$/, /flash$/],
  ["anthropic", /haiku/],
  ["openai", /gpt-.*-mini$/],
  ["groq", /^llama-3\.1-8b-instant$/, /^qwen\//],
  ["openrouter", /haiku/, /gemini-3\.5-flash-lite$/],
  ["nvidia", /^deepseek-ai\/deepseek-v4\.1-flash$/, /flash$/],
  ["ollama-cloud", /^deepseek-v4-flash$/, /flash$/],
]

/**
 * The first shortlist match among connected providers (deterministic), or undefined when
 * nothing suitable is available. `restrictTo` limits the search to one provider.
 */
export function pickAutoModel(catalog: Catalog, connected: readonly string[], restrictTo?: string): { provider: string; model: string } | undefined {
  for (const [providerId, ...patterns] of LITE_SHORTLIST) {
    if (restrictTo && providerId !== restrictTo) continue
    if (!connected.includes(providerId)) continue
    const provider = catalog[providerId]
    if (!provider || !isSupported(provider)) continue
    for (const pattern of patterns) {
      const match = chatModels(provider).find((m) => pattern.test(m.id) && (m.limit?.context ?? 0) >= MIN_CONTEXT)
      if (match) return { provider: providerId, model: match.id }
    }
  }
  return undefined
}

/** The auto target for subagents (key resolved), or undefined when no candidate is connected. */
export async function autoTarget(restrictTo?: string): Promise<Target | undefined> {
  const [catalog, connected] = await Promise.all([loadCatalog(), connectedProviders()])
  const picked = pickAutoModel(catalog, connected, restrictTo)
  return picked ? resolveTarget(picked) : undefined
}
