import { z } from "zod"
import type { ToolRegistry } from "../registry"
import { LOADED_PREFIX, describeTool, resolveToolName, scoreTools } from "../search"
import { LOCAL_SOURCE, type ToolDef } from "../types"

export const TOOL_SEARCH = "tool_search"
const DEFAULT_RESULTS = 5
const MAX_RESULTS = 20

/**
 * Loads deferred tools on demand. The result starts with `Đã nạp tool: …`, which the agent
 * loop reads back from history to make those tools callable (from the next step on, and in
 * later turns and resumed sessions).
 */
export function toolSearchTool(registry: ToolRegistry, pending: () => string[] = () => []): ToolDef<{ query: string; max_results?: number }> {
  return {
    name: TOOL_SEARCH,
    description: [
      "Loads deferred tools (names in <tool_hoan>) so they can be called right away. Use when you need a tool that has no schema yet.",
      'query: "select:name_a,name_b" loads those exact names (put every tool you will need in one call); or Vietnamese/English keywords such as "gia lich su", "foreign flow"; "+word" must match; "mcp__server" takes the whole server.',
    ].join(" "),
    input: z.object({
      query: z.string(),
      max_results: z.number().int().min(1).max(MAX_RESULTS).optional().describe(`Maximum number of tools (default ${DEFAULT_RESULTS})`),
    }),
    readOnly: true,
    summarize: (input) => `tool_search ${input.query}`,
    async execute({ query, max_results }) {
      const limit = Math.min(max_results ?? DEFAULT_RESULTS, MAX_RESULTS)
      const candidates = registry.list().filter((d) => d.deferrable && !d.onDemand)
      const q = query.trim()
      let found: ToolDef[] = []
      const notes: string[] = []

      if (q.toLowerCase().startsWith("select:")) {
        for (const raw of q.slice("select:".length).split(",").map((s) => s.trim()).filter(Boolean)) {
          const names = resolveToolName(registry, raw)
          const def = names.length === 1 ? registry.get(names[0]!) : undefined
          if (def?.onDemand) notes.push(`${def.name} is only available when the user turns it on for a request (e.g. by typing ultradesk); it cannot be loaded with tool_search.`)
          else if (def) found.push(def)
          else if (names.length > 1) notes.push(`"${raw}" matches several tools: ${names.join(", ")} — give server/name.`)
          else notes.push(`No tool "${raw}".`)
        }
      } else if (/^mcp__[A-Za-z0-9_-]+$/.test(q)) {
        const prefix = q.endsWith("__") ? q : `${q}__`
        found = candidates.filter((d) => d.name.startsWith(prefix)).slice(0, limit)
      } else {
        // Loading is permanent for the session: keep only hits close to the best one, so a
        // search does not drag in every tool that merely mentions a word.
        const hits = scoreTools(registry, candidates, q)
        const floor = (hits[0]?.score ?? 0) / 2
        found = hits
          .filter((h) => h.score >= floor)
          .slice(0, limit)
          .map((h) => h.def)
      }
      found = [...new Map(found.map((d) => [d.name, d])).values()]

      if (found.length === 0) {
        const servers = new Map<string, number>()
        const local: string[] = []
        for (const d of candidates) {
          if (d.source === LOCAL_SOURCE) local.push(d.name)
          else servers.set(d.source ?? "?", (servers.get(d.source ?? "?") ?? 0) + 1)
        }
        const list = [...servers].map(([s, n]) => `${s.replace(/^mcp:/, "")} (${n} tool)`).join(", ")
        const waiting = pending()
        return [
          `No tool matches "${q}".`,
          ...notes,
          list ? `Servers with deferred tools: ${list}. Try other keywords or "mcp__<server>" to see one server's tools.` : "",
          local.length > 0 ? `Deferred built-in tools (load with "select:<name>"): ${local.join(", ")}.` : "",
          !list && local.length === 0 ? "No deferred tools." : "",
          waiting.length > 0 ? `Servers still connecting (try again later): ${waiting.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n")
      }
      return [
        LOADED_PREFIX + found.map((d) => d.name).join(", "),
        ...notes,
        "",
        ...found.map((d) => describeTool(registry, d)),
      ].join("\n")
    },
  }
}
