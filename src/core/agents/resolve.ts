import { matchToolPattern } from "../tools/patterns"
import { renamedToolMatches } from "../tools/renamed"
import type { ToolDef } from "../tools/types"
import type { AgentDefinition } from "./schema"

export const READ_ONLY = "@chi-doc"

const matches = (patterns: string[] | undefined, name: string) => !!patterns?.some((p) => matchToolPattern(p, [name]).length > 0)
/** Also an old name of this tool (renamed.ts): an agent file written before #278 keeps its meaning. */
const names = (patterns: string[] | undefined, name: string) => matches(patterns, name) || renamedToolMatches((old) => matches(patterns, old), name)

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
    if (names(def.disallowedTools, tool.name)) return false
    if (readOnly && !tool.readOnly) return false
    return all || names(patterns, tool.name)
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
