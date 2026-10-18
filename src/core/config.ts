import { configFile } from "./paths"
import type { ProviderId } from "./providers"
import { readJson, writeJson } from "./store"

export interface Config {
  provider?: ProviderId
  model?: string
  /** Memory implementation: "none" (default) or "file" (reference FileMemory). */
  memory?: { provider?: "none" | "file" }
  /** Tools the user chose to always allow (see core/permission.ts). */
  permissions?: { allow?: { tool: string; scope: string }[] }
  /**
   * Deferred tool loading. "auto" (default): deferrable tools (MCP and the optional built-in
   * ones: charts, web, watchlist…) are sent by name only, and loaded with
   * tool_search, once they would cost over 10% of the context or there are more than
   * `toolSearchMinTools` of them. "on": always defer. "off": send everything (capped at 128).
   */
  toolSearch?: "auto" | "on" | "off"
  /** Deferrable tool count above which "auto" defers. Default 40. */
  toolSearchMinTools?: number
  /**
   * "auto" (default): before a turn that would pass 80% of the context window, prune old tool
   * results and, if still needed, summarize the start of the conversation (1 request).
   * "off": only /compact does it.
   */
  autoCompact?: "auto" | "off"
  /** Cap on the context window used for the 80% threshold and ctx %. Default 200000. */
  compactWindow?: number
  /**
   * Subagents (spawn_subagent). `maxConcurrent`: how many run at once, foreground and
   * background together (default 10, no upper cap); more wait for a slot. `provider` +
   * `model`: their model; unset = the session's.
   */
  subagents?: { maxConcurrent?: number; provider?: string; model?: string }
  /**
   * Model for web side calls: provider-native search (web_search) and reading a page against
   * a prompt (web_fetch). Unset: the session's model. A cheap model saves quota.
   */
  webModel?: { provider?: string; model?: string }
  /**
   * Model steps per turn (each step = one model call that may run several tools in
   * parallel). Default: unlimited — the turn ends when the model stops calling tools.
   * Set a number to cap it; the last step is then forced to answer. Subagents keep
   * their own per-type cap (`agents/*.md` maxSteps, default 8).
   */
  maxSteps?: number
}

export const loadConfig = () => readJson<Config>(configFile(), {})

export async function saveConfig(patch: Partial<Config>) {
  const next = { ...(await loadConfig()), ...patch }
  await writeJson(configFile(), next)
  return next
}
