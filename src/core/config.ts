import type { Effort } from "./effort"
import { configFile } from "./paths"
import type { ProviderId } from "./providers"
import { readJson, writeJson } from "./store"
import type { AutoModeConfig } from "./permission/auto/rules"

export interface Config {
  provider?: ProviderId
  model?: string
  /** Memory implementation: "none" (default) or "file" (reference FileMemory). */
  memory?: { provider?: "none" | "file" }
  /**
   * Permissions (core/permission): `allow` = "always allow" answers; `deny` / `ask` = rules the
   * user writes by hand (tool name with `*`, optional `pattern` on the path or command);
   * `defaultMode` = the mode a session starts in (default "read-only").
   */
  permissions?: {
    allow?: { tool: string; scope: string; pattern?: string }[]
    deny?: { tool: string; pattern?: string }[]
    ask?: { tool: string; pattern?: string }[]
    defaultMode?: "read-only" | "ask" | "auto"
    /** The one-time explanation of ▸▸ auto mode was shown. */
    autoAcknowledged?: boolean
  }
  /**
   * ▸▸ auto mode's classifier (core/permission/auto): its model (unset = the session's) and
   * the rule lists (environment / allow / soft_deny / hard_deny; "$defaults" keeps the built-in
   * ones). Read only from here, never from a project folder.
   */
  autoMode?: AutoModeConfig
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
   * "auto" (default): before a turn that would pass the threshold (`autoCompactPercent`), prune
   * old tool results and, if still needed, summarize the start of the conversation (1 request).
   * "off": only /compact does it.
   */
  autoCompact?: "auto" | "off"
  /**
   * Auto-compaction threshold, in % of the window minus a reserve for the answer
   * (min(output limit, 20k)). 50–95, default 95: about 93% of a 1M window.
   */
  autoCompactPercent?: number
  /**
   * TUI details (default on): `tips`, a tip under the working row during long turns;
   * `terminalNotify`, a desktop notification when a turn ends or waits for you while the
   * terminal is in the background, and the tab progress ring. `scrollSpeed`: chat rows per
   * mouse-wheel notch (default 5); `scrollAcceleration`: speed up while the wheel spins fast
   * (1 row per slow notch, up to 6×) instead.
   */
  ui?: { tips?: boolean; terminalNotify?: boolean; scrollSpeed?: number; scrollAcceleration?: boolean }
  /**
   * Cap, in tokens, on the context window used for the threshold and ctx %. Unset (default):
   * the model's whole window (models.dev `limit.input`, else `limit.context`). Gemini's free
   * tier takes at most 250k input tokens a minute, so a larger request always fails there:
   * set about 200000.
   */
  compactWindow?: number
  /**
   * Subagents (spawn_subagent). `maxConcurrent`: how many run at once, foreground and
   * background together (default 10, no upper cap); more wait for a slot. `provider` +
   * `model`: their model; unset = the session's. `"auto"` = the harness picks a small,
   * cheap tool-capable model among the connected providers (see model-pick.ts). `idleMs`:
   * a run with no progress (no events, not waiting on the user) for this long is stopped;
   * default 300000 (5 minutes), values below 1000 are ignored. `effort`: their reasoning
   * effort when the agent type sets none; unset = `effort` below.
   */
  subagents?: { maxConcurrent?: number; idleMs?: number; provider?: string; model?: string; effort?: Effort }
  /**
   * Reasoning effort of the main agent: low | medium | high | xhigh | max (effort.ts maps it
   * per provider; a level the model lacks steps down). Unset: the provider's default.
   */
  effort?: Effort
  /**
   * Model for side calls: provider-native search (web_search), reading a page against a
   * prompt (web_fetch) and the session title. Unset: the session's model. A cheap model saves quota.
   */
  webModel?: { provider?: string; model?: string }
  /**
   * Model steps per turn (each step = one model call that may run several tools in
   * parallel). Default: unlimited — the turn ends when the model stops calling tools.
   * Set a number to cap it; the last step is then forced to answer. Subagents keep
   * their own per-type cap (`agents/*.md` maxSteps, default 8).
   */
  maxSteps?: number
  /** Extra workspace folders kept across sessions (`/add-dir <thư mục> --luu`). */
  workspace?: { dirs?: string[] }
}

export const loadConfig = () => readJson<Config>(configFile(), {})

export async function saveConfig(patch: Partial<Config>) {
  const next = { ...(await loadConfig()), ...patch }
  await writeJson(configFile(), next)
  return next
}
