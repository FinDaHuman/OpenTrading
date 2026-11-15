/**
 * Tools issue #278 folded into others: the old name, the tool that took it over, and the
 * `action` / `kind` value the old tool became. Config written for the old names keeps working:
 * a deny/ask rule matches the same calls (permission/index.ts), an agent's `disallowedTools`
 * still removes the tool (agents/resolve.ts), and a call by the old name in a resumed
 * conversation runs as the new tool (agent.ts repairCall).
 */
export interface Renamed {
  tool: string
  field: string
  value: string
}

const watchlist = (action: string): Renamed => ({ tool: "watchlist_local", field: "action", value: action })

export const RENAMED_TOOLS: Readonly<Record<string, Renamed>> = {
  watchlist_local_list: watchlist("list"),
  watchlist_local_get: watchlist("get"),
  watchlist_local_create: watchlist("create"),
  watchlist_local_add: watchlist("add"),
  watchlist_local_remove: watchlist("remove"),
  watchlist_local_rename: watchlist("rename"),
  watchlist_local_delete: watchlist("delete"),
  chart_compare: { tool: "chart_render", field: "kind", value: "compare" },
  chart_depth: { tool: "chart_render", field: "kind", value: "depth" },
}

/** Old names `matches` accepts whose calls now go to `tool` with this input. */
export function renamedCallMatches(matches: (oldName: string) => boolean, tool: string, input: unknown): boolean {
  for (const [old, to] of Object.entries(RENAMED_TOOLS)) {
    if (to.tool !== tool || !matches(old)) continue
    if ((input as Record<string, unknown> | undefined)?.[to.field] === to.value) return true
  }
  return false
}

/** Whether a tool-level pattern list (an agent's tools / disallowedTools) names `tool` by an old name. */
export function renamedToolMatches(matches: (oldName: string) => boolean, tool: string): boolean {
  return Object.entries(RENAMED_TOOLS).some(([old, to]) => to.tool === tool && matches(old))
}
