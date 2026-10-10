import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * Network rules for web_fetch, after Claude Code's WebFetch: http upgraded to https, no
 * credentials in URLs, no private addresses (checked on the resolved IPs, not just the
 * name), same-host redirects followed, cross-host redirects reported back to the model.
 */

export const MAX_URL_LENGTH = 2000
export const MAX_BYTES = 10 * 1024 * 1024
const MAX_SAME_HOST_REDIRECTS = 10

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges (v4 and v6). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "")
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateAddress(mapped[1]!)
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (!ip.includes(":")) return false
  return ip === "::1" || ip === "::" || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip)
}

/** Names that are local by definition, before any DNS. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true
  return isIP(host) ? isPrivateAddress(host) : false
}

export type Resolver = (host: string) => Promise<string[]>
const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)

/**
 * Refuse a host whose name or any resolved address is private. A mitigation, not a full
 * fix: the HTTP client resolves again, so a DNS-rebinding server could still answer
 * differently in between.
 */
export async function assertPublicHost(host: string, resolve: Resolver = systemResolver) {
  if (isPrivateHost(host)) throw new Error("Không tải địa chỉ nội bộ (localhost, mạng LAN).")
  if (isIP(host.replace(/^\[|\]$/g, ""))) return
  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new Error(`Không phân giải được tên miền ${host}.`)
  }
  if (addresses.some(isPrivateAddress)) throw new Error(`Tên miền ${host} trỏ về địa chỉ nội bộ; không tải.`)
}

/** Validate and normalise a URL the model gave: https, no credentials, a real host. */
export function checkUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH) throw new Error(`URL dài quá ${MAX_URL_LENGTH} ký tự.`)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`URL không hợp lệ: ${raw.slice(0, 200)}`)
  }
  if (url.protocol === "http:") url.protocol = "https:"
  if (url.protocol !== "https:") throw new Error("Chỉ tải được http(s).")
  if (url.username || url.password) throw new Error("URL không được chứa tên đăng nhập/mật khẩu.")
  if (!url.hostname.includes(".") && !isIP(url.hostname)) throw new Error(`Tên miền không hợp lệ: ${url.hostname}`)
  return url
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "")
/** Claude Code's rule: follow a redirect only within the same site (ignoring www.). */
export const sameSite = (a: URL, b: URL) => bareHost(a.hostname) === bareHost(b.hostname) && a.protocol === b.protocol && a.port === b.port

export type Fetched =
  | { kind: "ok"; url: URL; status: number; statusText: string; contentType: string; bytes: Uint8Array }
  | { kind: "redirect"; from: URL; to: URL; status: number }

/** Read at most MAX_BYTES; a larger body is an error rather than a silent cut. */
async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0)
  if (declared > MAX_BYTES) throw new Error(`Trang quá lớn (${Math.round(declared / 1024 / 1024)}MB > ${MAX_BYTES / 1024 / 1024}MB).`)
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new Error(`Trang quá lớn (> ${MAX_BYTES / 1024 / 1024}MB).`)
    }
    chunks.push(value)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

/**
 * GET a public URL. Same-site redirects are followed (each hop re-checked); a redirect to
 * another host is returned to the caller so the model decides, as in Claude Code.
 * A Cloudflare challenge on the browser User-Agent is retried once with a plain one (opencode).
 */
export async function fetchPublic(start: URL, signal: AbortSignal, deps: { fetch?: typeof fetch; resolve?: Resolver } = {}): Promise<Fetched> {
  const doFetch = deps.fetch ?? fetch
  let url = start
  for (let hop = 0; ; hop++) {
    await assertPublicHost(url.hostname, deps.resolve)
    const get = (ua: string) =>
      doFetch(url, {
        signal,
        redirect: "manual",
        headers: {
          "User-Agent": ua,
          Accept: "text/markdown;q=1.0, text/html;q=0.9, application/pdf;q=0.8, text/plain;q=0.8, */*;q=0.1",
          "Accept-Language": "vi,en;q=0.8",
        },
      })
    let res = await get(BROWSER_UA)
    if (res.status === 403 && res.headers.get("cf-mitigated") === "challenge") {
      await res.body?.cancel()
      res = await get("OpenTrading/0.2 (+market-research)")
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
    if (!location) {
      return { kind: "ok", url, status: res.status, statusText: res.statusText, contentType: res.headers.get("content-type") ?? "", bytes: await readCapped(res) }
    }
    await res.body?.cancel()
    const next = new URL(location, url)
    if (next.protocol === "http:" && sameSite(new URL(next.href.replace(/^http:/, "https:")), url)) next.protocol = "https:"
    if (!/^https?:$/.test(next.protocol)) throw new Error("Trang chuyển hướng tới địa chỉ không phải http(s).")
    if (!sameSite(next, url)) return { kind: "redirect", from: start, to: next, status: res.status }
    if (hop >= MAX_SAME_HOST_REDIRECTS) throw new Error(`Quá nhiều lần chuyển hướng (> ${MAX_SAME_HOST_REDIRECTS}).`)
    url = next
  }
}
