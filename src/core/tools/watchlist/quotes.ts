import type { ToolRegistry } from "../registry"

/** One row of the /watchlist panel. Fields the server did not send stay undefined. */
export interface QuoteRow {
  symbol: string
  price?: number
  changePct?: number
  volume?: number
}

export interface QuoteResult {
  rows: QuoteRow[]
  missing: string[]
  source?: string
  asOf?: string
  error?: string
}

const PRICE = ["close_price", "match_price", "last_price", "close", "price", "c"]
const CHANGE_PCT = ["percent_change", "pct_change", "change_percent", "changePercent"]
const VOLUME = ["volume_accumulated", "total_volume", "accumulated_volume", "volume", "v"]
const SYMBOL = ["symbol", "ticker", "code"]

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value)
  }
  return undefined
}

function pickText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof row[key] === "string" && row[key]) return (row[key] as string).toUpperCase()
  return undefined
}

/**
 * Read the MCP envelope of `vn_equity_quote_batch` ({data:{quotes|rows}|[...], provenance}).
 * Field names differ between upstreams, so each value is looked up under several names.
 */
export function parseQuotes(text: string, asked: string[]): QuoteResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { rows: [], missing: asked, error: text.slice(0, 200) }
  }
  const env = (parsed ?? {}) as { data?: unknown; provenance?: { source?: string; as_of?: string }; availability?: string; warnings?: string[] }
  const data = env.data as Record<string, unknown> | unknown[] | undefined
  const list = Array.isArray(data) ? data : ((data?.quotes ?? data?.rows ?? []) as unknown[])
  const rows: QuoteRow[] = []
  const missing = new Set<string>(Array.isArray(data) ? [] : ((data?.missing as string[] | undefined) ?? []))
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (Array.isArray(row._missing)) for (const m of row._missing) missing.add(String(m))
    const symbol = pickText(row, SYMBOL)
    if (!symbol) continue
    rows.push({ symbol, price: pick(row, PRICE), changePct: pick(row, CHANGE_PCT), volume: pick(row, VOLUME) })
  }
  const seen = new Set(rows.map((r) => r.symbol))
  for (const s of asked) if (!seen.has(s)) missing.add(s)
  return {
    rows,
    missing: [...missing].filter((s) => !seen.has(s)),
    source: env.provenance?.source,
    asOf: env.provenance?.as_of,
    error: env.availability === "unavailable" ? (env.warnings?.join("; ") ?? "nguồn không khả dụng") : undefined,
  }
}

/** The MCP quote tool, whatever the server is named (`mcp__<server>__vn_equity_quote_batch`). */
export function quoteTool(registry: ToolRegistry) {
  return registry.list().find((t) => t.source?.startsWith("mcp:") && t.name.endsWith("__vn_equity_quote_batch"))
}

/**
 * Quotes for the /watchlist panel: the user's own read, not the model's, so it calls the
 * registered MCP tool directly (same connection, retries and waits as a model call).
 */
export async function fetchQuotes(registry: ToolRegistry, symbols: string[], signal: AbortSignal): Promise<QuoteResult> {
  if (symbols.length === 0) return { rows: [], missing: [] }
  const tool = quoteTool(registry)
  if (!tool) return { rows: [], missing: symbols, error: "Chưa kết nối MCP server có vn_equity_quote_batch (xem /mcp)." }
  try {
    const out = await tool.execute({ symbols }, { signal, callId: "watchlist-panel" })
    return parseQuotes(typeof out === "string" ? out : out.output, symbols)
  } catch (error) {
    return { rows: [], missing: symbols, error: error instanceof Error ? error.message : String(error) }
  }
}
