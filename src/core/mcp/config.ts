import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { readJson, writeJson } from "../store"

/**
 * MCP server config, in the same `{ "mcpServers": { ... } }` shape Claude Code uses,
 * so one `.mcp.json` works in both tools. OpenTrading-only fields are optional.
 */
const Common = {
  enabled: z.boolean().optional(),
  /** Connect + initialise timeout. Default 30s. */
  startupTimeoutMs: z.number().int().positive().optional(),
  /** Per tool call timeout. Default 60s. */
  toolTimeoutMs: z.number().int().positive().optional(),
  /** Only these tools are exposed (wildcard `*` allowed). Unset = all. */
  enabledTools: z.array(z.string()).optional(),
  /** These tools are hidden (wildcard `*` allowed); applied after `enabledTools`. */
  disabledTools: z.array(z.string()).optional(),
  /** Per-result output cap in characters. */
  maxOutputChars: z.number().int().positive().optional(),
}

const OAuth = z.union([
  z.literal(false),
  z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    scope: z.string().optional(),
    callbackPort: z.number().int().min(1).max(65535).optional(),
  }),
])
export type OAuthConfig = z.infer<typeof OAuth>

const Stdio = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  ...Common,
})

const Remote = {
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  /** OAuth settings; `false` never attempts OAuth even when the server asks for it. */
  oauth: OAuth.optional(),
  ...Common,
}
const Http = z.object({ type: z.literal("http"), ...Remote })
const Sse = z.object({ type: z.literal("sse"), ...Remote })

/** A bare `{ url }` (common in copied snippets) means Streamable HTTP. */
const withDefaultType = (value: unknown) =>
  value && typeof value === "object" && "url" in value && !("type" in value) ? { ...value, type: "http" } : value

export const ServerConfig = z.preprocess(withDefaultType, z.union([Stdio, Http, Sse]))
export type ServerConfig = z.infer<typeof ServerConfig>
export type RemoteConfig = Extract<ServerConfig, { url: string }>
export type StdioConfig = Exclude<ServerConfig, { url: string }>

export const isRemote = (config: ServerConfig): config is RemoteConfig => "url" in config

export type Scope = "global" | "project"

export interface ServerEntry {
  name: string
  scope: Scope
  /** File the entry came from, for error messages. */
  file: string
  config?: ServerConfig
  /** Set when the entry is invalid; the server shows as failed with this message. */
  error?: string
}

export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000

/** Server names become part of tool names and config keys. */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,48}$/

export function configFiles(home: string, cwd: string) {
  return {
    global: path.join(home, "mcp.json"),
    project: path.join(cwd, ".mcp.json"),
  }
}

async function readServers(file: string, scope: Scope): Promise<ServerEntry[]> {
  const raw = await readJson<unknown>(file, undefined)
  if (raw === undefined) return []
  const servers = (raw as { mcpServers?: unknown })?.mcpServers
  if (!servers || typeof servers !== "object") {
    return [{ name: path.basename(file), scope, file, error: `${file}: thiếu khoá "mcpServers".` }]
  }
  return Object.entries(servers).map(([name, value]) => {
    const parsed = ServerConfig.safeParse(value)
    if (parsed.success) return { name, scope, file, config: parsed.data }
    const issue = parsed.error.issues[0]
    return { name, scope, file, error: `Cấu hình không hợp lệ (${issue?.path.join(".") || name}): ${issue?.message}` }
  })
}

/** Global servers first, then project ones; a project entry replaces a global one of the same name. */
export async function loadServers(home: string, cwd: string): Promise<ServerEntry[]> {
  const files = configFiles(home, cwd)
  const [global, project] = await Promise.all([readServers(files.global, "global"), readServers(files.project, "project")])
  const byName = new Map<string, ServerEntry>()
  for (const entry of [...global, ...project]) byName.set(entry.name, entry)
  return [...byName.values()]
}

/**
 * Read a config file for editing. A missing file is an empty config; a file that exists
 * but does not parse is an error — we never overwrite what we could not read.
 */
async function readForEdit(file: string): Promise<Record<string, unknown> & { mcpServers: Record<string, unknown> }> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch {
    return { mcpServers: {} }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`Không đọc được ${file} (JSON lỗi: ${(error as Error).message}). Sửa file trước rồi thử lại.`)
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${file} phải là một object JSON.`)
  const obj = raw as Record<string, unknown>
  const servers = obj.mcpServers
  if (servers !== undefined && (typeof servers !== "object" || servers === null || Array.isArray(servers))) {
    throw new Error(`${file}: "mcpServers" phải là object.`)
  }
  return { ...obj, mcpServers: (servers as Record<string, unknown>) ?? {} }
}

/** Add or replace one server, keeping every other key and server in the file. */
export async function putServer(file: string, name: string, config: ServerConfig) {
  if (!SERVER_NAME.test(name)) throw new Error(`Tên server "${name}" chỉ được dùng chữ, số, "_" và "-" (tối đa 48 ký tự).`)
  const parsed = ServerConfig.safeParse(config)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Cấu hình không hợp lệ (${issue?.path.join(".") || name}): ${issue?.message}`)
  }
  const data = await readForEdit(file)
  data.mcpServers[name] = config
  await writeJson(file, data)
}

/** Remove one server; returns false when it was not there. */
export async function deleteServer(file: string, name: string) {
  const data = await readForEdit(file)
  if (!(name in data.mcpServers)) return false
  delete data.mcpServers[name]
  await writeJson(file, data)
  return true
}

/** Flip `enabled` on one server without touching anything else. */
export async function setServerEnabled(file: string, name: string, enabled: boolean) {
  const data = await readForEdit(file)
  const current = data.mcpServers[name]
  if (!current || typeof current !== "object") throw new Error(`Không có server "${name}" trong ${file}.`)
  const next = { ...(current as Record<string, unknown>) }
  if (enabled) delete next.enabled
  else next.enabled = false
  data.mcpServers[name] = next
  await writeJson(file, data)
}

type Env = Record<string, string | undefined>

/**
 * Expand `${VAR}` and `${VAR:-default}`. Real environment variables win; `secrets`
 * (values saved with `opentrading mcp add --secret` / the /mcp dialog) fill the rest.
 * Unset variables without a default are reported so the user sees exactly what to set.
 */
export function expandEnv(value: string, env: Env = process.env, secrets: Env = {}) {
  const missing: string[] = []
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => {
    const found = env[name] || secrets[name]
    if (found !== undefined && found !== "") return found
    if (fallback !== undefined) return fallback
    missing.push(name)
    return ""
  })
  return { value: expanded, missing }
}

/** Expand every string field of a server config; returns the variables that were missing. */
export function expandConfig(config: ServerConfig, env: Env = process.env, secrets: Env = {}) {
  const missing = new Set<string>()
  const one = (v: string) => {
    const r = expandEnv(v, env, secrets)
    r.missing.forEach((m) => missing.add(m))
    return r.value
  }
  const record = (r?: Record<string, string>) => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, one(v)])) : undefined)
  const result: ServerConfig = isRemote(config)
    ? { ...config, url: one(config.url), headers: record(config.headers) }
    : { ...config, command: one(config.command), args: config.args?.map(one), env: record(config.env), cwd: config.cwd && one(config.cwd) }
  return { config: result, missing: [...missing] }
}

/** `*` matches any run of characters; everything else is literal. */
function wildcard(pattern: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`)
}

/** Whether a server-side tool name passes the server's `enabledTools` / `disabledTools`. */
export function toolAllowed(config: ServerConfig, tool: string) {
  if (config.enabledTools && !config.enabledTools.some((p) => wildcard(p).test(tool))) return false
  if (config.disabledTools?.some((p) => wildcard(p).test(tool))) return false
  return true
}
