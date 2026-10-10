import { LRUCache } from "lru-cache"
import { z } from "zod"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import { cleanDomains, hostMatches, PRESETS, type Preset } from "./domains"
import { nativeSearch, webTarget, type NativeSearch } from "./side-model"

/**
 * web_search at the level of Claude Code's WebSearch and Codex's web.run:
 * - the provider's own search first (Gemini grounding, Anthropic web_search, OpenAI
 *   Responses web_search) in a side call, then keyed APIs (Exa, Parallel, Tavily, Brave),
 *   then DuckDuckGo's HTML page;
 * - domain allow/block lists and Vietnamese presets, a recency window;
 * - numbered results with domain and date, and a reminder to cite sources next to claims
 *   (Codex) with a closing source list (Claude Code).
 */

export type WebSearchInput = {
  query: string
  allowed_domains?: string[]
  blocked_domains?: string[]
  preset?: Preset
  recency_days?: number
  num_results?: number
}

export interface Hit {
  title?: string
  url: string
  snippet?: string
  date?: string
}

const TIMEOUT_MS = 30_000
const cache = new LRUCache<string, string>({ max: 100, ttl: 5 * 60_000 })

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

export interface SearchPlan {
  query: string
  n: number
  allowed: string[]
  blocked: string[]
  /** ISO date: results published on or after it. */
  since?: string
}

export function planSearch(input: WebSearchInput, now = new Date()): SearchPlan {
  if ((input.allowed_domains?.length ?? 0) > 0 && (input.blocked_domains?.length ?? 0) > 0) {
    throw new Error("Không truyền cùng lúc allowed_domains và blocked_domains.")
  }
  const allowed = [...new Set([...cleanDomains(input.allowed_domains), ...(input.preset ? PRESETS[input.preset] : [])])]
  const since = input.recency_days ? new Date(now.getTime() - input.recency_days * 86_400_000).toISOString().slice(0, 10) : undefined
  return { query: input.query.trim(), n: input.num_results ?? 8, allowed, blocked: cleanDomains(input.blocked_domains), since }
}

/** `site:` operators for backends without a domain filter (Brave, DuckDuckGo, Gemini). */
export function withSiteOperators(plan: SearchPlan) {
  const allow = plan.allowed.length > 0 ? ` (${plan.allowed.map((d) => `site:${d}`).join(" OR ")})` : ""
  const block = plan.blocked.map((d) => ` -site:${d}`).join("")
  return `${plan.query}${allow}${block}`
}

/** Drop hits outside the allow list or inside the block list (backends do not all honour them). */
export function filterHits(hits: Hit[], plan: SearchPlan) {
  return hits.filter((h) => {
    const host = hostOf(h.url)
    if (!host) return false
    if (plan.allowed.length > 0 && !plan.allowed.some((d) => hostMatches(host, d))) return false
    return !plan.blocked.some((d) => hostMatches(host, d))
  })
}

type Backend = { name: string; run: (plan: SearchPlan, signal: AbortSignal) => Promise<Hit[]> }

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal) {
  const res = await fetch(url, { method: "POST", signal, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${new URL(url).hostname} HTTP ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

export const BACKENDS: Record<string, (key: string) => Backend> = {
  exa: (key) => ({
    name: "exa",
    async run(plan, signal) {
      const data = await postJson(
        "https://api.exa.ai/search",
        {
          query: plan.query,
          numResults: plan.n,
          type: "auto",
          contents: { highlights: { numSentences: 3 }, text: { maxCharacters: 600 } },
          ...(plan.allowed.length ? { includeDomains: plan.allowed } : {}),
          ...(plan.blocked.length ? { excludeDomains: plan.blocked } : {}),
          ...(plan.since ? { startPublishedDate: `${plan.since}T00:00:00.000Z` } : {}),
        },
        { "x-api-key": key },
        signal,
      )
      return ((data.results as Record<string, unknown>[]) ?? []).map((r) => ({
        title: str(r.title),
        url: String(r.url ?? ""),
        snippet: (Array.isArray(r.highlights) ? (r.highlights as string[]).join(" … ") : undefined) ?? str(r.text),
        date: str(r.publishedDate)?.slice(0, 10),
      }))
    },
  }),
  parallel: (key) => ({
    name: "parallel",
    async run(plan, signal) {
      const data = await postJson(
        "https://api.parallel.ai/v1beta/search",
        {
          objective: plan.query,
          search_queries: [plan.query],
          max_results: plan.n,
          ...(plan.allowed.length || plan.blocked.length
            ? { source_policy: { ...(plan.allowed.length ? { include_domains: plan.allowed } : {}), ...(plan.blocked.length ? { exclude_domains: plan.blocked } : {}) } }
            : {}),
        },
        { "x-api-key": key },
        signal,
      )
      return ((data.results as Record<string, unknown>[]) ?? []).map((r) => ({
        title: str(r.title),
        url: String(r.url ?? ""),
        snippet: (Array.isArray(r.excerpts) ? (r.excerpts as string[]).join(" … ") : undefined) ?? str(r.content),
        date: str(r.publish_date)?.slice(0, 10),
      }))
    },
  }),
  tavily: (key) => ({
    name: "tavily",
    async run(plan, signal) {
      const days = plan.since ? Math.max(1, Math.round((Date.now() - Date.parse(plan.since)) / 86_400_000)) : undefined
      const data = await postJson(
        "https://api.tavily.com/search",
        {
          query: plan.query,
          max_results: plan.n,
          search_depth: "basic",
          ...(days ? { topic: "news", days } : {}),
          ...(plan.allowed.length ? { include_domains: plan.allowed } : {}),
          ...(plan.blocked.length ? { exclude_domains: plan.blocked } : {}),
        },
        { Authorization: `Bearer ${key}` },
        signal,
      )
      return ((data.results as Record<string, unknown>[]) ?? []).map((r) => ({
        title: str(r.title),
        url: String(r.url ?? ""),
        snippet: str(r.content),
        date: str(r.published_date)?.slice(0, 10),
      }))
    },
  }),
  brave: (key) => ({
    name: "brave",
    async run(plan, signal) {
      const days = plan.since ? (Date.now() - Date.parse(plan.since)) / 86_400_000 : undefined
      const freshness = days === undefined ? "" : days <= 1 ? "&freshness=pd" : days <= 7 ? "&freshness=pw" : days <= 31 ? "&freshness=pm" : "&freshness=py"
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(withSiteOperators(plan))}&count=${Math.min(plan.n, 20)}${freshness}`
      const res = await fetch(url, { signal, headers: { Accept: "application/json", "X-Subscription-Token": key } })
      if (!res.ok) throw new Error(`Brave HTTP ${res.status}`)
      const data = (await res.json()) as { web?: { results?: Record<string, unknown>[] } }
      return (data.web?.results ?? []).map((r) => ({
        title: str(r.title)?.replace(/<[^>]+>/g, ""),
        url: String(r.url ?? ""),
        snippet: str(r.description)?.replace(/<[^>]+>/g, ""),
        date: str(r.page_age)?.slice(0, 10) ?? str(r.age),
      }))
    },
  }),
}

const RESULT = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi

/** Parse DuckDuckGo's HTML results page (exported for tests). */
export function parseDuckDuckGo(html: string, n: number): Hit[] {
  const clean = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .trim()
  const items: Hit[] = []
  for (const m of html.matchAll(RESULT)) {
    if (items.length >= n) break
    let url = clean(m[1] ?? "")
    const redirect = url.match(/uddg=([^&]+)/)
    if (redirect) {
      try {
        url = decodeURIComponent(redirect[1]!)
      } catch {
        // keep the redirect URL
      }
    }
    items.push({ title: clean(m[2] ?? ""), url, snippet: clean(m[3] ?? "") })
  }
  return items
}

const duckduckgo: Backend = {
  name: "duckduckgo",
  async run(plan, signal) {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(withSiteOperators(plan))}&kl=vn-vi`, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36" },
    })
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`)
    const items = parseDuckDuckGo(await res.text(), plan.n)
    if (items.length === 0) throw new Error("DuckDuckGo không trả kết quả đọc được (có thể bị chặn)")
    return items
  },
}

/** Keyed backends whose key is set, in order, then DuckDuckGo. */
export function keyedBackends(env: Record<string, string | undefined> = process.env): Backend[] {
  const list: Backend[] = []
  if (env.EXA_API_KEY) list.push(BACKENDS.exa!(env.EXA_API_KEY))
  if (env.PARALLEL_API_KEY) list.push(BACKENDS.parallel!(env.PARALLEL_API_KEY))
  if (env.TAVILY_API_KEY) list.push(BACKENDS.tavily!(env.TAVILY_API_KEY))
  if (env.BRAVE_API_KEY ?? env.BRAVE_SEARCH_API_KEY) list.push(BACKENDS.brave!((env.BRAVE_API_KEY ?? env.BRAVE_SEARCH_API_KEY)!))
  list.push(duckduckgo)
  return list
}

const CITE =
  'NHẮC: trích nguồn bằng link markdown [Tiêu đề](URL) ngay cạnh số liệu/khẳng định lấy từ kết quả; cuối câu trả lời có mục "Nguồn:". Ghi ngày đăng với tin tức. Giá và chỉ số thị trường kiểm lại bằng tool dữ liệu MCP khi có.'

export function formatResults(query: string, backend: string, hits: Hit[], summary?: string, notes: string[] = []) {
  const day = new Date().toISOString().slice(0, 10)
  const lines = hits.map((h, i) => {
    const meta = [hostOf(h.url), h.date].filter(Boolean).join(" — ")
    const snippet = h.snippet ? `\n    ${h.snippet.replace(/\s+/g, " ").slice(0, 300)}` : ""
    return `[${i + 1}] ${h.title || "(không tiêu đề)"}${meta ? ` — ${meta}` : ""}\n    ${h.url}${snippet}`
  })
  return [
    `Kết quả tìm kiếm "${query}" (nguồn: ${backend} · ${day})`,
    ...notes,
    ...lines,
    ...(summary ? ["", `Tóm tắt của bộ tìm kiếm: ${summary.slice(0, 1500)}`] : []),
    "",
    CITE,
  ].join("\n")
}

export interface SearchDeps {
  native?: (query: string, plan: SearchPlan, signal: AbortSignal) => Promise<NativeSearch | undefined>
  backends?: () => Backend[]
}

const defaultNative: NonNullable<SearchDeps["native"]> = async (query, plan, signal) => {
  const target = await webTarget()
  if (!target) return undefined
  // Not every native search filters domains or dates: the query carries `site:` / `after:`
  // operators too, and the sources are filtered again afterwards.
  const base = plan.allowed.length || plan.blocked.length ? withSiteOperators(plan) : query
  const q = plan.since ? `${base} after:${plan.since}` : base
  return nativeSearch(q, target, { allowed: plan.allowed, blocked: plan.blocked }, signal)
}

export async function runSearch(input: WebSearchInput, signal: AbortSignal, deps: SearchDeps = {}): Promise<string> {
  const plan = planSearch(input)
  const key = JSON.stringify(plan)
  const cached = cache.get(key)
  if (cached) return `${cached}\n(kết quả lưu trong 5 phút)`
  const failures: string[] = []
  const native = await (deps.native ?? defaultNative)(plan.query, plan, signal).catch((error: unknown) => {
    failures.push(`tìm kiếm của model: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`)
    return undefined
  })
  if (native && native.sources.length > 0) {
    const hits = filterHits(native.sources.map((s) => ({ title: s.title, url: s.url })), plan).slice(0, plan.n)
    if (hits.length > 0 || plan.allowed.length === 0) {
      const out = formatResults(plan.query, native.backend, hits, native.text)
      cache.set(key, out)
      return out
    }
  }
  for (const backend of (deps.backends ?? keyedBackends)()) {
    try {
      const hits = filterHits(await backend.run(plan, signal), plan).slice(0, plan.n)
      if (hits.length === 0) {
        failures.push(`${backend.name}: không có kết quả`)
        continue
      }
      const notes = failures.length > 0 ? [`(đã thử: ${failures.join("; ")})`] : []
      const out = formatResults(plan.query, backend.name, hits, undefined, notes)
      cache.set(key, out)
      return out
    } catch (error) {
      if (signal.aborted) throw error
      failures.push(`${backend.name}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`)
    }
  }
  throw new Error(
    `Không tìm được kết quả cho "${plan.query}". Đã thử: ${failures.join("; ")}. Đặt EXA_API_KEY, TAVILY_API_KEY hoặc BRAVE_API_KEY để tìm ổn định hơn, hoặc nới lọc domain/ngày.`,
  )
}

export function webSearchTool(deps: SearchDeps = {}): ToolDef<WebSearchInput> {
  const month = new Date().toISOString().slice(0, 7)
  return {
    name: "web_search",
    description:
      `Tìm kiếm web (tin tức, công bố, sự kiện, tài liệu) — trả về danh sách kết quả đánh số có tiêu đề, URL, domain, ngày đăng, đoạn trích. Tháng hiện tại: ${month}; dùng đúng năm hiện tại khi tìm tin mới. ` +
      "Giá, chỉ số, lãi suất, nhân sự doanh nghiệp có thể đã đổi: phải tìm, không nhớ; nhưng số liệu thị trường ưu tiên tool dữ liệu MCP. Ưu tiên nguồn gốc (HOSE/HNX, SBV, GSO, trang IR doanh nghiệp). " +
      "preset vn_finance / vn_news / vn_official để giới hạn nguồn Việt Nam; recency_days cho tin mới. Đọc chi tiết một kết quả bằng web_fetch. Trong câu trả lời: trích nguồn bằng link markdown cạnh khẳng định, cuối có mục \"Nguồn:\".",
    input: z.object({
      query: z.string().min(2).describe("Câu truy vấn"),
      allowed_domains: z.array(z.string()).max(20).optional().describe("Chỉ lấy kết quả từ các domain này, ví dụ [\"cafef.vn\"]"),
      blocked_domains: z.array(z.string()).max(20).optional().describe("Loại kết quả từ các domain này (không dùng cùng allowed_domains)"),
      preset: z.enum(["vn_finance", "vn_news", "vn_official"]).optional().describe("Nhóm nguồn Việt Nam: tài chính, báo chí, cơ quan nhà nước"),
      recency_days: z.number().int().min(1).max(3650).optional().describe("Chỉ kết quả trong N ngày gần đây"),
      num_results: z.number().int().min(1).max(20).optional().describe("Số kết quả (mặc định 8)"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    timeoutMs: 60_000,
    summarize: (input) => `web_search "${input.query.slice(0, 50)}"${input.preset ? ` · ${input.preset}` : ""}${input.recency_days ? ` · ${input.recency_days} ngày` : ""}`,
    execute: (input, ctx) => runSearch(input, AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)]), deps),
  }
}

/** Tests only. */
export const clearSearchCache = () => cache.clear()
