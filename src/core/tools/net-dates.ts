/**
 * ASP.NET JSON dates ("/Date(1791532464487)/", ms since epoch) as ISO 8601 in Vietnam time.
 *
 * Vietstock-backed MCP tools sent them through raw (stock_overview, financial_ratios,
 * company_events…). Models cannot read them: on 11/10 Gemini took provenance.as_of, the
 * Sunday fetch time, as the trading date of Friday's data. The server is being fixed too
 * (opentrading-mcp#10); this covers results from any server meanwhile and after.
 */

const VN_OFFSET_MS = 7 * 3_600_000
/** A whole JSON string value: "/Date(ms)/" or "/Date(ms+0700)/", slashes possibly escaped. */
const NET_DATE = /"\\?\/Date\((-?\d{1,15})(?:[+-]\d{4})?\)\\?\/"/g

const pad = (n: number) => String(n).padStart(2, "0")

/** Midnight in Vietnam → "YYYY-MM-DD"; any other time → "YYYY-MM-DDTHH:MM:SS+07:00". */
export function isoFromNetDate(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined
  const vn = new Date(ms + VN_OFFSET_MS)
  if (Number.isNaN(vn.getTime())) return undefined
  const day = `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}`
  const [h, m, s] = [vn.getUTCHours(), vn.getUTCMinutes(), vn.getUTCSeconds()]
  return h === 0 && m === 0 && s === 0 ? day : `${day}T${pad(h)}:${pad(m)}:${pad(s)}+07:00`
}

/** A moment in Vietnam time, "YYYY-MM-DDTHH:MM:SS+07:00" (web sources: when a page was read). */
export function vnStamp(ms = Date.now()): string {
  const vn = new Date(ms + VN_OFFSET_MS)
  return `${vnDay(ms)}T${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}+07:00`
}

/**
 * The day in Vietnam, "YYYY-MM-DD". Web tools used the UTC day: at 03:23 on 30/10 in Vietnam
 * a search header said "2026-10-29".
 */
export function vnDay(ms = Date.now()): string {
  const vn = new Date(ms + VN_OFFSET_MS)
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}`
}

/** Every quoted .NET date in a tool's text output, rewritten; anything else unchanged. */
export function normalizeNetDates(text: string): string {
  if (!text.includes("Date(")) return text
  return text.replace(NET_DATE, (whole, ms: string) => {
    const iso = isoFromNetDate(Number(ms))
    return iso ? `"${iso}"` : whole
  })
}
