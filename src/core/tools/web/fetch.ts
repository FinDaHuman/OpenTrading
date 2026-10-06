import { z } from "zod"
import type { ToolDef } from "../types"

const MAX_BYTES = 2 * 1024 * 1024
const MAX_CHARS = 60_000

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}

/**
 * Hosts on this machine or the local network. A page the model reads can carry injected
 * instructions, so the model must not be steered into probing local services.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0") return true
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (!host.includes(":")) return false
  return host === "::1" || host === "::" || /^(fc|fd|fe8|fe9|fea|feb)/.test(host) || host.startsWith("::ffff:")
}

/** Read at most MAX_BYTES; a larger page is an error rather than a silent cut. */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0)
  if (declared > MAX_BYTES) throw new Error(`Trang quá lớn (${Math.round(declared / 1024)}KB > ${MAX_BYTES / 1024}KB).`)
  if (!res.body) return ""
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new Error(`Trang quá lớn (> ${MAX_BYTES / 1024}KB).`)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

const MAX_REDIRECTS = 5

/**
 * Follow redirects by hand so every hop is checked before a request is sent: with the
 * default `redirect: "follow"`, a public page redirecting to 127.0.0.1 would already
 * have reached the local service by the time we saw the final URL.
 */
export async function fetchPublic(start: URL, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Response> {
  let url = start
  for (let hop = 0; ; hop++) {
    if (isPrivateHost(url.hostname)) throw new Error("Không tải địa chỉ nội bộ (localhost, mạng LAN).")
    const res = await fetchImpl(url, {
      signal,
      redirect: "manual",
      headers: { "User-Agent": "OpenTrading/0.1 (+market-research)", Accept: "text/html,application/xhtml+xml,text/*;q=0.9,*/*;q=0.1" },
    })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
    if (!location) return res
    await res.body?.cancel()
    if (hop >= MAX_REDIRECTS) throw new Error(`Quá nhiều lần chuyển hướng (> ${MAX_REDIRECTS}).`)
    url = new URL(location, url)
    if (!/^https?:$/.test(url.protocol)) throw new Error("Trang chuyển hướng tới địa chỉ không phải http(s).")
  }
}

const cut = (text: string) => (text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n(đã cắt bớt)` : text)

/** opencode-style web_fetch: one public http(s) URL as text (default) or raw HTML; no key needed. */
export function webFetchTool(): ToolDef<{ url: string; format?: "text" | "html"; timeoutSeconds?: number }> {
  return {
    name: "web_fetch",
    description:
      "Tải nội dung một URL công khai về dạng text (mặc định) hoặc html thô. Dùng để đọc bài báo, công bố, tài liệu khi đã có link từ web_search hoặc tool tin tức. Không dùng để tìm kiếm (dùng web_search). Không đọc được PDF scan hay trang chỉ render bằng JavaScript.",
    input: z.object({
      url: z.string().min(1).describe("URL http(s) cần tải"),
      format: z.enum(["text", "html"]).optional().describe("Định dạng trả về (mặc định text)"),
      timeoutSeconds: z.number().min(1).max(120).optional().describe("Timeout tính bằng giây (mặc định 30, tối đa 120)"),
    }),
    readOnly: true,
    timeoutMs: 125_000,
    summarize: (input) => `web_fetch(${input.url.slice(0, 50)})`,
    async execute(input, ctx) {
      const url = input.url.trim()
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new Error("URL không hợp lệ.")
      }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("URL phải bắt đầu bằng http:// hoặc https://")
      if (isPrivateHost(parsed.hostname)) throw new Error("Không tải địa chỉ nội bộ (localhost, mạng LAN).")
      const seconds = input.timeoutSeconds ?? 30
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(seconds * 1000)])
      try {
        const res = await fetchPublic(parsed, signal)
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
        const raw = await readCapped(res)
        if ((input.format ?? "text") === "html") return cut(raw)
        const text = stripHtml(raw)
        if (!text.trim()) throw new Error("Trang không trích được text (có thể render bằng JavaScript hoặc là PDF scan).")
        return cut(text)
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw new Error(`web_fetch quá thời gian (${seconds}s): ${url}`)
        throw error
      }
    },
  }
}
