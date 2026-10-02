import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import type { ToolRegistry } from "../tools/registry"
import {
  DEFAULT_MCP_OUTPUT_CHARS,
  DEFAULT_MCP_PRESET,
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_TOOL_TIMEOUT_MS,
  expandConfig,
  loadServers,
  type Scope,
  type ServerConfig,
  type ServerEntry,
} from "./config"
import { normalizeSchema, resultToText } from "./convert"
import { serverPrefix, toolName } from "./naming"
import { isPreset, presetCounts, presetsOf, type PresetName } from "./presets"
import { envSecrets } from "./onboard"
import { TrustStore, trustKey } from "./trust"

export type McpState = "connecting" | "connected" | "failed" | "disabled" | "untrusted"

export interface McpPromptInfo {
  name: string
  description?: string
  /** Prompt arguments, in declaration order. */
  arguments?: { name: string; description?: string; required?: boolean }[]
}

export interface McpServerStatus {
  name: string
  scope: Scope
  transport: "stdio" | "http"
  state: McpState
  error?: string
  /** Model-visible tool names. */
  tools: string[]
  /** Configured preset for this server. */
  preset: PresetName
  /** Tool counts per preset across everything the server serves; `khác` = untable. */
  presetCounts?: Record<string, number>
  /** Workflows the server exposes as MCP prompts. */
  prompts: McpPromptInfo[]
  /** Config file the server came from. */
  file: string
  /** What it runs or connects to — shown before the user approves a project server. */
  target: string
}

interface Live {
  client: Client
  transport: Transport
}

/** Windows needs these for child processes to resolve `.cmd`/`.exe`; none of them hold secrets. */
const WINDOWS_EXTRA_ENV = ["PATHEXT", "COMSPEC", "WINDIR"]

const MAX_DESCRIPTION = 2048

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Connects to every configured MCP server in parallel and mirrors their tools into the
 * ToolRegistry. A failing server never blocks the app — it just shows up as failed in /mcp.
 */
export class McpManager {
  private entries = new Map<string, ServerEntry>()
  private statuses = new Map<string, McpServerStatus>()
  private live = new Map<string, Live>()
  private listeners = new Set<(status: McpServerStatus[]) => void>()
  private stopping = false
  private trustStore: TrustStore

  constructor(
    private registry: ToolRegistry,
    private opts: { home: string; cwd: string; trustFile: string },
  ) {
    this.trustStore = new TrustStore(opts.trustFile)
  }

  status(): McpServerStatus[] {
    return [...this.statuses.values()]
  }

  /** Prompts of every connected server, flattened with their server name. */
  allPrompts(): (McpPromptInfo & { server: string })[] {
    return this.status().flatMap((s) => s.prompts.map((p) => ({ ...p, server: s.name })))
  }

  /** Convenience for the slash-command path: fetch a prompt by name from its server. */
  async promptByName(promptName: string, args: Record<string, string>): Promise<{ server: string; text: string }> {
    const entry = this.allPrompts().find((p) => p.name === promptName)
    if (!entry) throw new Error(`Không có MCP prompt "${promptName}".`)
    const text = await this.getPrompt(entry.server, promptName, args)
    return { server: entry.server, text }
  }

  onChange(listener: (status: McpServerStatus[]) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(name: string, patch: Partial<McpServerStatus>) {
    const prev = this.statuses.get(name)!
    this.statuses.set(name, { ...prev, ...patch })
    const snapshot = this.status()
    for (const listener of this.listeners) listener(snapshot)
  }

  /** Read config and connect everything. Resolves once every server has settled. */
  async start() {
    const entries = await loadServers(this.opts.home, this.opts.cwd)
    for (const entry of entries) {
      this.entries.set(entry.name, entry)
      this.statuses.set(entry.name, {
        name: entry.name,
        scope: entry.scope,
        file: entry.file,
        transport: entry.config && "url" in entry.config ? "http" : "stdio",
        preset: entry.config?.preset && isPreset(entry.config.preset) ? entry.config.preset : DEFAULT_MCP_PRESET,
        target: !entry.config ? "" : "url" in entry.config ? entry.config.url : [entry.config.command, ...(entry.config.args ?? [])].join(" "),
        state: "connecting",
        tools: [],
        prompts: [],
      })
    }
    for (const listener of this.listeners) listener(this.status())
    await Promise.allSettled(entries.map((entry) => this.connect(entry)))
  }

  /** Approve a project server, then connect it. */
  async trust(name: string) {
    const entry = this.entries.get(name)
    if (!entry?.config) return
    await this.trustStore.trust(trustKey(this.opts.cwd, name, entry.config))
    await this.connect(entry)
  }

  /** Switch which tool preset a server exposes; takes effect on the model's next step. */
  async setPreset(name: string, preset: PresetName) {
    const entry = this.entries.get(name)
    if (!entry?.config) return
    this.entries.set(name, { ...entry, config: { ...entry.config, preset } })
    this.set(name, { preset })
  }

  async restart(name: string) {
    const entry = this.entries.get(name)
    if (!entry) return
    await this.disconnect(name)
    await this.connect(entry)
  }

  async stop() {
    this.stopping = true
    await Promise.allSettled([...this.live.keys()].map((name) => this.disconnect(name)))
  }

  private async disconnect(name: string) {
    const live = this.live.get(name)
    this.live.delete(name)
    this.registry.unregister(serverPrefix(name))
    if (live) await live.client.close().catch(() => {})
  }

  private async connect(entry: ServerEntry) {
    const { name } = entry
    if (entry.error || !entry.config) return this.set(name, { state: "failed", error: entry.error })
    if (entry.config.enabled === false) return this.set(name, { state: "disabled", error: undefined })
    if (entry.scope === "project" && !(await this.trustStore.isTrusted(trustKey(this.opts.cwd, name, entry.config)))) {
      return this.set(name, { state: "untrusted", error: undefined })
    }

    // `${NAME}` placeholders resolve from process.env plus the secret entries saved by
    // onboarding (auth.json `_env_<NAME>` — keys on disk, not exported shell vars).
    const env = { ...process.env, ...(await envSecrets(this.opts.home)) }
    const { config, missing } = expandConfig(entry.config, env)
    if (missing.length > 0) {
      const hint = missing.some((m) => m === "OPENTRADING_MCP_TOKEN")
        ? " Xin TEAM_TOKEN từ admin, dán vào /mcp-setup hoặc ~/.opentrading/auth.json."
        : ""
      return this.set(name, {
        state: "failed",
        error: `Thiếu biến môi trường: ${missing.join(", ")}${hint ? "." + hint : ""}`,
      })
    }

    this.set(name, { state: "connecting", error: undefined, tools: [] })
    const stderr: string[] = []
    const transport = this.transport(entry, config, stderr)
    const client = new Client({ name: "opentrading", version: "0.1.0" }, { capabilities: {} })
    const timeoutMs = config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS

    try {
      await withTimeout(
        client.connect(transport),
        timeoutMs,
        `Kết nối quá ${timeoutMs / 1000}s. Có thể tăng "startupTimeoutMs" cho server "${name}".`,
      )
    } catch (error) {
      await client.close().catch(() => {})
      const tail = stderr.join("").trim().split("\n").slice(-3).join(" | ")
      return this.set(name, { state: "failed", error: errorText(error) + (tail ? ` — stderr: ${tail}` : "") })
    }

    this.live.set(name, { client, transport })
    client.onclose = () => {
      if (this.stopping || this.live.get(name)?.client !== client) return
      this.live.delete(name)
      this.registry.unregister(serverPrefix(name))
      this.set(name, { state: "failed", error: "Mất kết nối tới server.", tools: [] })
    }
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      void this.syncTools(name, client, config).catch(() => {})
    })

    try {
      await this.syncTools(name, client, config)
      await this.syncPrompts(name, client)
      this.set(name, { state: "connected" })
    } catch (error) {
      await this.disconnect(name)
      this.set(name, { state: "failed", error: `Không lấy được danh sách tool: ${errorText(error)}` })
    }
  }

  /** Read the server's prompt workflows (best effort — most servers have none). */
  private async syncPrompts(name: string, client: Client) {
    try {
      const caps = client.getServerCapabilities()
      if (!caps?.prompts) return this.set(name, { prompts: [] })
      const prompts: McpPromptInfo[] = []
      let cursor: string | undefined
      do {
        const page = await client.listPrompts(cursor ? { cursor } : undefined)
        prompts.push(
          ...page.prompts.map((p) => ({
            name: p.name,
            description: p.description,
            arguments: (p.arguments ?? []).map((a) => ({ name: a.name, description: a.description, required: a.required })),
          })),
        )
        cursor = page.nextCursor
      } while (cursor && prompts.length < 128)
      this.set(name, { prompts })
    } catch {
      this.set(name, { prompts: [] })
    }
  }

  /** Fetch a prompt's composed text (the slash-command body). Throws on server errors. */
  async getPrompt(name: string, promptName: string, args: Record<string, string> = {}): Promise<string> {
    const live = this.live.get(name)
    if (!live) throw new Error(`MCP server "${name}" chưa kết nối. Xem /mcp.`)
    const result = await live.client.getPrompt({ name: promptName, arguments: args })
    return result.messages
      .map((message) => {
        const content = message.content
        if (content.type === "text") return content.text
        return `[nội dung loại ${content.type}]`
      })
      .join("\n\n")
  }

  private transport(entry: ServerEntry, config: ServerConfig, stderr: string[]): Transport {
    if ("url" in config) {
      return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
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

  private async syncTools(name: string, client: Client, config: ServerConfig) {
    const tools: { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined)
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor && tools.length < 2048)

    // Everything the server serves is registered; which preset the model may call is
    // narrowed per step by the agent (activeTools), so a switch_preset takes effect
    // immediately without re-serialising tool definitions.
    this.registry.unregister(serverPrefix(name))
    const taken = new Set(this.registry.list().map((t) => t.name))
    const toolTimeoutMs = config.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    const maxOutputChars = config.maxOutputChars ?? DEFAULT_MCP_OUTPUT_CHARS
    const registered: string[] = []
    for (const tool of tools) {
      const modelName = toolName(name, tool.name, taken)
      taken.add(modelName)
      registered.push(modelName)
      this.registry.register({
        name: modelName,
        source: `mcp:${name}`,
        description: (tool.description ?? `Tool ${tool.name} của MCP server ${name}.`).slice(0, MAX_DESCRIPTION),
        input: normalizeSchema(tool.inputSchema),
        readOnly: tool.annotations?.readOnlyHint ?? false,
        presets: presetsOf(tool.name),
        // The wrapper's own timer is a backstop; the SDK enforces the real per-call timeout.
        timeoutMs: toolTimeoutMs + 5_000,
        maxOutputChars,
        summarize: (input) => `${name} · ${tool.name}(${compactArgs(input)})`,
        execute: async (input, ctx) => {
          const live = this.live.get(name)
          if (!live) throw new Error(`MCP server "${name}" chưa kết nối. Xem /mcp.`)
          const result = await live.client.callTool(
            { name: tool.name, arguments: (input as Record<string, unknown>) ?? {} },
            undefined,
            { signal: ctx.signal, timeout: toolTimeoutMs, resetTimeoutOnProgress: true },
          )
          return resultToText(result as Parameters<typeof resultToText>[0])
        },
      })
    }
    this.set(name, {
      tools: registered,
      presetCounts: presetCounts(tools.map((t) => t.name)),
    })
  }
}

function compactArgs(input: unknown) {
  const text = JSON.stringify(input ?? {})
  return text === "{}" ? "" : text.length > 60 ? text.slice(0, 57) + "…" : text
}
