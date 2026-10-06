import { z } from "zod"
import type { ToolDef } from "../types"

export type WebSearchInput = {
  query: string
  numResults?: number
}

/**
 * web_search kiểu opencode nhưng không phụ thuộc key trả phí:
 * EXA_API_KEY -> Exa, PARALLEL_API_KEY -> Parallel, cuối cùng DuckDuckGo HTML (không key).
 * Trả về danh sách {title, url, snippet} để model gọi web_fetch đọc tiếp.
 */
export function webSearchTool(): ToolDef<WebSearchInput> {
  return {
    name: "web_search",
    description:
      "Tìm kiếm web theo từ khóa, trả về tiêu đề + URL + đoạn trích (mặc định 8). Dùng khi cần tin tức/sự kiện ngoài MCP data. Đọc nội dung bằng web_fetch sau đó.",
    input: z.object({
      query: z.string().min(1).describe("Từ khóa tìm kiếm"),
      numResults: z.number().int().min(1).max(20).optional().describe("Số kết quả (mặc định 8, tối đa 20)"),
    }),
    readOnly: true,
    summarize: (input) => `web_search(${(input as { query: string }).query.slice(0, 40)})`,
    async execute(input) {
      const n = Math.min(input.numResults ?? 8, 20)
      if (process.env.EXA_API_KEY) return searchExa(input.query, n, process.env.EXA_API_KEY)
      if (process.env.PARALLEL_API_KEY) return searchParallel(input.query, n, process.env.PARALLEL_API_KEY)
      return searchDuckDuckGo(input.query, n)
    },
  }
}

async function searchExa(query: string, n: number, key: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, numResults: n }),
    })
    if (!res.ok) throw new Error(`Exa HTTP ${res.status}`)
    const data = (await res.json()) as { results?: { title?: string; url?: string; text?: string }[] };
    return formatResults(data.results ?? [], "exa");
  } finally {
    clearTimeout(timer)
  }
}

async function searchParallel(query: string, n: number, key: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch("https://api.parallel.ai/v1beta/search", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ objective: query, search_queries: [query], top_k: n }),
    })
    if (!res.ok) throw new Error(`Parallel HTTP ${res.status}`)
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return formatResults(
      (data.results ?? []).map((r) => ({ title: r.title, url: r.url, text: r.content })),
      "parallel",
    );
  } finally {
    clearTimeout(timer)
  }
}

async function searchDuckDuckGo(query: string, n: number): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
    })
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status} (có thể bị chặn — hãy đặt EXA_API_KEY hoặc PARALLEL_API_KEY)`)
    const html = await res.text()
    const items: { title?: string; url?: string; text?: string }[] = []
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null && items.length < n) {
      const clean = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim()
      let url = clean(m[1] ?? "")
      const ud = url.match(/uddg=([^&]+)/)
      if (ud) {
        try {
          url = decodeURIComponent(ud[1]!)
        } catch {
          /* giữ nguyên */
        }
      }
      items.push({ title: clean(m[2] ?? ""), url, text: clean(m[3] ?? "") })
    }
    if (items.length === 0) throw new Error("DuckDuckGo không trả kết quả parse được — hãy đặt EXA_API_KEY hoặc PARALLEL_API_KEY")
    return formatResults(items, "duckduckgo (không key — nên đặt EXA_API_KEY để ổn định)")
  } finally {
    clearTimeout(timer)
  }
}

function formatResults(items: { title?: string; url?: string; text?: string }[], source: string): string {
  const lines = items.map(
    (r, i) => `${i + 1}. ${r.title || "(không tiêu đề)"}\n   ${r.url || ""}\n   ${(r.text || "").slice(0, 300)}`,
  )
  return `Nguồn tìm kiếm: ${source}\n${lines.join("\n")}`
}
