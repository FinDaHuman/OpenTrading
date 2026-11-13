/**
 * OpenRouter provider routing (openrouter.ai/docs/features/provider-routing). One model id on
 * OpenRouter is served by many providers at different quantizations and prices, and by default
 * OpenRouter picks one per request and falls back to another on errors. Pinning keeps every
 * request of a run on the same provider. Keys are OpenRouter's own (snake_case), so a block
 * can be copied from their docs; they go to the request body as `provider`.
 */
export interface OpenRouterRouting {
  order?: string[]
  only?: string[]
  ignore?: string[]
  allow_fallbacks?: boolean
  require_parameters?: boolean
  quantizations?: string[]
  data_collection?: "allow" | "deny"
  sort?: "price" | "throughput" | "latency"
  zdr?: boolean
  max_price?: { prompt?: number | string; completion?: number | string; image?: number | string; audio?: number | string; request?: number | string }
}

/** config.json `openrouter.routing`: model id → routing; `"*"` applies to every OpenRouter model. */
export type OpenRouterRoutingConfig = Record<string, unknown>

/** The key of the block that applies to every OpenRouter model. */
export const ANY_MODEL = "*"

const LISTS = ["order", "only", "ignore", "quantizations"] as const
const FLAGS = ["allow_fallbacks", "require_parameters", "zdr"] as const
const PRICES = ["prompt", "completion", "image", "audio", "request"] as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The valid part of one routing block. config.json is edited by hand, so a wrong value is
 * dropped rather than sent: OpenRouter would refuse the whole request for it.
 */
export function cleanRouting(raw: unknown): OpenRouterRouting {
  if (!isRecord(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const key of LISTS) {
    const value = raw[key]
    if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
      if (items.length > 0) out[key] = items
    }
  }
  for (const key of FLAGS) if (typeof raw[key] === "boolean") out[key] = raw[key]
  if (raw.data_collection === "allow" || raw.data_collection === "deny") out.data_collection = raw.data_collection
  if (raw.sort === "price" || raw.sort === "throughput" || raw.sort === "latency") out.sort = raw.sort
  if (isRecord(raw.max_price)) {
    const price: Record<string, number | string> = {}
    for (const key of PRICES) {
      const value = raw.max_price[key]
      if ((typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.trim() !== "")) price[key] = value
    }
    if (Object.keys(price).length > 0) out.max_price = price
  }
  return out as OpenRouterRouting
}

/**
 * The routing for `modelId`: the `"*"` block, then the model's own block on top (a key set
 * for the model wins). Undefined when nothing applies.
 */
export function routingFor(config: { openrouter?: { routing?: OpenRouterRoutingConfig } }, modelId: string): OpenRouterRouting | undefined {
  const table = config.openrouter?.routing
  if (!isRecord(table)) return undefined
  const merged = { ...cleanRouting(table[ANY_MODEL]), ...cleanRouting(table[modelId]) }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/** One line for logs and the eval plan, e.g. `order deepseek · không fallback · fp8`. */
export function describeRouting(routing: OpenRouterRouting | undefined): string {
  if (!routing) return "không ghim"
  const parts: string[] = []
  if (routing.order) parts.push(`order ${routing.order.join(",")}`)
  if (routing.only) parts.push(`only ${routing.only.join(",")}`)
  if (routing.ignore) parts.push(`ignore ${routing.ignore.join(",")}`)
  if (routing.allow_fallbacks === false) parts.push("không fallback")
  if (routing.quantizations) parts.push(routing.quantizations.join(","))
  if (routing.sort) parts.push(`sort ${routing.sort}`)
  if (routing.require_parameters) parts.push("require_parameters")
  if (routing.zdr) parts.push("zdr")
  if (routing.data_collection) parts.push(`data_collection ${routing.data_collection}`)
  if (routing.max_price) parts.push("max_price")
  return parts.join(" · ") || "không ghim"
}
