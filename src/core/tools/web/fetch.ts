import { z } from "zod"
import type { ToolDef } from "../types"

const MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * web_fetch kiểu opencode: tải URL về text/markdown/html, cap 2MB, timeout 30s.
 * Không cần API key. Log stderr thay vì stdout (giữ đúng quy ước MCP stdio).
 */
export function webFetchTool(): ToolDef<{ url: string; format?: "text" | "markdown" | "html"; timeoutSeconds?: number }> {
  return {
    name: "web_fetch",
    description:
      "Tải nội dung 1 URL về text (mặc định), markdown hoặc html thô. Dùng để đọc bài báo, công bố, tài liệu khi đã có link từ web_search/news. Không dùng để search (dùng web_search).",
    input: z.object({
      url: z.string().min(1).describe("URL http(s) cần tải"),
      format: z.enum(["text", "markdown", "html"]).optional().describe("Định dạng trả về (mặc định text)"),
      timeoutSeconds: z.number().min(1).max(120).optional().describe("Timeout giây (mặc định 30, tối đa 120)"),
    }),
    readOnly: true,
    summarize: (input) => `web_fetch(${(input as { url: string }).url.slice(0, 50)})`,
    async execute(input) {
      const url = input.url.trim()
      if (!/^https?:\/\//i.test(url)) throw new Error("URL phải bắt đầu bằng http:// hoặc https://")
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), Math.min(input.timeoutSeconds ?? 30, 120) * 1000)
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { "User-Agent": "OpenTrading/0.1 (+market-research)", Accept: "text/html,application/xhtml+xml,text/*;q=0.9,*/*;q=0.1" },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
        const buf = await res.arrayBuffer()
        if (buf.byteLength > MAX_BYTES) throw new Error(`Trang quá lớn (${Math.round(buf.byteLength / 1024)}KB > 2048KB).`)
        const raw = new TextDecoder().decode(buf)
        const format = input.format ?? "text"
        if (format === "html") return raw.length > 60000 ? raw.slice(0, 60000) + "\n[… đã cắt bớt]" : raw
        const text = stripHtml(raw)
        if (!text.trim()) throw new Error("Trang không trích được text (có thể là JS-render hoặc PDF scan).")
        return text.length > 60000 ? text.slice(0, 60000) + "\n[… đã cắt bớt]" : text
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError")
          throw new Error(`web_fetch quá thời gian (${input.timeoutSeconds ?? 30}s): ${url}`)
        throw error instanceof Error ? error : new Error(String(error))
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export const WEB_FETCH_TIMEOUT_MS = DEFAULT_TIMEOUT_MS
