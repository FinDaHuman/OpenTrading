import path from "node:path"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Limiter } from "../subagents/limiter"
import type { ToolRegistry } from "../tools/registry"
import {
  configFiles,
  deleteServer,
  putServer,
  setServerEnabled,
  DEFAULT_MAX_CONCURRENT,
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
import { isDataServer } from "./catalog"
import { blockToParts, resultToOutput } from "./convert"
import { serverPrefix, toolName } from "./naming"
import { McpOAuthProvider, NeedsAuthError, oauthStatus, openBrowser, startCallbackServer } from "./oauth"
import { clearOAuth, secretEnv, setSecretEnv } from "./secrets"
import { fingerprint, TrustStore, trustKey } from "./trust"

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
  /** Prompts (workflows) the server offers; the TUI shows them as /server:prompt. */
  prompts: McpPromptInfo[]
  /** Whether the server offers resources (read through list/read_mcp_resource). */
  resources: boolean
  /** The server's `instructions` from initialize (capped), sent to the model in system. */
  instructions?: string
}

export interface McpPromptInfo {
  name: string
  description?: string
  arguments: { name: string; description?: string; required?: boolean }[]
}

/**
 * Caps on lists an MCP server sends. They also bound validation work: zod >= 4.6.6 checks
 * `.max` before parsing the elements, so an oversized array fails fast instead of building
 * one issue per bad element (GHSA-mrhx-c7xc-m3w5). The list caps also stop the paging loops.
 */
export const MAX_MCP_TOOLS = 2048
export const MAX_MCP_PROMPTS = 512
export const MAX_MCP_RESOURCES = 1000
const MAX_MCP_ITEMS = 256

/**
 * `tools/list` parsed loosely: one tool with an odd `outputSchema` (or a missing field)
 * must not make the whole server unusable, as the SDK's strict schema would.
 */
const LooseToolList = z
  .object({
    tools: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          inputSchema: z.unknown().optional(),
          annotations: z
            .object({
              title: z.string().optional(),
              readOnlyHint: z.boolean().optional(),
              destructiveHint: z.boolean().optional(),
              openWorldHint: z.boolean().optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ).max(MAX_MCP_TOOLS),
    nextCursor: z.string().optional(),
  })
  .passthrough()

const LoosePromptList = z
  .object({
    prompts: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          arguments: z
            .array(z.object({ name: z.string(), description: z.string().optional(), required: z.boolean().optional() }).passthrough())
            .max(MAX_MCP_ITEMS)
            .optional(),
        })
        .passthrough(),
    ).max(MAX_MCP_PROMPTS),
    nextCursor: z.string().optional(),
  })
  .passthrough()

const LooseResourceList = z
  .object({
    resources: z.array(
      z.object({ uri: z.string(), name: z.string().optional(), description: z.string().optional(), mimeType: z.string().optional() }).passthrough(),
    ).max(MAX_MCP_RESOURCES),
    nextCursor: z.string().optional(),
  })
  .passthrough()

const LooseReadResource = z
  .object({
    contents: z.array(
      z.object({ uri: z.string(), mimeType: z.string().optional(), text: z.string().optional(), blob: z.string().optional() }).passthrough(),
    ).max(MAX_MCP_ITEMS),
  })
  .passthrough()

const LooseGetPrompt = z
  .object({
    description: z.string().optional(),
    messages: z.array(z.object({ role: z.string(), content: z.object({ type: z.string() }).passthrough() }).passthrough()).max(MAX_MCP_ITEMS),
  })
  .passthrough()

/** Native tools for MCP resources; registered while at least one server offers resources. */
export const RESOURCE_TOOLS = ["list_mcp_resources", "read_mcp_resource"] as const


interface Live {
  client: Client
  transport: Transport
  kind: McpTransportKind
  /** Treat this connection as dead: forget it and start reconnecting. */
  drop?: () => void
}

export interface McpManagerOptions {
  home: string
  cwd: string
  trustFile: string
  /** Delays between reconnect attempts after a remote server drops; the last one repeats until it is back. */
  reconnectDelaysMs?: number[]
  /** Delays between retries of a read-only tool call that failed on a dropped or overloaded server. */
  callRetryDelaysMs?: number[]
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
/** Same cap as Claude Code for a server's `instructions`. */
export const MAX_INSTRUCTIONS = 2048
const SEARCH_HINT_META = "anthropic/searchHint"
const ALWAYS_LOAD_META = "anthropic/alwaysLoad"

/**
 * What tool search reads from an MCP tool: its description, the server's search hint and
 * whether it may be deferred. Shared with the offline routing eval, so it scores the
 * catalog exactly as a live session would.
 */
export function mcpToolFields(
  server: string,
  tool: { name: string; description?: string; _meta?: Record<string, unknown> },
  alwaysLoad?: boolean,
) {
  const meta = tool._meta ?? {}
  const hint = typeof meta[SEARCH_HINT_META] === "string" ? (meta[SEARCH_HINT_META] as string).replace(/\s+/g, " ").trim().slice(0, 200) : undefined
  return {
    // Claude Code's convention: a server marks its core tools to skip deferral.
    deferrable: !alwaysLoad && meta[ALWAYS_LOAD_META] !== true,
    searchHint: hint || undefined,
    description: (tool.description ?? `Tool ${tool.name} của MCP server ${server}.`).slice(0, MAX_DESCRIPTION),
  }
}

function capInstructions(text: string | undefined) {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  return trimmed.length > MAX_INSTRUCTIONS ? trimmed.slice(0, MAX_INSTRUCTIONS) + "… [đã cắt]" : trimmed
}
const LOGIN_TIMEOUT_MS = 5 * 60_000
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
/** Longest wait a server's retry_after may ask of one call; past it the call fails at once. */
const MAX_RETRY_AFTER_MS = 30_000

const MAX_ERROR = 1000

/**
 * One-line, bounded error text. Proxies and PaaS hosts (Render, Cloudflare) answer a cold
 * or overloaded server with a whole HTML page, which the SDK puts verbatim in the message:
 * keep what precedes it plus the page title.
 */
export function cleanErrorText(text: string): string {
  const html = text.search(/<!doctype html|<html[\s>]/i)
  let out = text
  if (html >= 0) {
    const title = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
    out = `${text.slice(0, html).trim()} [trang HTML${title ? ` "${title}"` : ""}]`
  }
  out = out.replace(/\s+/g, " ").trim()
  return out.length > MAX_ERROR ? out.slice(0, MAX_ERROR) + "…" : out
}

const errorText = (error: unknown) => cleanErrorText(error instanceof Error ? error.message : String(error))
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

/** A 429 for the day's quota (opentrading-mcp `quota_exceeded`): no retry helps before it resets. */
function isQuotaExceeded(error: unknown) {
  return httpStatus(error) === 429 && /"error"\s*:\s*"quota_exceeded"/.test(errorText(error))
}

/**
 * How long a 429/503 asks us to wait, from the JSON body the SDK puts in the message
 * (`{"error":"rate_limited","retry_after":12}`). The SDK keeps no response headers, so a
 * server that only sends a Retry-After header gets the usual back-off.
 */
function retryAfterMs(error: unknown) {
  const status = httpStatus(error)
  if (status !== 429 && status !== 503) return undefined
  const seconds = errorText(error).match(/"retry_after"\s*:\s*(\d+(?:\.\d+)?)/)?.[1]
  return seconds === undefined ? undefined : Number(seconds) * 1000
}

/** Network failures and overloaded servers are worth another try; everything else is not. */
function isTransient(error: unknown) {
  const status = httpStatus(error)
  if (isQuotaExceeded(error)) return false
  if (status !== undefined) return RETRYABLE_STATUS.has(status)
  const text = errorText(error)
  return error instanceof TypeError || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket/i.test(text)
}

/** The connection itself is gone (server down, network cut) — not a protocol-level error. */
function isConnectionLost(error: unknown) {
  if (error instanceof SseError) return true
  // A JSON-RPC error is the server answering, whatever its text says.
  if (error instanceof McpError) return error.code === ErrorCode.ConnectionClosed
  const text = errorText(error)
  return (
    error instanceof TypeError ||
    /ECONNREFUSED|ECONNRESET|fetch failed|socket|Unable to connect|Maximum reconnection attempts|SSE stream disconnected|other side closed|terminated/i.test(text)
  )
}

/**
 * A remote call that died because the server went away or answered 502/503 (a PaaS host
 * restarting it). Our own timeouts are not here: retrying those would only double the wait.
 */
function isRetryable(error: unknown) {
  if (error instanceof TimeoutError || isQuotaExceeded(error)) return false
  if (error instanceof McpError) return error.code === ErrorCode.ConnectionClosed
  return isConnectionLost(error) || isTransient(error)
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Đã huỷ."))
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("Đã huỷ."))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
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
  /** Per-server cap on tool calls in flight, shared by the main agent and subagents. */
  private limiters = new Map<string, Limiter>()
  /** Servers with a reconnect loop running, so a waiting call does not start a second one. */
  private reconnecting = new Set<string>()
  /** Cuts the reconnect loop's current back-off short: a call is waiting, try now. */
  private wakers = new Map<string, () => void>()
  /** One health probe per connection after a 5xx, shared by every call that saw it. */
  private probes = new WeakMap<Live, Promise<void>>()
  /** Until when a server asked us (retry_after) to send no tool calls; shared by every call. */
  private cooldowns = new Map<string, number>()
  private stopping = false
  private trustStore: TrustStore

  constructor(
    private registry: ToolRegistry,
    private opts: McpManagerOptions,
  ) {
    this.trustStore = new TrustStore(opts.trustFile)
  }

  /** Working directory project config is read from. */
  get cwd() {
    return this.opts.cwd
  }

  status(): McpServerStatus[] {
    return [...this.statuses.values()]
  }

  /** `instructions` of connected servers (only trusted servers ever connect), for the system prompt. */
  instructions(): { server: string; text: string }[] {
    return this.status()
      .filter((s) => s.state === "connected" && this.live.has(s.name) && s.instructions)
      .map((s) => ({ server: s.name, text: s.instructions! }))
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
    if (patch.error) patch = { ...patch, error: cleanErrorText(patch.error) }
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
      this.statuses.set(entry.name, initialStatus(entry))
    }
    this.emit()
    await Promise.allSettled(entries.map((entry) => this.connect(entry)))
  }

  /**
   * Re-read the config after an edit (/mcp, `opentrading mcp …`) and touch only what
   * changed: new or edited servers (re)connect, removed ones disconnect, the rest keep
   * their live connection.
   */
  async reload() {
    this.stopping = false
    const entries = await loadServers(this.opts.home, this.opts.cwd)
    const next = new Map(entries.map((e) => [e.name, e]))
    for (const name of [...this.entries.keys()]) {
      if (next.has(name)) continue
      await this.disconnect(name)
      this.entries.delete(name)
      this.statuses.delete(name)
    }
    const changed: ServerEntry[] = []
    const same = (a: ServerEntry, b: ServerEntry) =>
      a.file === b.file && a.scope === b.scope && a.error === b.error && JSON.stringify(a.config) === JSON.stringify(b.config)
    const entriesInOrder = new Map<string, ServerEntry>()
    const statusesInOrder = new Map<string, McpServerStatus>()
    for (const entry of entries) {
      const prev = this.entries.get(entry.name)
      if (prev && same(prev, entry)) {
        entriesInOrder.set(entry.name, prev)
        statusesInOrder.set(entry.name, this.statuses.get(entry.name)!)
        continue
      }
      if (prev) await this.disconnect(entry.name)
      entriesInOrder.set(entry.name, entry)
      statusesInOrder.set(entry.name, initialStatus(entry))
      changed.push(entry)
    }
    // Map order is config order, which decides tool priority under the provider limit.
    this.entries = entriesInOrder
    this.statuses = statusesInOrder
    this.emit()
    await Promise.allSettled(changed.map((entry) => this.connect(entry)))
  }

  /** Turn a server on or off in the file it came from, then apply. */
  async setEnabled(name: string, enabled: boolean) {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Không có server "${name}".`)
    await setServerEnabled(entry.file, name, enabled)
    await this.reload()
  }

  /** Remove a server from its config file and forget its OAuth tokens. */
  async remove(name: string) {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Không có server "${name}".`)
    await deleteServer(entry.file, name)
    await clearOAuth(this.opts.home, name)
    await this.reload()
  }

  /** Add (or replace) a server in the user's global config, saving its secrets first. */
  async add(name: string, config: ServerConfig, secrets: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(secrets)) await setSecretEnv(this.opts.home, key, value)
    await putServer(configFiles(this.opts.home, this.opts.cwd).global, name, config)
    await this.reload()
  }

  /** OAuth state of a remote server for /mcp ("none" when it does not use OAuth). */
  async authStatus(name: string) {
    const config = this.entries.get(name)?.config
    if (!config || !isRemote(config) || !usesOAuth(config)) return "none" as const
    return oauthStatus(this.opts.home, name, config.url)
  }

  /** The OpenTrading market-data server (its readOnlyHint is trusted in ▸▸), by name. */
  isDataServer(name: string) {
    const entry = this.entries.get(name)
    return !!entry && isDataServer(entry.scope, entry.config)
  }

  /** Configured server entry (raw, unexpanded), for /mcp details. */
  entry(name: string) {
    return this.entries.get(name)
  }

  /** The model-visible tools of one server, with their schemas and annotations. */
  toolsOf(name: string) {
    return this.registry.list().filter((t) => t.source === `mcp:${name}`)
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
    if (this.statuses.has(name)) this.set(name, { prompts: [], resources: false, instructions: undefined })
    this.syncResourceTools()
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
      const status = httpStatus(error)
      const hint =
        error instanceof TimeoutError
          ? ` Có thể tăng "startupTimeoutMs" cho server "${name}".`
          : status !== undefined && [502, 503, 504].includes(status)
            ? ` Server tạm thời không phản hồi (HTTP ${status}, có thể đang khởi động hoặc quá tải) — thử "Kết nối lại" sau ít phút.`
            : ""
      return this.set(name, { state: "failed", error: errorText(error) + hint + (tail ? ` — stderr: ${tail}` : "") })
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
      if (isRemote(config)) {
        // Tools stay registered: a call made while we reconnect waits for the new
        // connection (see `ready`) instead of failing — or vanishing from the model.
        void client.close().catch(() => {})
        void this.reconnectLoop(entry, gen)
      } else {
        this.registry.unregister(serverPrefix(name))
        this.set(name, { state: "failed", error: "Mất kết nối tới server.", tools: [] })
      }
    }
    live.drop = dropped
    client.onclose = dropped
    // Remote transports report a dead connection through onerror, not onclose: a broken
    // SSE stream, or the HTTP transport giving up on its GET stream.
    client.onerror = (error) => {
      if (isRemote(config) && isConnectionLost(error)) dropped()
    }
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      void this.syncTools(name, client, config).catch(() => {})
    })
    client.setNotificationHandler(PromptListChangedNotificationSchema, () => {
      void this.syncPrompts(name, client).catch(() => {})
    })
    client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {})

    try {
      await this.syncTools(name, client, config)
      // Prompts are optional extras: a server that fails to list them still works.
      await this.syncPrompts(name, client).catch(() => {})
      this.set(name, {
        state: "connected",
        transport: live.kind,
        resources: Boolean(client.getServerCapabilities()?.resources),
        instructions: capInstructions(client.getInstructions()),
      })
      this.syncResourceTools()
    } catch (error) {
      await this.disconnect(name)
      this.set(name, { state: "failed", error: `Không lấy được danh sách tool: ${errorText(error)}` })
    }
  }

  /**
   * Remote server gone: back off (capped at 30s) and try again until it is back, or until
   * something newer took over (restart, disable, removal, stop). A free PaaS host can take
   * a minute or more to come back, so a fixed number of tries is not enough.
   */
  private async reconnectLoop(entry: ServerEntry, gen: number) {
    if (this.reconnecting.has(entry.name)) return
    this.reconnecting.add(entry.name)
    try {
      const delays = this.opts.reconnectDelaysMs ?? [1000, 2000, 4000, 8000, 16000, 30000]
      for (let i = 0; ; i++) {
        if (!this.current(entry.name, gen)) return
        const last = i > 0 ? this.statuses.get(entry.name)?.error : undefined
        this.set(entry.name, { state: "connecting", error: `Mất kết nối — đang thử lại lần ${i + 1}${last ? ` (${last.slice(0, 120)})` : ""}…` })
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delays[Math.min(i, delays.length - 1)] ?? 1000)
          this.wakers.set(entry.name, () => {
            clearTimeout(timer)
            resolve()
          })
        })
        this.wakers.delete(entry.name)
        if (!this.current(entry.name, gen)) return
        await this.connect(entry)
        if (this.statuses.get(entry.name)?.state !== "failed") return
        gen = this.generation.get(entry.name)!
      }
    } finally {
      this.reconnecting.delete(entry.name)
    }
  }

  /**
   * The live connection for a tool call. While a remote server reconnects (or after it
   * failed to come back), wait up to `waitMs` for it instead of failing at once: with
   * subagents calling in parallel, instant failures just make the model retry dozens of
   * times. Stops early when the server needs the user (auth, approval, disabled).
   */
  private async ready(name: string, waitMs: number, signal: AbortSignal): Promise<Live> {
    const now = this.live.get(name)
    if (now && this.statuses.get(name)?.state === "connected") return now
    const entry = this.entries.get(name)
    const stuck = (s?: McpServerStatus) => !s || s.state === "disabled" || s.state === "needs-auth" || s.state === "untrusted"
    const notConnected = (s?: McpServerStatus) => new Error(`MCP server "${name}" chưa kết nối${s?.error ? `: ${s.error}` : ""}. Xem /mcp.`)
    const status = this.statuses.get(name)
    if (!entry?.config || !isRemote(entry.config) || stuck(status)) throw notConnected(status)
    // Failed for good (e.g. it was still down when the app started): start trying again.
    if (status?.state === "failed" && !this.reconnecting.has(name)) void this.reconnectLoop(entry, this.generation.get(name) ?? 0)
    // Someone is waiting: don't let a 30s back-off outlast the wait.
    else this.wakers.get(name)?.()
    return new Promise<Live>((resolve, reject) => {
      let off = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (fn: () => void) => {
        off()
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
        fn()
      }
      const check = () => {
        const s = this.statuses.get(name)
        const live = this.live.get(name)
        if (live && s?.state === "connected") finish(() => resolve(live))
        else if (stuck(s)) finish(() => reject(notConnected(s)))
      }
      const onAbort = () => finish(() => reject(new Error("Đã huỷ.")))
      if (signal.aborted) return onAbort()
      timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                `MCP server "${name}" đang khởi động lại, chưa kết nối lại được sau ${Math.round(waitMs / 1000)}s. Đợi thêm một lúc rồi thử lại, đừng gọi lặp liên tục.`,
              ),
            ),
          ),
        waitMs,
      )
      signal.addEventListener("abort", onAbort, { once: true })
      off = this.onChange(check)
      check()
    })
  }

  /**
   * A call got 502/503/504. A PaaS proxy answers like that while the app behind it
   * restarts, but so does one overloaded request. Ping once (shared by every call that
   * saw it): if the server does not answer either, treat the connection as dead so
   * callers wait for one reconnect instead of each retrying on their own.
   */
  private probe(live: Live) {
    let pending = this.probes.get(live)
    if (!pending) {
      pending = live.client
        .ping({ timeout: 5_000 })
        .then(() => {}, () => live.drop?.())
        .finally(() => this.probes.delete(live))
      this.probes.set(live, pending)
    }
    return pending
  }

  private limiter(name: string) {
    let limiter = this.limiters.get(name)
    if (!limiter) {
      limiter = new Limiter(() => this.entries.get(name)?.config?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT)
      this.limiters.set(name, limiter)
    }
    return limiter
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
    const tools: z.infer<typeof LooseToolList>["tools"] = []
    let cursor: string | undefined
    do {
      const page = await client.request({ method: "tools/list", params: cursor ? { cursor } : {} }, LooseToolList)
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor && tools.length < MAX_MCP_TOOLS)

    this.registry.unregister(serverPrefix(name))
    const taken = new Set(this.registry.list().map((t) => t.name))
    const toolTimeoutMs = config.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    const startupTimeoutMs = config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    const priority = Math.max(0, [...this.entries.keys()].indexOf(name))
    // "Always allow" rules bind to what the server is (URL or command), not just its name.
    // Scope and the project's folder count too: identical raw config can run different code
    // in another repo (relative paths), and must not inherit the user's global allows.
    const entry = this.entries.get(name)
    const where = entry?.scope === "project" ? `project:${path.dirname(entry.file)}` : "global"
    const permissionScope = entry?.config ? `${where}:${name}@${fingerprint(entry.config)}` : `${where}:${name}`
    const trustedHints = !!entry && isDataServer(entry.scope, entry.config)
    const registered: string[] = []
    let hidden = 0
    for (const tool of tools) {
      const fields = mcpToolFields(name, tool, config.alwaysLoad)
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
        priority,
        ...fields,
        // Raw schema; the registry sanitizes it per provider when building a request.
        input: (tool.inputSchema ?? { type: "object", properties: {} }) as JSONSchema7,
        readOnly: tool.annotations?.readOnlyHint ?? false,
        // Only the OpenTrading data server's word is taken in ▸▸ (catalog.ts isDataServer).
        ...(tool.annotations?.readOnlyHint && !trustedHints ? { autoReview: true } : {}),
        displayName: `${name} · ${tool.annotations?.title ?? tool.name}`,
        annotations: {
          title: tool.annotations?.title,
          destructive: tool.annotations?.destructiveHint,
          openWorld: tool.annotations?.openWorldHint,
        },
        permissionScope,
        // The wrapper's own timer is a backstop; the SDK enforces the real per-call timeout.
        // Room for waiting on a reconnect and the server's queue, and for retries of a read-only call.
        timeoutMs: (tool.annotations?.readOnlyHint ? 2 : 1) * toolTimeoutMs + startupTimeoutMs + 5_000,
        maxOutputChars: config.maxOutputChars,
        summarize: (input) => `${name} · ${tool.name}(${compactArgs(input)})`,
        execute: async (input, ctx) => {
          const args = (input as Record<string, unknown>) ?? {}
          // A plain request instead of client.callTool: callTool checks structuredContent
          // against the tool's outputSchema and throws on a mismatch — after the tool ran.
          // Retrying would run a write tool twice, so we skip that check; the model reads
          // the content either way.
          const call = (live: Live) =>
            live.client.request({ method: "tools/call", params: { name: tool.name, arguments: args } }, CallToolResultSchema, {
              signal: ctx.signal,
              timeout: toolTimeoutMs,
              resetTimeoutOnProgress: true,
              // Without a progress handler the SDK sends no progress token, so the timeout
              // could never be reset by a long-running tool reporting progress.
              onprogress: () => {},
            })
          // At most `maxConcurrent` calls hit the server at once; queueing is not call time
          // (the SDK timeout starts with the request).
          const limited = async (live: Live) => {
            // Local (stdio) servers are not capped: they share our machine, not a tiny host.
            if (!isRemote(config)) return call(live)
            // The server asked for a pause (retry_after): wait it out without holding a slot,
            // so parallel calls do not each spend a retry on the same 429. Checked again once
            // a slot is ours: the pause may have started while we were queued.
            const cooldown = () => (this.cooldowns.get(name) ?? 0) - Date.now()
            for (;;) {
              if (cooldown() > 0) await pause(cooldown(), ctx.signal)
              const release = await this.limiter(name).acquire(ctx.signal)
              if (cooldown() > 0) {
                release()
                continue
              }
              try {
                return await call(live)
              } finally {
                release()
              }
            }
          }
          const retryDelays = this.opts.callRetryDelaysMs ?? [1000, 3000]
          // Only read-only calls are retried: a write may already have run on the server.
          const retries = isRemote(config) && tool.annotations?.readOnlyHint ? retryDelays.length : 0
          for (let attempt = 0; ; attempt++) {
            const live = await this.ready(name, startupTimeoutMs, ctx.signal)
            let result: Awaited<ReturnType<typeof call>>
            try {
              result = await limited(live)
            } catch (error) {
              if (ctx.signal.aborted) throw error
              if (isRemote(config) && isAuthError(error)) {
                this.set(name, { state: "needs-auth", error: authHint(name, config, error) })
                throw new Error(authHint(name, config, error))
              }
              if (isRemote(config) && isSessionExpired(error) && attempt === 0) {
                // Session expired on the server: initialize again and retry exactly once.
                // Parallel calls that all hit the 404 share one restart instead of killing
                // each other's fresh session.
                await this.restartShared(name)
                continue
              }
              if (isRemote(config) && isQuotaExceeded(error)) {
                const wait = retryAfterMs(error)
                const reset = wait === undefined ? "" : ` (khoảng ${new Date(Date.now() + wait).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })})`
                throw new Error(`MCP server "${name}" đã hết quota trong ngày; không tự thử lại. Gọi lại sau khi quota được đặt lại${reset}.`)
              }
              if (!isRemote(config) || !isRetryable(error)) throw error
              const wait = retryAfterMs(error)
              if (wait !== undefined && wait <= MAX_RETRY_AFTER_MS) {
                this.cooldowns.set(name, Math.max(this.cooldowns.get(name) ?? 0, Date.now() + wait))
              }
              // The connection itself died: reconnect in the background; the next attempt
              // (or the model's next call) waits for it in `ready`. A 503 with retry_after is
              // a live server shedding load, not a host restarting: no probe.
              if (isConnectionLost(error)) live.drop?.()
              else if ([502, 503, 504].includes(httpStatus(error) ?? 0) && wait === undefined) await this.probe(live)
              if (attempt >= retries || (wait !== undefined && wait > MAX_RETRY_AFTER_MS)) {
                const status = httpStatus(error)
                const why = status ? `HTTP ${status}` : errorText(error)
                const what = status === 429 ? `bị giới hạn tốc độ (${why})` : `lỗi tạm thời (${why}) — có thể đang khởi động lại hoặc quá tải`
                const later = wait === undefined ? "" : ` Server yêu cầu chờ ${Math.ceil(wait / 1000)} giây trước khi gọi lại.`
                // A retry_after refusal came before the tool ran: nothing was written to check.
                const tail =
                  attempt > 0
                    ? ` Đã thử lại ${attempt} lần.`
                    : tool.annotations?.readOnlyHint
                      ? ""
                      : wait === undefined
                        ? " Tool này có thể ghi dữ liệu nên không tự thử lại; kiểm tra kết quả trước khi gọi lại."
                        : " Tool này có thể ghi dữ liệu nên không tự thử lại; server đã từ chối trước khi chạy nên có thể gọi lại sau khi chờ."
                throw new Error(`MCP server "${name}" ${what}.${later}${tail}`)
              }
              await pause(wait ?? retryDelays[attempt]!, ctx.signal)
              continue
            }
            // Outside the try: an error the tool itself reports (isError) is an answer, not a
            // dead connection, even when its text says "ECONNRESET".
            return resultToOutput(result)
          }
        },
      })
    }
    this.set(name, { tools: registered, hiddenTools: hidden })
  }

  private async syncPrompts(name: string, client: Client) {
    if (!client.getServerCapabilities()?.prompts) return this.set(name, { prompts: [] })
    const prompts: McpPromptInfo[] = []
    let cursor: string | undefined
    do {
      const page = await client.request({ method: "prompts/list", params: cursor ? { cursor } : {} }, LoosePromptList)
      for (const p of page.prompts) prompts.push({ name: p.name, description: p.description, arguments: p.arguments ?? [] })
      cursor = page.nextCursor
    } while (cursor && prompts.length < MAX_MCP_PROMPTS)
    this.set(name, { prompts })
  }

  /** Every prompt of every connected server, for slash-command suggestions. */
  allPrompts(): (McpPromptInfo & { server: string })[] {
    return this.status().flatMap((s) => (s.state === "connected" ? s.prompts.map((p) => ({ ...p, server: s.name })) : []))
  }

  /**
   * Fetch a prompt and flatten it to the text sent as the user's message. Messages in
   * other roles are kept and labelled, so nothing the server adds is hidden.
   */
  async getPrompt(server: string, prompt: string, args: Record<string, string>) {
    const live = this.live.get(server)
    if (!live) throw new Error(`MCP server "${server}" chưa kết nối. Xem /mcp.`)
    const result = await live.client.request({ method: "prompts/get", params: { name: prompt, arguments: args } }, LooseGetPrompt)
    const parts = result.messages.map((m) => {
      const { text, image } = blockToParts(m.content as Parameters<typeof blockToParts>[0])
      const body = text ?? (image ? `[ảnh ${image.mediaType} — chưa hỗ trợ trong prompt]` : "")
      return m.role === "user" ? body : `(${m.role === "assistant" ? "gợi ý của server" : m.role}) ${body}`
    })
    return parts.filter(Boolean).join("\n\n")
  }

  /** Register or remove the resource tools depending on whether any server offers resources. */
  private syncResourceTools() {
    const any = this.status().some((s) => s.state === "connected" && s.resources)
    const has = Boolean(this.registry.get(RESOURCE_TOOLS[0]))
    if (any === has) return
    if (!any) return this.registry.unregisterSource("mcp:resources")
    this.registry.register({
      name: "list_mcp_resources",
      source: "mcp:resources",
      description:
        "Liệt kê tài nguyên (file, tài liệu, bảng dữ liệu…) mà các MCP server cung cấp: server, uri, tên, mô tả. Đọc nội dung bằng read_mcp_resource.",
      input: { type: "object", properties: { server: { type: "string", description: "Tên server; bỏ trống = mọi server" } } },
      readOnly: true,
      summarize: (input: { server?: string }) => `list_mcp_resources(${input?.server ?? ""})`,
      execute: async (input: { server?: string }) => JSON.stringify(await this.listResources(input?.server), null, 2),
    })
    this.registry.register({
      name: "read_mcp_resource",
      source: "mcp:resources",
      description: "Đọc nội dung một tài nguyên MCP theo server và uri (lấy từ list_mcp_resources).",
      input: { type: "object", properties: { server: { type: "string" }, uri: { type: "string" } }, required: ["server", "uri"] },
      readOnly: true,
      summarize: (input: { server?: string; uri?: string }) => `read_mcp_resource(${input?.server ?? ""} ${input?.uri ?? ""})`,
      execute: (input: { server: string; uri: string }) => this.readResource(input.server, input.uri),
    })
  }

  async listResources(server?: string) {
    const targets = this.status().filter((s) => s.state === "connected" && s.resources && (!server || s.name === server))
    if (server && targets.length === 0) throw new Error(`Server "${server}" không có tài nguyên hoặc chưa kết nối.`)
    const out: { server: string; uri: string; name?: string; description?: string; mimeType?: string }[] = []
    for (const s of targets) {
      const live = this.live.get(s.name)
      if (!live) continue
      let cursor: string | undefined
      do {
        const page = await live.client.request({ method: "resources/list", params: cursor ? { cursor } : {} }, LooseResourceList)
        for (const r of page.resources) out.push({ server: s.name, uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType })
        cursor = page.nextCursor
      } while (cursor && out.length < MAX_MCP_RESOURCES)
    }
    return out
  }

  async readResource(server: string, uri: string) {
    const live = this.live.get(server)
    if (!live) throw new Error(`MCP server "${server}" chưa kết nối. Xem /mcp.`)
    const result = await live.client.request({ method: "resources/read", params: { uri } }, LooseReadResource)
    return resultToOutput({ content: result.contents.map((c) => ({ type: "resource", resource: c })) })
  }
}

function initialStatus(entry: ServerEntry): McpServerStatus {
  const config = entry.config
  return {
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
    prompts: [],
    resources: false,
  }
}

function compactArgs(input: unknown) {
  const text = JSON.stringify(input ?? {})
  return text === "{}" ? "" : text.length > 60 ? text.slice(0, 57) + "…" : text
}
