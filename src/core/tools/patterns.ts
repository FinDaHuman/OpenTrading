import { sanitize } from "../mcp/naming"

/** A name with `*` wildcards as a regex body; other characters are sanitized like tool names. */
const glob = (text: string) => text.split("*").map(sanitize).join("[A-Za-z0-9_-]*")

/**
 * Tools a skill's `requires_tools` entry names. Forms, so skill authors need not know the
 * harness's `mcp__server__tool` naming:
 * - a full name: `mcp__opentrading__vn_quote_history`, `current_time`
 * - `server/tool`: `opentrading/vn_quote_history`
 * - a bare tool name, matching built-ins or any server's tool: `vn_quote_history`
 * `*` matches any run of name characters in each form (`opentrading/vn_*_ohlcv`).
 */
export function matchToolPattern(pattern: string, names: Iterable<string>): string[] {
  const p = pattern.trim()
  if (!p) return []
  let regex: RegExp
  const slash = p.indexOf("/")
  if (slash > 0) regex = new RegExp(`^mcp__${glob(p.slice(0, slash))}__${glob(p.slice(slash + 1))}$`)
  else if (p.startsWith("mcp__")) regex = new RegExp(`^${glob(p)}$`)
  else regex = new RegExp(`^(mcp__[A-Za-z0-9_-]+__)?${glob(p)}$`)
  return [...names].filter((n) => regex.test(n))
}
