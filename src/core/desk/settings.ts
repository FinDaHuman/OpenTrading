import type { Config } from "../config"
import { isEffort, type Effort } from "../effort"
import { DESK_SIZES, type DeskSize } from "./types"

/** Defaults sized for free tiers (Gemini 500 requests a day, a 0.1-CPU MCP host). */
export const DESK_DEFAULTS = {
  size: "small" as DeskSize,
  /** Hard cap of agents a run may start (a runaway-loop backstop; Claude Code: 1000). */
  maxAgents: 100,
  /** Agents of one run at once, inside subagents.maxConcurrent; kept at or under MCP's 4. */
  maxConcurrent: 3,
  /** The approval card warns above this many projected model requests. */
  warnRequests: 150,
  /** Hold siblings with the same prompt prefix this long so they read the first one's cache. */
  staggerMs: 3000,
}

export interface DeskSettings {
  size: DeskSize
  maxAgents: number
  maxConcurrent: number
  /** Hard cap of model requests per run; undefined = none. */
  maxRequests?: number
  warnRequests: number
  effort?: Effort
  model?: { provider?: string; model?: string }
  keyword: boolean
  alwaysOn: boolean
  staggerMs: number
}

const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined)

/** config.desk with defaults; nonsense values fall back to the default. */
export function deskSettings(config: Pick<Config, "desk">): DeskSettings {
  const d = config.desk ?? {}
  const stagger = typeof d.staggerMs === "number" && Number.isFinite(d.staggerMs) && d.staggerMs >= 0 ? Math.min(d.staggerMs, 10_000) : DESK_DEFAULTS.staggerMs
  return {
    size: DESK_SIZES.includes(d.size as DeskSize) ? (d.size as DeskSize) : DESK_DEFAULTS.size,
    maxAgents: posInt(d.maxAgents) ?? DESK_DEFAULTS.maxAgents,
    maxConcurrent: posInt(d.maxConcurrent) ?? DESK_DEFAULTS.maxConcurrent,
    maxRequests: posInt(d.maxRequests),
    warnRequests: posInt(d.warnRequests) ?? DESK_DEFAULTS.warnRequests,
    effort: isEffort(d.effort) ? d.effort : undefined,
    model: d.model ? { provider: d.provider, model: d.model } : undefined,
    keyword: d.keyword !== false,
    alwaysOn: d.alwaysOn === true,
    staggerMs: stagger,
  }
}
