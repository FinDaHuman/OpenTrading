import { parseResult } from "./refs"

/**
 * What a data server's envelope says about its numbers, for code to act on. `as_of` is left out
 * on purpose: it is when the result was fetched, and a model citing it dates the data wrongly
 * (net-dates.ts). `data_time` is the newest data point, but the server sends it for some tools
 * only, and may send a cache time instead.
 */
export interface EnvelopeFacts {
  /** Field name → unit, in the server's words. */
  units: Map<string, string>
  source?: string
  dataTime?: string
}

const MAX_FACT_CHARS = 40

/** Only short plain text: this goes into a line the harness writes. */
const fact = (value: unknown) => (typeof value === "string" && value && value.length <= MAX_FACT_CHARS && !/[\n[\]]/.test(value) ? value : undefined)

export function readEnvelope(text: string): EnvelopeFacts | undefined {
  const parsed = parseResult(text)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const env = parsed as { units?: unknown; provenance?: { source?: unknown; data_time?: unknown } | null }
  const units = new Map<string, string>()
  // Keys hold several fields: "o, h, l, c": "nghìn đồng/cổ phiếu (64,27 = 64.270 đ)".
  for (const [names, unit] of Object.entries(env.units && typeof env.units === "object" ? env.units : {})) {
    if (typeof unit === "string") for (const name of names.split(",")) units.set(name.trim(), unit)
  }
  const source = fact(env.provenance?.source)
  const dataTime = fact(env.provenance?.data_time)
  return { units, ...(source ? { source } : {}), ...(dataTime ? { dataTime } : {}) }
}
