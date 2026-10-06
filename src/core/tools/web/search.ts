import { z } from "zod"
import type { ToolDef } from "../types"

export type WebSearchInput = {
  query: string
  numResults?: number
}

type Hit = { title?: string; url?: string; text?: string }

const TIMEOUT_MS = 25_000

/**
 * opencode-style web_search without a paid key: Exa when EXA_API_KEY is set, then Parallel
 * (PARALLEL_API_KEY), then DuckDuckGo's HTML page. Returns title + URL + snippet so the
 * model can read further with web_fetch.
 */
export function webSearchTool(): ToolDef<WebSearchInput> {
  return {
    name: "web_search",
    description:
      "Tìm kiếm web theo từ khoá, trả về tiêu đề + URL + đoạn trích (mặc định 8 kết quả). Dùng khi cần tin tức/sự kiện mà tool dữ liệu MCP không có. Đọc nội dung bằng web_fetch sau đó.",
    input: z.object({
      query: z.string().min(1).describe("Từ khoá tìm kiếm"),
      numResults: z.number().int().min(1).max(20).optional().describe("Số kết quả (mặc định 8, tối đa 20)"),
    }),
    readOnly: true,
    summarize: (input) => `web_search(${input.query.slice(0, 40)})`,
    async execute(input, ctx) {
      const n = input.numResults ?? 8
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)])
      if (process.env.EXA_API_KEY) return searchExa(input.query, n, process.env.EXA_API_KEY, signal)
      if (process.env.PARALLEL_API_KEY) return searchParallel(input.query, n, process.env.PARALLEL_API_KEY, signal)
      return searchDuckDuckGo(input.query, n, signal)
    },
  }
}

async function searchExa(query: string, n: number, key: string, signal: AbortSignal): Promise<string> {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query, numResults: n }),
  })
  if (!res.ok) throw new Error(`Exa HTTP ${res.status}`)
  const data = (await res.json()) as { results?: Hit[] }
  return formatResults(data.results ?? [], "exa")
}

async function searchParallel(query: string, n: number, key: string, signal: AbortSignal): Promise<string> {
  const res = await fetch("https://api.parallel.ai/v1beta/search", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ objective: query, search_queries: [query], top_k: n }),
  })
  if (!res.ok) throw new Error(`Parallel HTTP ${res.status}`)
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] }
  return formatResults(
    (data.results ?? []).map((r) => ({ title: r.title, url: r.url, text: r.content })),
    "parallel",
  )
}

const RESULT = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi

/** Parse DuckDuckGo's HTML results page (exported for tests). */
export function parseDuckDuckGo(html: string, n: number): Hit[] {
  const clean = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim()
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
    items.push({ title: clean(m[2] ?? ""), url, text: clean(m[3] ?? "") })
  }
  return items
}

async function searchDuckDuckGo(query: string, n: number, signal: AbortSignal): Promise<string> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    signal,
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
  })
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status} (có thể bị chặn; đặt EXA_API_KEY hoặc PARALLEL_API_KEY để ổn định hơn)`)
  const items = parseDuckDuckGo(await res.text(), n)
  if (items.length === 0) throw new Error("DuckDuckGo không trả kết quả đọc được; đặt EXA_API_KEY hoặc PARALLEL_API_KEY để ổn định hơn.")
  return formatResults(items, "duckduckgo")
}

function formatResults(items: Hit[], source: string): string {
  const lines = items.map((r, i) => `${i + 1}. ${r.title || "(không tiêu đề)"}\n   ${r.url || ""}\n   ${(r.text || "").slice(0, 300)}`)
  return `Nguồn tìm kiếm: ${source}\n${lines.join("\n")}`
}
