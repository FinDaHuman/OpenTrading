import path from "node:path"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import type { ToolRegistry } from "../tools/registry"
import {
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_TOOL_TIMEOUT_MS,
  expandConfig,
  exposure,
  isRemote,
  loadServers,
  type RemoteConfig,
  type Scope,
  type ServerConfig,
  type ServerEntry,
  toolAllowed,
} from "./config"
import { normalizeSchema, resultToText } from "./convert"
import { serverPrefix, toolName } from "./naming"
import { McpOAuthProvider, NeedsAuthError, openBrowser, startCallbackServer } from "./oauth"
import { clearOAuth, secretEnv } from "./secrets"
import { TrustStore, trustKey } from "./trust"

export type McpState = "connecting" | "connected" | "failed" | "disabled" | "untrusted" | "needs-auth"
export type McpTransportKind = "stdio" | "http" | "sse"

export interface McpServerStatus {
  name: string
  scope: Scope
  /** Configured transport; for `http` this becomes `sse` when the server only spoke SSE. */
  transport: McpTransportKind
  state: McpState
  error?: string
  /** Model-visible tool names. */
  tools: string[]
  /** Tools the server offers but `enabledTools`/`disabledTools` hide. */
  hiddenTools: number
  /** Config file the server came from. */
  file: string
  /** What it runs or connects to — shown before the user approves a project server. */
  target: string
  /** Remote servers: whether OAuth may be used (no static Authorization header, `oauth` not false). */
  oauth: boolean
  /** Header names, env keys and `${VAR}`s the server receives once approved. */
  exposure: ReturnType<typeof exposure>
}

interface Live {
  client: Client
  transport: Transport
  kind: McpTransportKind
}

export interface McpManagerOptions {
  home: string
  cwd: string
  trustFile: string
  /** Delays between reconnect attempts after a remote server drops. */
  reconnectDelaysMs?: number[]
  /** Delays between initialize retries on transient errors (network, 429, 5xx). */
  retryDelaysMs?: number[]
  /** Opens the OAuth URL; tests replace it. */
  openBrowser?: (url: string) => boolean
}

/**
 * Windows needs these for child processes to resolve `.cmd`/`.exe` (npx, uvx) and to find
 * temp/program dirs; the SDK's own allowlist leaves them out. None of them hold secrets.
 */
const WINDOWS_EXTRA_ENV = ["PATHEXT", "COMSPEC", "WINDIR", "TMP", "ProgramData", "ProgramFiles(x86)"]

const MAX_DESCRIPTION = 2048
const LOGIN_TIMEOUT_MS = 5 * 60_000
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof StreamableHTTPError || error instanceof SseError) return error.code
  return undefined
}

function isAuthError(error: unknown) {
  const status = httpStatus(error)
  return error instanceof UnauthorizedError || error instanceof NeedsAuthError || status === 401 || status === 403
}

/** Network failures and overloaded servers are worth another try; everything else is not. */
function isTransient(error: unknown) {
  const status = httpStatus(error)
  if (status !== undefined) return RETRYABLE_STATUS.has(status)
  const text = errorText(error)
  return error instanceof TypeError || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket/i.test(text)
}

/** The connection itself is gone (server down, network cut) — not a protocol-level error. */
function isConnectionLost(error: unknown) {
  if (error instanceof SseError) return true
  const text = errorText(error)
  return error instanceof TypeError || /ECONNREFUSED|ECONNRESET|fetch failed|socket|Unable to connect|Maximum reconnection attempts/i.test(text)
}

/** The server forgot our session (restart, idle expiry): a fresh initialize fixes it. */
function isSessionExpired(error: unknown) {
  return httpStatus(error) === 404
}

/** A static `Authorization` header means the user chose a token, not OAuth. */
function usesOAuth(config: RemoteConfig) {
  if (config.oauth === false) return false
  return !Object.keys(config.headers ?? {}).some((h) => h.toLowerCase() === "authorization")
}

function authHint(name: string, config: RemoteConfig, error: unknown) {
  const url = config.url
  if (/api\.githubcopilot\.com/.test(url)) {
    return `GitHub MCP không hỗ trợ đăng nhập OAuth cho ứng dụng bên ngoài. Dùng Personal Access Token: header "Authorization": "Bearer \${GITHUB_PAT}" rồi lưu token bằng: opentrading mcp secret set GITHUB_PAT`
  }
  if (!usesOAuth(config)) return `Server từ chối token (${errorText(error)}). Kiểm tra lại header Authorization / token đã lưu.`
  return new NeedsAuthError(name).message
}

function missingCommandHint(command: string) {
  const base = path.basename(command).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase()
  const install: Record<string, string> = {
    npx: "Cài Node.js (https://nodejs.org) rồi mở lại terminal.",
    node: "Cài Node.js (https://nodejs.org) rồi mở lại terminal.",
    uvx: "Cài uv (https://docs.astral.sh/uv/getting-started/installation/) rồi mở lại terminal.",
    uv: "Cài uv (https://docs.astral.sh/uv/getting-started/installation/) rồi mở lại terminal.",
    docker: "Cài và bật Docker Desktop.",
  }
  return `Không tìm thấy lệnh "${command}". ${install[base] ?? "Cài chương trình này hoặc ghi đường dẫn đầy đủ trong \"command\"."}`
}

/**
 * Connects to every configured MCP server in parallel and mirrors their tools into the
 * ToolRegistry. A failing server never blocks the app — it just shows up as failed in /mcp.
 */
export class McpManager {
  private entries = new Map<string, ServerEntry>()
  private statuses = new Map<string, McpServerStatus>()
  private live = new Map<string, Live>()
  /** Bumped on every (re)connect/disconnect so stale attempts and reconnect loops stop. */
  private generation = new Map<string, number>()
  private listeners = new Set<(status: McpServerStatus[]) => void>()
  private stopping = false
  private trustStore: TrustStore

  constructor(
    private registry: ToolRegistry,
    private opts: McpManagerOptions,
  ) {
    this.trustStore = new TrustStore(opts.trustFile)
  }

  status(): McpServerStatus[] {
    return [...this.statuses.values()]
  }

  onChange(listener: (status: McpServerStatus[]) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    const snapshot = this.status()
    for (const listener of this.listeners) listener(snapshot)
  }

  private set(name: string, patch: Partial<McpServerStatus>) {
    const prev = this.statuses.get(name)
    if (!prev) return
    this.statuses.set(name, { ...prev, ...patch })
    this.emit()
  }

  private bump(name: string) {
    const next = (this.generation.get(name) ?? 0) + 1
    this.generation.set(name, next)
    return next
  }

  private current(name: string, gen: number) {
    return !this.stopping && this.generation.get(name) === gen
  }

  /**
   * Read config and connect everything (or just `only`, for the CLI). Safe to call again
   * (after editing config): existing connections are closed first and removed servers disappear.
   */
  async start(only?: string[]) {
    this.stopping = false
    const entries = (await loadServers(this.opts.home, this.opts.cwd)).filter((e) => !only || only.includes(e.name))
    await Promise.allSettled([...this.live.keys()].map((name) => this.disconnect(name)))
    for (const name of this.entries.keys()) this.bump(name)
    this.entries.clear()
    this.statuses.clear()
    for (const entry of entries) {
      this.entries.set(entry.name, entry)
      const config = entry.config
      this.statuses.set(entry.name, {
        name: entry.name,
        scope: entry.scope,
        file: entry.file,
        transport: !config ? "stdio" : isRemote(config) ? config.type : "stdio",
        target: !config ? "" : isRemote(config) ? config.url : [config.command, ...(config.args ?? [])].join(" "),
        state: "connecting",
        tools: [],
        hiddenTools: 0,
        oauth: config ? isRemote(config) && usesOAuth(config) : false,
        exposure: config ? exposure(config) : { vars: [], headers: [], env: [] },
      })
    }
    this.emit()
    await Promise.allSettled(entries.map((entry) => this.connect(entry)))
  }

  /** Global servers are the user's own; project ones need the one-time approval. */
  async isAllowed(entry: ServerEntry) {
    if (entry.scope !== "project") return true
    return Boolean(entry.config) && (await this.trustStore.isTrusted(trustKey(this.opts.cwd, entry.name, entry.config!)))
  }

  /** Approve a project server, then connect it. */
  async trust(name: string) {
    const entry = this.entries.get(name)
    if (!entry?.config) return
    await this.trustStore.trust(trustKey(this.opts.cwd, name, entry.config))
    await this.connect(entry)
  }

  async restart(name: string) {
    const entry = this.entries.get(name)
    if (!entry) return
    await this.disconnect(name)
    await this.connect(entry)
  }

  private restarting = new Map<string, Promise<void>>()

  private restartShared(name: string) {
    let pending = this.restarting.get(name)
    if (!pending) {
      pending = this.restart(name).finally(() => this.restarting.delete(name))
      this.restarting.set(name, pending)
    }
    return pending
  }

  async stop() {
    this.stopping = true
    for (const name of this.entries.keys()) this.bump(name)
    await Promise.allSettled([...this.live.keys()].map((name) => this.disconnect(name)))
  }

  private async disconnect(name: string) {
    this.bump(name)
    const live = this.live.get(name)
    this.live.delete(name)
    this.registry.unregister(serverPrefix(name))
    if (live) await live.client.close().catch(() => {})
  }

  private async expanded(entry: ServerEntry) {
    const secrets = await secretEnv(this.opts.home)
    return expandConfig(entry.config!, process.env, secrets)
  }

  private async connect(entry: ServerEntry) {
    const { name } = entry
    const gen = this.bump(name)
    if (entry.error || !entry.config) return this.set(name, { state: "failed", error: entry.error })
    if (entry.config.enabled === false) return this.set(name, { state: "disabled", error: undefined, tools: [] })
    if (!(await this.isAllowed(entry))) {
      return this.set(name, { state: "untrusted", error: undefined })
    }

    const { config, missing } = await this.expanded(entry)
    if (missing.length > 0) {
      const list = missing.join(", ")
      return this.set(name, {
        state: "failed",
        error: `Thiếu biến: ${list}. Đặt biến môi trường, hoặc lưu bằng: opentrading mcp secret set ${missing[0]}`,
      })
    }

    this.set(name, { state: "connecting", error: undefined, tools: [] })
    const stderr: string[] = []
    let live: Live
    try {
      live = await this.open(entry, config, stderr)
    } catch (error) {
      if (!this.current(name, gen)) return
      if (isRemote(config) && isAuthError(error)) {
        return this.set(name, { state: "needs-auth", error: authHint(name, config, error) })
      }
      const tail = stderr.join("").trim().split("\n").slice(-3).join(" | ")
      if (!isRemote(config) && /is not recognized|command not found|ENOENT|No such file/i.test(tail + errorText(error))) {
        return this.set(name, { state: "failed", error: missingCommandHint(config.command) })
      }
      const timeoutHint = error instanceof TimeoutError ? ` Có thể tăng "startupTimeoutMs" cho server "${name}".` : ""
      return this.set(name, { state: "failed", error: errorText(error) + timeoutHint + (tail ? ` — stderr: ${tail}` : "") })
    }
    if (!this.current(name, gen)) {
      await live.client.close().catch(() => {})
      return
    }

    this.live.set(name, live)
    const { client } = live
    const dropped = () => {
      if (!this.current(name, gen) || this.live.get(name)?.client !== client) return
      this.live.delete(name)
      this.registry.unregister(serverPrefix(name))
      if (isRemote(config)) {
        void client.close().catch(() => {})
        void this.reconnectLoop(entry, gen)
      } else this.set(name, { state: "failed", error: "Mất kết nối tới server.", tools: [] })
    }
    client.onclose = dropped
    // Remote transports report a dead connection through onerror, not onclose: a broken
    // SSE stream, or the HTTP transport giving up on its GET stream.
    client.onerror = (error) => {
      if (isRemote(config) && isConnectionLost(error)) dropped()
    }
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      void this.syncTools(name, client, config).catch(() => {})
    })

    try {
      await this.syncTools(name, client, config)
      this.set(name, { state: "connected", transport: live.kind })
    } catch (error) {
      await this.disconnect(name)
      this.set(name, { state: "failed", error: `Không lấy được danh sách tool: ${errorText(error)}` })
    }
  }

  /** Remote server dropped: back off and try again, a few times, unless something newer took over. */
  private async reconnectLoop(entry: ServerEntry, gen: number) {
    const delays = this.opts.reconnectDelaysMs ?? [1000, 2000, 4000, 8000, 16000]
    for (const [i, delay] of delays.entries()) {
      if (!this.current(entry.name, gen)) return
      this.set(entry.name, { state: "connecting", error: `Mất kết nối — thử lại lần ${i + 1}/${delays.length}…`, tools: [] })
      await sleep(delay)
      if (!this.current(entry.name, gen)) return
      await this.connect(entry)
      if (this.statuses.get(entry.name)?.state !== "failed") return
      gen = this.generation.get(entry.name)!
    }
  }

  /** Connect with retries on transient errors; Streamable HTTP falls back to SSE for older servers. */
  private async open(entry: ServerEntry, config: ServerConfig, stderr: string[]): Promise<Live> {
    const timeoutMs = config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs
    const attempt = async (kind: McpTransportKind) => {
      const delays = this.opts.retryDelaysMs ?? [250, 1000]
      for (let i = 0; ; i++) {
        const transport = this.transport(entry, config, kind, stderr)
        const client = new Client({ name: "opentrading", version: "0.1.0" }, { capabilities: {} })
        try {
          const left = Math.max(1, deadline - Date.now())
          await withTimeout(client.connect(transport), left, `Kết nối quá ${timeoutMs / 1000}s.`)
          return { client, transport, kind }
        } catch (error) {
          await client.close().catch(() => {})
          const delay = delays[i]
          if (kind === "stdio" || delay === undefined || !isTransient(error) || Date.now() + delay >= deadline) throw error
          await sleep(delay)
        }
      }
    }
    if (!isRemote(config)) return attempt("stdio")
    if (config.type === "sse") return attempt("sse")
    try {
      return await attempt("http")
    } catch (error) {
      // Servers that predate Streamable HTTP answer the POST with 404/405/400.
      const status = httpStatus(error)
      if (isAuthError(error) || error instanceof TimeoutError || (status !== undefined && ![400, 404, 405].includes(status))) throw error
      try {
        return await attempt("sse")
      } catch {
        throw error
      }
    }
  }

  private transport(entry: ServerEntry, config: ServerConfig, kind: McpTransportKind, stderr: string[], authProvider?: McpOAuthProvider): Transport {
    if (isRemote(config)) {
      const provider =
        authProvider ??
        (usesOAuth(config)
          ? new McpOAuthProvider({
              home: this.opts.home,
              name: entry.name,
              url: config.url,
              config: config.oauth || undefined,
              mode: "background",
            })
          : undefined)
      const options = { requestInit: { headers: config.headers }, authProvider: provider }
      return kind === "sse"
        ? new SSEClientTransport(new URL(config.url), options)
        : new StreamableHTTPClientTransport(new URL(config.url), options)
    }
    const extra =
      process.platform === "win32"
        ? Object.fromEntries(WINDOWS_EXTRA_ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])))
        : {}
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      // The SDK adds a safe allowlist (PATH, HOME, SystemRoot…) on top; the rest of our
      // environment — including provider API keys — is never passed to the server.
      env: { ...extra, ...config.env },
      cwd: config.cwd ? path.resolve(path.dirname(entry.file), config.cwd) : undefined,
      stderr: "pipe",
    })
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString())
      if (stderr.length > 50) stderr.shift()
    })
    return transport
  }

  /**
   * Interactive OAuth login: register (if needed), open the browser, wait for the
   * redirect on a loopback port, exchange the code, save tokens, reconnect.
   * `onUrl` always receives the authorization URL so the UI can show it.
   */
  async login(name: string, opts: { onUrl: (url: string) => void; signal?: AbortSignal }) {
    const entry = this.entries.get(name)
    if (!entry?.config) throw new Error(`Không có server "${name}".`)
    if (!isRemote(entry.config)) throw new Error(`Server "${name}" chạy bằng lệnh (stdio), không dùng OAuth.`)
    if (!usesOAuth(entry.config)) throw new Error(`Server "${name}" dùng token cố định (header Authorization hoặc "oauth": false).`)
    if (!(await this.isAllowed(entry))) throw new Error(`Server "${name}" của project chưa được cho phép. Mở /mcp để xem và cho phép trước.`)
    const { config, missing } = await this.expanded(entry)
    if (missing.length > 0) throw new Error(`Thiếu biến: ${missing.join(", ")}`)
    const remote = config as RemoteConfig
    const oauthConfig = remote.oauth || undefined

    const probe = new McpOAuthProvider({ home: this.opts.home, name, url: remote.url, config: oauthConfig, mode: "login" })
    const callback = oauthConfig?.callbackPort
      ? startCallbackServer(oauthConfig.callbackPort, true)
      : startCallbackServer(await probe.storedCallbackPort())
    try {
      const provider = new McpOAuthProvider({
        home: this.opts.home,
        name,
        url: remote.url,
        config: oauthConfig,
        mode: "login",
        callbackPort: callback.port,
        onRedirect: (url) => {
          opts.onUrl(url.href)
          ;(this.opts.openBrowser ?? openBrowser)(url.href)
        },
      })
      await provider.invalidateCredentials("tokens")
      const kind = this.statuses.get(name)?.transport === "sse" || remote.type === "sse" ? "sse" : "http"
      const transport = this.transport(entry, remote, kind, [], provider) as StreamableHTTPClientTransport | SSEClientTransport
      const client = new Client({ name: "opentrading", version: "0.1.0" }, { capabilities: {} })
      try {
        await client.connect(transport)
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) {
          if (/registration|dynamic client/i.test(errorText(error))) {
            throw new Error(
              `Server không cho đăng ký ứng dụng tự động (DCR). Tạo OAuth app trên trang của nhà cung cấp, rồi thêm "oauth": { "clientId": "…" } vào cấu hình server "${name}". Chi tiết: ${errorText(error)}`,
            )
          }
          throw error
        }
        const code = await callback.waitForCode(() => provider.expectedState, LOGIN_TIMEOUT_MS, opts.signal)
        await transport.finishAuth(code)
      } finally {
        await client.close().catch(() => {})
      }
      await provider.commit()
    } finally {
      callback.stop()
    }
    await this.restart(name)
  }

  /** Forget stored OAuth tokens and client registration, then reconnect (→ needs auth). */
  async logout(name: string) {
    await clearOAuth(this.opts.home, name)
    await this.restart(name)
  }

  private async syncTools(name: string, client: Client, config: ServerConfig) {
    const tools: { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined)
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor && tools.length < 2048)

    this.registry.unregister(serverPrefix(name))
    const taken = new Set(this.registry.list().map((t) => t.name))
    const toolTimeoutMs = config.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    const registered: string[] = []
    let hidden = 0
    for (const tool of tools) {
      if (!toolAllowed(config, tool.name)) {
        hidden++
        continue
      }
      const modelName = toolName(name, tool.name, taken)
      taken.add(modelName)
      registered.push(modelName)
      this.registry.register({
        name: modelName,
        source: `mcp:${name}`,
        description: (tool.description ?? `Tool ${tool.name} của MCP server ${name}.`).slice(0, MAX_DESCRIPTION),
        input: normalizeSchema(tool.inputSchema),
        readOnly: tool.annotations?.readOnlyHint ?? false,
        // The wrapper's own timer is a backstop; the SDK enforces the real per-call timeout.
        timeoutMs: toolTimeoutMs + 5_000,
        maxOutputChars: config.maxOutputChars,
        summarize: (input) => `${name} · ${tool.name}(${compactArgs(input)})`,
        execute: async (input, ctx) => {
          const args = (input as Record<string, unknown>) ?? {}
          const call = (live: Live) =>
            live.client.callTool({ name: tool.name, arguments: args }, undefined, {
              signal: ctx.signal,
              timeout: toolTimeoutMs,
              resetTimeoutOnProgress: true,
              // Without a progress handler the SDK sends no progress token, so the timeout
              // could never be reset by a long-running tool reporting progress.
              onprogress: () => {},
            })
          const live = this.live.get(name)
          if (!live) throw new Error(`MCP server "${name}" chưa kết nối. Xem /mcp.`)
          try {
            return resultToText((await call(live)) as Parameters<typeof resultToText>[0])
          } catch (error) {
            if (isRemote(config) && isAuthError(error)) {
              this.set(name, { state: "needs-auth", error: authHint(name, config, error) })
              throw new Error(authHint(name, config, error))
            }
            if (!isRemote(config) || !isSessionExpired(error) || ctx.signal.aborted) throw error
            // Session expired on the server: initialize again and retry exactly once.
            // Parallel calls that all hit the 404 share one restart instead of killing
            // each other's fresh session.
            await this.restartShared(name)
            const fresh = this.live.get(name)
            if (!fresh) throw error
            return resultToText((await call(fresh)) as Parameters<typeof resultToText>[0])
          }
        },
      })
    }
    this.set(name, { tools: registered, hiddenTools: hidden })
  }
}

function compactArgs(input: unknown) {
  const text = JSON.stringify(input ?? {})
  return text === "{}" ? "" : text.length > 60 ? text.slice(0, 57) + "…" : text
}
