import { LRUCache } from "lru-cache"
import { z } from "zod"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import { decodeText, htmlToMarkdown, isHtml, isPdf, isTextual, pdfToText } from "./convert"
import { isPreapproved } from "./domains"
import { checkUrl, fetchPublic, type Resolver } from "./net"
import { extractWithModel, webTarget } from "./side-model"

/**
 * web_fetch at the level of Claude Code's WebFetch: https only, private addresses refused
 * (on resolved IPs), same-site redirects followed and cross-host ones reported, HTML turned
 * into markdown (main content, links and tables kept), PDF text extracted, a 15-minute cache,
 * an optional `prompt` answered by a side model over the page, and paging with `start_char`.
 * Hosts outside the Vietnamese presets ask the user first (per domain).
 */

export type WebFetchInput = { url: string; prompt?: string; format?: "markdown" | "text" | "html"; start_char?: number; timeoutSeconds?: number }

const PAGE = 50_000
const PROMPT_INPUT = 100_000

interface Page {
  url: string
  status: number
  statusText: string
  contentType: string
  bytes: number
  fetchedAt: string
  title?: string
  markdown: string
  /** Plain text of the page (markdown without its syntax) or the raw HTML. */
  html?: string
  note?: string
}

const cache = new LRUCache<string, Page>({ maxSize: 50 * 1024 * 1024, sizeCalculation: (p) => p.markdown.length + (p.html?.length ?? 0) + 1, ttl: 15 * 60_000 })

const plain = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]{1,3}/g, "")

export interface FetchDeps {
  fetch?: typeof fetch
  resolve?: Resolver
  extract?: (content: string, prompt: string, url: string, signal: AbortSignal) => Promise<string>
}

async function load(url: URL, signal: AbortSignal, deps: FetchDeps): Promise<Page | { redirect: string; status: number }> {
  const cached = cache.get(url.href)
  if (cached) return cached
  const got = await fetchPublic(url, signal, { fetch: deps.fetch, resolve: deps.resolve })
  if (got.kind === "redirect") return { redirect: got.to.href, status: got.status }
  if (got.status >= 400) throw new Error(`HTTP ${got.status} ${got.statusText} khi tải ${got.url.href}.${got.status === 401 || got.status === 403 ? " Trang cần đăng nhập hoặc chặn bot." : ""}`)
  const base = { url: got.url.href, status: got.status, statusText: got.statusText, contentType: got.contentType.split(";")[0]!.trim(), bytes: got.bytes.byteLength, fetchedAt: new Date().toISOString().slice(0, 19) }
  let page: Page
  if (isPdf(got.contentType, got.bytes)) {
    const { text, pages } = await pdfToText(got.bytes)
    const scanned = text.length < 50 * Math.max(1, pages)
    page = {
      ...base,
      markdown: text,
      note: scanned ? `PDF ${pages} trang gần như không có lớp chữ (bản scan): không đọc được nội dung; tìm bản HTML hoặc dữ liệu qua tool MCP.` : `PDF ${pages} trang.`,
    }
  } else if (isTextual(got.contentType)) {
    const text = decodeText(got.bytes, got.contentType)
    if (isHtml(got.contentType, text)) {
      const { title, markdown, extracted } = htmlToMarkdown(text, got.url.href)
      const thin = markdown.length < 300 && text.length > 20_000
      page = {
        ...base,
        title,
        markdown,
        html: text,
        note: thin ? "Trang gần như trống sau khi lấy nội dung: có thể render bằng JavaScript; số liệu thị trường hãy lấy bằng tool dữ liệu MCP." : extracted ? undefined : "Không tách được bài chính; đây là toàn trang (đã bỏ menu/chân trang).",
      }
    } else page = { ...base, markdown: text }
  } else {
    throw new Error(`Nội dung ${got.contentType || "nhị phân"} (${Math.round(got.bytes.byteLength / 1024)}KB) không đọc được dạng chữ.`)
  }
  cache.set(url.href, page)
  return page
}

export async function runFetch(input: WebFetchInput, signal: AbortSignal, deps: FetchDeps = {}): Promise<string> {
  const url = checkUrl(input.url)
  const cachedBefore = cache.has(url.href)
  const page = await load(url, signal, deps)
  if ("redirect" in page) {
    return [
      "REDIRECT: URL chuyển hướng sang host khác.",
      `URL gốc: ${url.href}`,
      `URL chuyển tới: ${page.redirect}`,
      `Mã: ${page.status}`,
      "",
      "Muốn đọc tiếp thì gọi lại web_fetch với:",
      `- url: "${page.redirect}"`,
      ...(input.prompt ? [`- prompt: "${input.prompt}"`] : []),
    ].join("\n")
  }
  const header = `URL: ${page.url} | HTTP ${page.status} | ${page.contentType || "?"} | ${Math.max(1, Math.round(page.bytes / 1024))}KB | lấy lúc ${page.fetchedAt}${cachedBefore ? " | (cache)" : ""}${page.title ? `\nTiêu đề: ${page.title}` : ""}${page.note ? `\nGhi chú: ${page.note}` : ""}`
  const format = input.format ?? "markdown"
  const body = format === "html" ? (page.html ?? page.markdown) : format === "text" ? plain(page.markdown) : page.markdown

  if (input.prompt) {
    const content = body.length > PROMPT_INPUT ? `${body.slice(0, PROMPT_INPUT)}\n[nội dung bị cắt vì quá dài]` : body
    const extract =
      deps.extract ??
      (async (c: string, p: string, u: string, s: AbortSignal) => {
        const target = await webTarget()
        if (!target) throw new Error("Chưa có model để đọc trang theo prompt (gõ /model).")
        return extractWithModel(c, p, u, target, s)
      })
    return `${header}\n\n${await extract(content, input.prompt, page.url, signal)}`
  }
  const start = Math.max(0, input.start_char ?? 0)
  if (start >= body.length && body.length > 0) return `${header}\n\n(start_char ${start} vượt quá độ dài ${body.length} ký tự.)`
  const chunk = body.slice(start, start + PAGE)
  const rest = body.length - (start + chunk.length)
  const more = rest > 0 ? `\n\n(còn ${rest} ký tự; gọi lại web_fetch với start_char=${start + chunk.length}, hoặc dùng prompt để hỏi đúng phần cần)` : ""
  return `${header}${start > 0 ? `\n(từ ký tự ${start})` : ""}\n\n${chunk || "(trang không có nội dung chữ)"}${more}`
}

const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return undefined
  }
}

export function webFetchTool(deps: FetchDeps = {}): ToolDef<WebFetchInput> {
  return {
    name: "web_fetch",
    description:
      "Đọc một URL công khai (bài báo, công bố, báo cáo PDF): HTML được chuyển sang markdown (giữ link, bảng), PDF lấy chữ; http tự nâng lên https; cache 15 phút. " +
      "Truyền prompt để một model phụ đọc trang và chỉ trả phần cần (khuyên dùng với trang dài). Trang dài không có prompt thì đọc tiếp bằng start_char. " +
      "Chuyển hướng sang host khác sẽ được báo lại kèm URL mới để gọi lại. Không đọc được trang cần đăng nhập, trang chỉ render bằng JavaScript hay PDF scan. Không dùng để tìm kiếm (dùng web_search).",
    input: z.object({
      url: z.string().min(8).describe("URL đầy đủ"),
      prompt: z.string().min(3).max(1000).optional().describe("Câu hỏi cần trả lời từ trang, ví dụ: lợi nhuận quý 3 và kế hoạch năm"),
      format: z.enum(["markdown", "text", "html"]).optional().describe("Dạng nội dung (mặc định markdown)"),
      start_char: z.number().int().min(0).optional().describe("Đọc tiếp từ ký tự này (trang dài)"),
      timeoutSeconds: z.number().int().min(5).max(120).optional().describe("Thời gian chờ (giây, mặc định 60)"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    // A page can carry injected instructions; reading an arbitrary host could leak data in
    // its URL. Vietnamese finance/news/government hosts are exempt; others ask once per domain.
    askFor: (input) => {
      const host = hostOf((input as WebFetchInput).url)
      return host && isPreapproved(host) ? undefined : `domain:${host ?? "?"}`
    },
    timeoutMs: 125_000,
    maxOutputChars: 60_000,
    summarize: (input) => `web_fetch ${input.url.slice(0, 80)}${input.prompt ? ` · "${input.prompt.slice(0, 40)}"` : ""}`,
    execute: (input, ctx) => runFetch(input, AbortSignal.any([ctx.signal, AbortSignal.timeout((input.timeoutSeconds ?? 60) * 1000)]), deps),
  }
}

/** Tests only. */
export const clearFetchCache = () => cache.clear()
