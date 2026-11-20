import { matchToolPattern } from "../tools/patterns"
import { renamedToolNames } from "../tools/renamed"
import type { ToolDef } from "../tools/types"
import type { AgentDefinition } from "./schema"

export const READ_ONLY = "@chi-doc"

const matches = (patterns: string[] | undefined, name: string) => !!patterns?.some((p) => matchToolPattern(p, [name]).length > 0)
/**
 * Old names (renamed.ts) in an agent file written before #278 never grant more than they did.
 * `tools`: the full tool only when every old name is listed (a wildcard); otherwise its read-only
 * variant (watchlist_local list/get) when a read name is listed, so `watchlist_local_list` never
 * brings `delete`. A partial set of write names gets no write at all: narrower, never wider.
 */
function grantedByOld(patterns: string[], tool: ToolDef) {
  const { matched, all } = renamedToolNames((old) => matches(patterns, old), tool.name)
  if (matched.length === 0) return false
  return all || (tool.readOnly && matched.some((r) => !r.writes))
}

/**
 * `disallowedTools`: any old name removes the full tool; a write-only set (`watchlist_local_delete`)
 * leaves the read-only variant, a read name removes that too.
 */
function deniedByOld(patterns: string[] | undefined, tool: ToolDef) {
  if (!patterns?.length) return false
  const { matched } = renamedToolNames((old) => matches(patterns, old), tool.name)
  if (matched.length === 0) return false
  return !tool.readOnly || matched.some((r) => !r.writes)
}

/**
 * Which of the subagent-eligible tools this agent type gets (the manager has already
 * removed the excluded ones; no pattern can bring them back).
 */
export function toolFilter(def: Pick<AgentDefinition, "tools" | "disallowedTools">): (tool: ToolDef) => boolean {
  const listed = def.tools ?? ["*"]
  const readOnly = listed.includes(READ_ONLY)
  const patterns = listed.filter((p) => p !== READ_ONLY)
  const all = patterns.length === 0 || patterns.includes("*")
  return (tool) => {
    if (matches(def.disallowedTools, tool.name) || deniedByOld(def.disallowedTools, tool)) return false
    if (readOnly && !tool.readOnly) return false
    return all || matches(patterns, tool.name) || grantedByOld(patterns, tool)
  }
}

/** "tất cả", "chỉ đọc", or the patterns — for the tool description and /agents. */
export function toolSummary(def: Pick<AgentDefinition, "tools" | "disallowedTools">) {
  const listed = def.tools ?? ["*"]
  const readOnly = listed.includes(READ_ONLY)
  const patterns = listed.filter((p) => p !== READ_ONLY && p !== "*")
  const base = patterns.length > 0 ? patterns.join(", ") + (readOnly ? " (chỉ đọc)" : "") : readOnly ? "chỉ đọc" : "tất cả"
  return def.disallowedTools?.length ? `${base}, trừ ${def.disallowedTools.join(", ")}` : base
}
