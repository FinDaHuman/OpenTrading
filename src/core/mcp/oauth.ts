import { randomBytes } from "node:crypto"
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js"
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"
import type { OAuthConfig } from "./config"
import { type OAuthRecord, oauthKey, readOAuth, writeOAuth } from "./secrets"

/**
 * OAuth for remote MCP servers (Notion, Linear, Sentry, Atlassian…). The SDK does the
 * protocol — RFC 9728/8414 discovery, dynamic client registration, PKCE, refresh — and
 * calls back into this provider for storage and for "send the user to this URL".
 *
 * Two modes:
 * - `background` (normal connects and tool calls): uses stored client + tokens and may
 *   refresh them, but never registers a client or opens a browser — it throws
 *   NeedsAuthError instead, and the server shows as "cần đăng nhập".
 * - `login` (user ran /mcp → đăng nhập or `opentrading mcp login`): may register and
 *   redirect; nothing is written until `commit()`, so an abandoned login leaves the old
 *   credentials intact.
 */
export class NeedsAuthError extends Error {
  constructor(server: string) {
    super(`Server "${server}" cần đăng nhập OAuth. Mở /mcp → chọn server → enter, hoặc chạy: opentrading mcp login ${server}`)
    this.name = "NeedsAuthError"
  }
}

export interface ProviderOptions {
  home: string
  name: string
  url: string
  config?: Exclude<OAuthConfig, false>
  mode: "background" | "login"
  /** Login mode: the port the local callback server actually listens on. */
  callbackPort?: number
  /** Login mode: called with the authorization URL the user must open. */
  onRedirect?: (url: URL) => void
}

const PLACEHOLDER_REDIRECT = "http://127.0.0.1/callback"

export const redirectUrlFor = (port: number) => `http://127.0.0.1:${port}/callback`

export class McpOAuthProvider implements OAuthClientProvider {
  private key: string
  private record: OAuthRecord | undefined
  private loaded = false
  private verifier: string | undefined
  private stateValue: string | undefined
  private discovery: OAuthDiscoveryState | undefined

  constructor(private opts: ProviderOptions) {
    this.key = oauthKey(opts.name, opts.url)
  }

  private async load() {
    if (!this.loaded) {
      this.record = await readOAuth(this.opts.home, this.key)
      this.loaded = true
    }
    return this.record
  }

  private async save(change: (r: OAuthRecord) => void) {
    const record = (await this.load()) ?? { serverUrl: this.opts.url }
    change(record)
    this.record = record
    if (this.opts.mode === "background") await writeOAuth(this.opts.home, this.key, record)
  }

  /** Login mode: persist what the flow produced. */
  async commit() {
    if (this.record) await writeOAuth(this.opts.home, this.key, this.record)
  }

  /** Port the stored client was registered with, if any — login reuses it so the redirect URI matches. */
  async storedCallbackPort() {
    return (await this.load())?.callbackPort
  }

  get redirectUrl() {
    // Always set: the SDK treats a missing redirect URL as a non-interactive
    // (client_credentials) flow, which is not what any of these servers expect.
    const port = this.opts.callbackPort ?? this.record?.callbackPort
    return port ? redirectUrlFor(port) : PLACEHOLDER_REDIRECT
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "OpenTrading",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.opts.config?.clientSecret ? "client_secret_post" : "none",
      ...(this.opts.config?.scope ? { scope: this.opts.config.scope } : {}),
    }
  }

  state() {
    this.stateValue ??= randomBytes(32).toString("base64url")
    return this.stateValue
  }

  /** The state sent with the authorization request, for the callback to check. */
  get expectedState() {
    return this.stateValue
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const { config, mode } = this.opts
    if (config?.clientId) return { client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}) }
    const record = await this.load()
    const info = record?.clientInfo
    if (mode === "login") {
      // A dynamically registered client is bound to its redirect URI: if we could not get
      // the same port back, register a new client instead of failing at the redirect.
      if (info && record?.callbackPort !== this.opts.callbackPort) return undefined
      return info
    }
    if (!info) throw new NeedsAuthError(this.opts.name)
    return info
  }

  async saveClientInformation(info: OAuthClientInformationMixed) {
    await this.save((r) => {
      r.clientInfo = info
      r.callbackPort = this.opts.callbackPort
    })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.load())?.tokens
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.save((r) => {
      r.tokens = tokens
      r.expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined
    })
  }

  async redirectToAuthorization(url: URL) {
    if (this.opts.mode !== "login" || !this.opts.onRedirect) throw new NeedsAuthError(this.opts.name)
    this.opts.onRedirect(url)
  }

  saveCodeVerifier(verifier: string) {
    this.verifier = verifier
  }

  codeVerifier() {
    if (!this.verifier) throw new Error("Thiếu PKCE code verifier (luồng đăng nhập chưa bắt đầu).")
    return this.verifier
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "verifier") this.verifier = undefined
    if (scope === "discovery" || scope === "all") this.discovery = undefined
    if (scope === "verifier" || scope === "discovery") return
    await this.save((r) => {
      if (scope === "all" || scope === "client") {
        r.clientInfo = undefined
        r.callbackPort = undefined
      }
      if (scope === "all" || scope === "tokens") {
        r.tokens = undefined
        r.expiresAt = undefined
      }
    })
  }

  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.discovery = state
  }

  discoveryState() {
    return this.discovery
  }
}

/** Stored OAuth state of a server, for /mcp and `mcp list`. */
export async function oauthStatus(home: string, name: string, url: string) {
  const record = await readOAuth(home, oauthKey(name, url))
  if (!record?.tokens) return "none" as const
  if (record.expiresAt && record.expiresAt < Date.now() && !record.tokens.refresh_token) return "expired" as const
  return "authenticated" as const
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>OpenTrading</title>` +
  `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;line-height:1.5">` +
  `<h2>${title}</h2><p>${body}</p></body>`

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface CallbackServer {
  port: number
  redirectUrl: string
  /** Resolves with the authorization code once the browser comes back with the right state. */
  waitForCode(expectedState: () => string | undefined, timeoutMs: number, signal?: AbortSignal): Promise<string>
  stop(): void
}

/**
 * Loopback HTTP server for the OAuth redirect. Listens on 127.0.0.1 only. Tries `port`
 * first (the one the stored client was registered with); if that is taken, falls back to
 * an OS-assigned port and the provider registers a new client — unless `strict` (the
 * port was configured for a pre-registered client), which fails instead.
 */
export function startCallbackServer(port?: number, strict = false): CallbackServer {
  let deliver: ((result: { code?: string; error?: string; state?: string }) => void) | undefined
  const fetch = (req: Request) => {
    const url = new URL(req.url)
    if (url.pathname !== "/callback") return new Response("Not found", { status: 404 })
    const error = url.searchParams.get("error")
    const code = url.searchParams.get("code") ?? undefined
    const state = url.searchParams.get("state") ?? undefined
    if (!deliver) return new Response(PAGE("Hết hạn", "Không có lượt đăng nhập nào đang chờ. Hãy thử lại từ OpenTrading."), { status: 410, headers: { "content-type": "text/html; charset=utf-8" } })
    deliver({ code, state, error: error ? `${error}${url.searchParams.get("error_description") ? `: ${url.searchParams.get("error_description")}` : ""}` : undefined })
    const ok = !error && code
    return new Response(
      ok
        ? PAGE("Đã đăng nhập", "Bạn có thể đóng tab này và quay lại OpenTrading.")
        : PAGE("Đăng nhập thất bại", escapeHtml(error ?? "Thiếu mã xác thực.")),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    )
  }

  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({ hostname: "127.0.0.1", port: port ?? 0, fetch })
  } catch (error) {
    // A configured port belongs to a pre-registered client: another port would not match
    // its redirect URI, so say so instead of failing later at the provider.
    if (strict) throw new Error(`Cổng callback ${port} đang bận (cấu hình "oauth.callbackPort"). Đóng chương trình đang dùng cổng đó rồi thử lại.`)
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  }
  const actual = server.port!

  return {
    port: actual,
    redirectUrl: redirectUrlFor(actual),
    waitForCode(expectedState, timeoutMs, signal) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error(`Hết ${Math.round(timeoutMs / 60000)} phút chờ đăng nhập.`)), timeoutMs)
        const onAbort = () => finish(new Error("Đã huỷ đăng nhập."))
        signal?.addEventListener("abort", onAbort, { once: true })
        function finish(error?: Error, code?: string) {
          clearTimeout(timer)
          signal?.removeEventListener("abort", onAbort)
          deliver = undefined
          if (error) reject(error)
          else resolve(code!)
        }
        deliver = (result) => {
          if (result.error) return finish(new Error(`Nhà cung cấp OAuth từ chối: ${result.error}`))
          // CSRF guard: the browser must come back with the state we sent.
          if (!result.state || result.state !== expectedState()) return finish(new Error("Sai tham số state trong callback OAuth."))
          if (!result.code) return finish(new Error("Callback OAuth thiếu mã xác thực."))
          finish(undefined, result.code)
        }
      })
    },
    stop() {
      server.stop(true)
    },
  }
}

/**
 * Open a URL in the default browser without going through a shell: `cmd /c start` would
 * cut the URL at the first `&`, and every authorization URL has several.
 * Returns false when nothing could be launched; callers always show the URL as well.
 */
export function openBrowser(url: string): boolean {
  if (process.env.OPENTRADING_NO_BROWSER) return false
  const cmd =
    process.platform === "win32"
      ? ["rundll32", "url.dll,FileProtocolHandler", url]
      : process.platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url]
  try {
    const child = Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] })
    child.unref()
    return true
  } catch {
    return false
  }
}
