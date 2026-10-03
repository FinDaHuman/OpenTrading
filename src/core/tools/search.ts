import type { JSONSchema7 } from "@ai-sdk/provider"
import { sanitize, serverPrefix } from "../mcp/naming"
import { fold } from "../skills/catalog"
import type { ToolRegistry } from "./registry"
import type { ToolDef } from "./types"

/**
 * Tool search over deferred tools (Claude Code's ToolSearch, made provider-agnostic):
 * `select:a,b` picks by name, otherwise keywords are scored against name parts, search
 * hints, descriptions and parameter names (Codex indexes those too). Matching ignores
 * Vietnamese diacritics.
 */

/** First line of every tool_search / load_skill result that made tools callable. */
export const LOADED_PREFIX = "Đã nạp tool: "

const words = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(Boolean)

/** `mcp__server__vn_quote_history` → [server, vn, quote, history]. */
function nameParts(name: string) {
  return words(name.replace(/^mcp__/, "").replace(/__/g, " ").replace(/[_-]/g, " "))
}

function paramNames(schema: JSONSchema7): string[] {
  const props = schema.properties ?? {}
  return Object.keys(props).flatMap((k) => [k, ...words(k.replace(/[_-]/g, " "))])
}

/**
 * Full names for what a model wrote: the full name itself, `server/tool`, or just the tool
 * name an MCP server uses (as listed in <tool_hoan>). Several matches = ambiguous.
 */
export function resolveToolName(registry: ToolRegistry, raw: string): string[] {
  const name = raw.trim()
  if (!name) return []
  if (registry.get(name)) return [name]
  const slash = name.indexOf("/")
  if (slash > 0) {
    const full = serverPrefix(name.slice(0, slash)) + sanitize(name.slice(slash + 1))
    return registry.get(full) ? [full] : []
  }
  const suffix = `__${sanitize(name)}`
  return registry
    .list()
    .filter((d) => d.name.startsWith("mcp__") && d.name.endsWith(suffix))
    .map((d) => d.name)
}

export interface SearchHit {
  def: ToolDef
  score: number
}

/**
 * Vietnamese market terms (without diacritics) → the English words MCP tools are usually
 * described in, so "lịch sử giá" finds `*_history` tools. Longest phrase wins.
 */
const SYNONYMS: Record<string, string[]> = {
  "lich su gia": ["price", "history", "ohlcv"],
  "lich su": ["history"],
  "gia": ["price", "quote"],
  "nen": ["candles", "ohlcv"],
  "khoi ngoai": ["foreign"],
  "nuoc ngoai": ["foreign"],
  "tu doanh": ["proprietary", "selftrading"],
  "dong tien": ["flow", "money"],
  "bao cao tai chinh": ["financial", "statements"],
  "bctc": ["financial", "statements"],
  "tai chinh": ["financial"],
  "chi so tai chinh": ["ratios"],
  "co tuc": ["dividends"],
  "tin tuc": ["news"],
  "tin": ["news"],
  "vang": ["gold"],
  "ty gia": ["fx", "currency"],
  "chi so": ["index", "indices"],
  "nganh": ["sector", "industry"],
  "loc co phieu": ["screener"],
  "loc": ["screener", "screen"],
  "ky thuat": ["technical", "signals"],
  "dinh gia": ["valuation"],
  "co dong": ["holders"],
  "phai sinh": ["futures", "derivative"],
  "vi mo": ["macro"],
  "lai suat": ["rates"],
  "su kien": ["events", "calendar"],
  "lich": ["calendar"],
  "so lenh": ["orderbook"],
  "danh muc": ["portfolio", "watchlist"],
  "canh bao": ["alert"],
  "doanh nghiep": ["company"],
  "cong ty": ["company"],
  "the gioi": ["world", "global"],
  "tien so": ["crypto"],
}
const PHRASES = Object.keys(SYNONYMS).sort((a, b) => b.split(" ").length - a.split(" ").length)

/** English equivalents for Vietnamese phrases in a (folded) query. */
export function expandQuery(folded: string[]): string[] {
  const extra: string[] = []
  let text = ` ${folded.join(" ")} `
  for (const phrase of PHRASES) {
    if (!text.includes(` ${phrase} `)) continue
    extra.push(...SYNONYMS[phrase]!)
    text = text.replace(` ${phrase} `, " ")
  }
  return extra
}

/** Rank `candidates` for a keyword query; `+term` must match somewhere. */
export function scoreTools(registry: ToolRegistry, candidates: ToolDef[], query: string): SearchHit[] {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  const required = terms.filter((t) => t.startsWith("+") && t.length > 1).flatMap((t) => words(t.slice(1)))
  const plain = terms.filter((t) => !t.startsWith("+")).flatMap(words)
  const optional = [...plain, ...expandQuery([...required, ...plain])]
  const all = [...required, ...optional]
  if (all.length === 0) return []

  const hits: SearchHit[] = []
  for (const def of candidates) {
    const parts = nameParts(def.name)
    const hint = new Set(words(def.searchHint ?? ""))
    const desc = new Set(words(def.description))
    const params = new Set(paramNames(registry.jsonSchemaFor(def)))
    const termScore = (term: string) => {
      let s = 0
      if (parts.includes(term)) s += 12
      // Partial matches only for 3+ letters: "co"/"gia" would hit half the catalog.
      else if (term.length >= 3 && parts.some((p) => p.includes(term) || (p.length >= 3 && term.startsWith(p)))) s += 6
      if (hint.has(term)) s += 4
      if (desc.has(term)) s += 2
      if (params.has(term)) s += 2
      return s
    }
    if (required.some((t) => termScore(t) === 0)) continue
    const score = all.reduce((sum, t) => sum + termScore(t), 0)
    if (score > 0) hits.push({ def, score })
  }
  return hits.sort((a, b) => b.score - a.score || a.def.name.localeCompare(b.def.name))
}

const clip = (text: string, max: number) => {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > max ? one.slice(0, max - 1) + "…" : one
}

function typeOf(schema: JSONSchema7): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum.slice(0, 8).map((v: unknown) => JSON.stringify(v))
    return values.join("|") + (schema.enum.length > 8 ? "|…" : "")
  }
  if (Array.isArray(schema.type)) return schema.type.join("|")
  if (schema.type === "array" && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    return `${typeOf(schema.items as JSONSchema7)}[]`
  }
  if (schema.type) return String(schema.type)
  const union = (schema.anyOf ?? schema.oneOf) as JSONSchema7[] | undefined
  if (union) return union.map((s) => (typeof s === "object" ? typeOf(s) : "?")).join("|")
  return "any"
}

/** Name, description and a compact parameter list: enough for the model to call the tool. */
export function describeTool(registry: ToolRegistry, def: ToolDef) {
  const schema = registry.jsonSchemaFor(def)
  const required = new Set(schema.required ?? [])
  const params = Object.entries(schema.properties ?? {}).map(([name, raw]) => {
    const p = (typeof raw === "object" ? raw : {}) as JSONSchema7
    const bits = [typeOf(p), required.has(name) ? "bắt buộc" : undefined, p.default !== undefined ? `mặc định ${JSON.stringify(p.default)}` : undefined]
    const note = p.description ? ` — ${clip(p.description, 80)}` : ""
    return `- ${name} (${bits.filter(Boolean).join(", ")})${note}`
  })
  return [`## ${def.name}`, clip(def.description, 400), params.length > 0 ? `Tham số:\n${params.join("\n")}` : "Không có tham số."].join("\n")
}
