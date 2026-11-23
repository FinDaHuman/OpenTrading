import { parseResult } from "./refs"

/**
 * What a data server's envelope says about its numbers, for code to act on. `as_of` is left out
 * on purpose: it is when the result was fetched, and a model citing it dates the data wrongly
 * (net-dates.ts). `data_time` is the newest data point, but the server sends it for some tools
 * only, and may send a cache time instead.
 */
export interface EnvelopeFacts {
  /** Field name (lower case) → unit, in the server's words. */
  units: Map<string, string>
  source?: string
  dataTime?: string
}

const MAX_FACT_CHARS = 40

/** Only short plain text: this goes into a line the harness writes. */
const fact = (value: unknown) => (typeof value === "string" && value && value.length <= MAX_FACT_CHARS && !/[\n[\]]/.test(value) ? value : undefined)

const MAX_UNIT_CHARS = 80

/**
 * The envelope's `units` of an already parsed result. A unit can reach a line the harness writes
 * (chart_render's unit note, #329), so only short plain text is kept, as `fact` does.
 */
export function unitsOf(parsed: unknown): Map<string, string> {
  const units = new Map<string, string>()
  const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { units?: unknown }).units : undefined
  // Keys hold several fields: "o, h, l, c": "nghìn đồng/cổ phiếu (64,27 = 64.270 đ)".
  for (const [names, unit] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    if (typeof unit !== "string" || !unit.trim() || unit.length > MAX_UNIT_CHARS || /[\p{Cc}\p{Cf}[\]"`]/u.test(unit)) continue
    for (const name of names.split(",")) units.set(name.trim().toLowerCase(), unit)
  }
  return units
}

export function readEnvelope(text: string): EnvelopeFacts | undefined {
  const parsed = parseResult(text)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const env = parsed as { provenance?: { source?: unknown; data_time?: unknown } | null }
  const units = unitsOf(parsed)
  const source = fact(env.provenance?.source)
  const dataTime = fact(env.provenance?.data_time)
  return { units, ...(source ? { source } : {}), ...(dataTime ? { dataTime } : {}) }
}
