/**
 * Tools issue #278 folded into others: the old name, the tool that took it over, and the
 * `action` / `kind` value the old tool became. Config written for the old names keeps working:
 * a deny/ask rule matches the same calls (permission/index.ts), an agent's `tools` /
 * `disallowedTools` never grant more than they did (agents/resolve.ts), and a call by the old
 * name in a resumed conversation runs as the new tool (agent.ts repairCall).
 */
export interface Renamed {
  tool: string
  field: string
  value: string
  /** The old tool wrote (watchlist create/add/…): an agent listing it may not get only the read-only variant. */
  writes?: boolean
  /** The old tool's input in the new tool's fields (renamed or reshaped arguments). */
  adapt?: (input: Record<string, unknown>) => Record<string, unknown>
}

const watchlist = (action: string, writes = true): Renamed => ({ tool: "watchlist_local", field: "action", value: action, writes })

/** chart_compare took `title`, `series: [{label, values}]` and a narrower `width`; chart_render takes symbol, labels + matrix. */
function adaptCompare(input: Record<string, unknown>) {
  const { title, series, width, ymin: _ymin, ymax: _ymax, ...rest } = input
  const out: Record<string, unknown> = { ...rest }
  if (typeof title === "string" && out.symbol === undefined) out.symbol = title
  if (Array.isArray(series) && series.every((s) => s && typeof s === "object" && !Array.isArray(s))) {
    out.labels = series.map((s) => (s as { label?: unknown }).label)
    out.matrix = series.map((s) => (s as { values?: unknown }).values)
  }
  if (typeof width === "number" && width >= 20) out.width = width
  return out
}

/** chart_depth's `depth` (levels per side) is chart_render's `levels`. */
function adaptDepth(input: Record<string, unknown>) {
  const { depth, ...rest } = input
  return depth !== undefined && rest.levels === undefined ? { ...rest, levels: depth } : rest
}

export const RENAMED_TOOLS: Readonly<Record<string, Renamed>> = {
  watchlist_local_list: watchlist("list", false),
  watchlist_local_get: watchlist("get", false),
  watchlist_local_create: watchlist("create"),
  watchlist_local_add: watchlist("add"),
  watchlist_local_remove: watchlist("remove"),
  watchlist_local_rename: watchlist("rename"),
  watchlist_local_delete: watchlist("delete"),
  chart_compare: { tool: "chart_render", field: "kind", value: "compare", adapt: adaptCompare },
  chart_depth: { tool: "chart_render", field: "kind", value: "depth", adapt: adaptDepth },
}

/** An old-name call's input as the new tool takes it: reshaped, then the action/kind set. */
export function renamedInput(to: Renamed, input: Record<string, unknown>): Record<string, unknown> {
  return { ...(to.adapt ? to.adapt(input) : input), [to.field]: to.value }
}

/** Old names `matches` accepts whose calls now go to `tool` with this input. */
export function renamedCallMatches(matches: (oldName: string) => boolean, tool: string, input: unknown): boolean {
  for (const [old, to] of Object.entries(RENAMED_TOOLS)) {
    if (to.tool !== tool || !matches(old)) continue
    if ((input as Record<string, unknown> | undefined)?.[to.field] === to.value) return true
  }
  return false
}

/**
 * The old names of `tool` a tool-level pattern list (an agent's tools / disallowedTools) names:
 * `matched`, and `all` = every old name of that tool (a wildcard like `watchlist_local_*`).
 */
export function renamedToolNames(matches: (oldName: string) => boolean, tool: string): { matched: Renamed[]; all: boolean } {
  const olds = Object.entries(RENAMED_TOOLS).filter(([, to]) => to.tool === tool)
  const matched = olds.filter(([old]) => matches(old)).map(([, to]) => to)
  return { matched, all: olds.length > 0 && matched.length === olds.length }
}
