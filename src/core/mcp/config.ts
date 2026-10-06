import path from "node:path"
import { z } from "zod"
import { readJson } from "../store"

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
  /** Tool output longer than this is cut (head + tail) before the model sees it. Default 12 000. */
  maxOutputChars: z.number().int().positive().optional(),
}

const Stdio = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  ...Common,
})

const Http = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  ...Common,
})

export const ServerConfig = z.union([Stdio, Http])
export type ServerConfig = z.infer<typeof ServerConfig>

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
export const DEFAULT_MCP_OUTPUT_CHARS = 12_000

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
 * Expand `${VAR}` and `${VAR:-default}` from process.env.
 * Unset variables without a default are reported so the user sees exactly what to set.
 */
export function expandEnv(value: string, env: Record<string, string | undefined> = process.env) {
  const missing: string[] = []
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => {
    const found = env[name]
    if (found !== undefined && found !== "") return found
    if (fallback !== undefined) return fallback
    missing.push(name)
    return ""
  })
  return { value: expanded, missing }
}

/** Expand every string field of a server config; returns the variables that were missing. */
export function expandConfig(config: ServerConfig, env: Record<string, string | undefined> = process.env) {
  const missing = new Set<string>()
  const one = (v: string) => {
    const r = expandEnv(v, env)
    r.missing.forEach((m) => missing.add(m))
    return r.value
  }
  const record = (r?: Record<string, string>) => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, one(v)])) : undefined)
  const result: ServerConfig =
    "url" in config
      ? { ...config, url: one(config.url), headers: record(config.headers) }
      : { ...config, command: one(config.command), args: config.args?.map(one), env: record(config.env), cwd: config.cwd && one(config.cwd) }
  return { config: result, missing: [...missing] }
}
