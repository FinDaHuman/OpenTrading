import { createHash } from "node:crypto"

/** Provider tool-name limits: most accept [A-Za-z0-9_-] up to 64 characters. */
export const MAX_TOOL_NAME = 64

export const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_")

export const serverPrefix = (server: string) => `mcp__${sanitize(server)}__`

/**
 * Model-visible name for an MCP tool: `mcp__<server>__<tool>`.
 * If it is too long or collides with a name already taken, it is shortened and given a
 * short hash of the raw identity, so two different tools never share a name.
 * The raw server/tool names are kept separately for the actual MCP call.
 */
export function toolName(server: string, tool: string, taken: ReadonlySet<string> = new Set()) {
  const base = serverPrefix(server) + sanitize(tool)
  if (base.length <= MAX_TOOL_NAME && !taken.has(base)) return base
  const hash = createHash("sha1").update(`${server}\u0000${tool}`).digest("hex").slice(0, 8)
  return `${base.slice(0, MAX_TOOL_NAME - hash.length - 1)}_${hash}`
}
