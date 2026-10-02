import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { discoverOAuthServerInfo } from "@modelcontextprotocol/sdk/client/auth.js"
import { maskKey } from "../core/auth"
import {
  configFiles,
  deleteServer,
  expandConfig,
  isRemote,
  loadServers,
  putServer,
  type Scope,
  ServerConfig,
  setServerEnabled,
} from "../core/mcp/config"
import { McpManager, type McpServerStatus } from "../core/mcp/manager"
import { oauthStatus } from "../core/mcp/oauth"
import { clearOAuth, secretEnv, setSecretEnv } from "../core/mcp/secrets"
import { dataDir } from "../core/paths"
import { readJson } from "../core/store"
import { ToolRegistry } from "../core/tools/registry"

/**
 * `opentrading mcp …` — manage MCP servers without opening the TUI, modelled on
 * `claude mcp` and `opencode mcp`. Config goes to ~/.opentrading/mcp.json (`--scope user`,
 * default) or ./.mcp.json (`--scope project`); secrets go to ~/.opentrading/mcp-auth.json.
 */

const HELP = `Quản lý MCP server

  opentrading mcp list                         kết nối thử mọi server, in trạng thái
  opentrading mcp get <tên>                    cấu hình + trạng thái một server
  opentrading mcp add <tên> <url>              server remote (Streamable HTTP; tự thử SSE nếu cần)
  opentrading mcp add <tên> -- <lệnh> [args…]  server chạy bằng lệnh (stdio)
      -s, --scope user|project   user = ~/.opentrading/mcp.json (mặc định), project = ./.mcp.json
      -t, --transport http|sse|stdio
      -H, --header "Tên: giá trị"  (dùng \${BIẾN} cho token, rồi: mcp secret set BIẾN)
      -e, --env TÊN=giá_trị        biến môi trường cho server stdio
      --client-id <id>  --oauth-scope "<scopes>"  --callback-port <port>  --no-oauth
      --force                      ghi đè server cùng tên
  opentrading mcp add-json <tên> '<json>' [-s scope]
  opentrading mcp import claude [--all | <tên>…]  nhập server từ Claude Code / Claude Desktop
  opentrading mcp remove <tên> [-s scope]
  opentrading mcp enable|disable <tên>
  opentrading mcp login <tên>                  đăng nhập OAuth (mở trình duyệt)
  opentrading mcp logout <tên>
  opentrading mcp secret set <TÊN> [giá_trị]  lưu giá trị cho \${TÊN} (bỏ trống → nhập từ bàn phím)
  opentrading mcp secret unset <TÊN> | list
  opentrading mcp debug <tên>                  chẩn đoán kết nối / OAuth
`

class UsageError extends Error {}

interface Parsed {
  positional: string[]
  /** Everything after `--`. */
  rest: string[]
  flags: Map<string, string[]>
}

const FLAG_ALIASES: Record<string, string> = { s: "scope", t: "transport", H: "header", e: "env" }
const BOOLEAN_FLAGS = new Set(["force", "all", "no-oauth", "help"])

export function parseArgs(argv: string[]): Parsed {
  const positional: string[] = []
  const flags = new Map<string, string[]>()
  let rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--") {
      rest = argv.slice(i + 1)
      break
    }
    const match = /^(?:--([a-z-]+)|-([a-zA-Z]))(?:=(.*))?$/.exec(arg)
    if (!match) {
      positional.push(arg)
      continue
    }
    const name = match[1] ?? FLAG_ALIASES[match[2]!] ?? match[2]!
    let value = match[3]
    if (value === undefined) {
      if (BOOLEAN_FLAGS.has(name)) value = "true"
      else {
        value = argv[++i]
        if (value === undefined) throw new UsageError(`Thiếu giá trị cho --${name}.`)
      }
    }
    flags.set(name, [...(flags.get(name) ?? []), value])
  }
  return { positional, rest, flags }
}

const flag = (p: Parsed, name: string) => p.flags.get(name)?.at(-1)
const has = (p: Parsed, name: string) => p.flags.has(name)

function scopeOf(p: Parsed): Scope | undefined {
  const s = flag(p, "scope")
  if (s === undefined) return undefined
  if (s === "user" || s === "global") return "global"
  if (s === "project") return "project"
  throw new UsageError(`--scope phải là user hoặc project (nhận: ${s}).`)
}

function fileFor(scope: Scope, home: string, cwd: string) {
  return configFiles(home, cwd)[scope]
}

/** Build a server config from `mcp add` arguments. Exported for tests. */
export function configFromArgs(p: Parsed): ServerConfig {
  const transport = flag(p, "transport")
  const url = p.positional[2]
  const headers: Record<string, string> = {}
  for (const h of p.flags.get("header") ?? []) {
    const i = h.indexOf(":")
    if (i <= 0) throw new UsageError(`Header phải có dạng "Tên: giá trị" (nhận: ${h}).`)
    headers[h.slice(0, i).trim()] = h.slice(i + 1).trim()
  }
  const env: Record<string, string> = {}
  for (const e of p.flags.get("env") ?? []) {
    const i = e.indexOf("=")
    if (i <= 0) throw new UsageError(`--env phải có dạng TÊN=giá_trị (nhận: ${e}).`)
    env[e.slice(0, i)] = e.slice(i + 1)
  }

  if (p.rest.length > 0 || transport === "stdio") {
    const [command, ...args] = p.rest.length > 0 ? p.rest : p.positional.slice(2)
    if (!command) throw new UsageError("Thiếu lệnh. Ví dụ: opentrading mcp add fs -- npx -y @modelcontextprotocol/server-filesystem D:/data")
    if (Object.keys(headers).length > 0) throw new UsageError("--header chỉ dùng cho server remote.")
    return { command, args, ...(Object.keys(env).length > 0 ? { env } : {}) }
  }
  if (!url) throw new UsageError("Thiếu URL hoặc lệnh (sau --).")
  if (!/^https?:\/\//i.test(url)) {
    throw new UsageError(`"${url}" không phải URL. Server chạy bằng lệnh thì đặt sau dấu --, ví dụ: opentrading mcp add tên -- ${url}`)
  }
  if (transport && transport !== "http" && transport !== "sse") throw new UsageError(`--transport phải là http, sse hoặc stdio.`)
  if (Object.keys(env).length > 0) throw new UsageError("--env chỉ dùng cho server stdio; server remote dùng --header.")
  const clientId = flag(p, "client-id")
  const scope = flag(p, "oauth-scope")
  const port = flag(p, "callback-port")
  const oauth = has(p, "no-oauth")
    ? false
    : clientId || scope || port
      ? { ...(clientId ? { clientId } : {}), ...(scope ? { scope } : {}), ...(port ? { callbackPort: Number(port) } : {}) }
      : undefined
  return {
    type: (transport as "http" | "sse" | undefined) ?? "http",
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(oauth !== undefined ? { oauth } : {}),
  } as ServerConfig
}

const MARK: Record<McpServerStatus["state"], string> = {
  connected: "●",
  connecting: "…",
  failed: "✕",
  disabled: "○",
  untrusted: "?",
  "needs-auth": "!",
}

function describe(s: McpServerStatus) {
  const where = s.scope === "global" ? "user" : "project"
  switch (s.state) {
    case "connected":
      return `${s.transport} · ${s.tools.length} tool${s.hiddenTools ? ` (ẩn ${s.hiddenTools})` : ""}`
    case "disabled":
      return "đã tắt"
    case "untrusted":
      return `chưa được cho phép (mở TUI → /mcp để cho phép server của project)`
    case "needs-auth":
      return `cần đăng nhập — ${s.error ?? ""}`
    default:
      return `${s.error ?? s.state} [${where}]`
  }
}

async function withManager<T>(home: string, cwd: string, fn: (m: McpManager) => Promise<T>) {
  const manager = new McpManager(new ToolRegistry(), { home, cwd, trustFile: path.join(home, "mcp-trust.json") })
  try {
    return await fn(manager)
  } finally {
    await Promise.race([manager.stop(), new Promise((r) => setTimeout(r, 2000))])
  }
}

async function readLine(prompt: string): Promise<string> {
  process.stdout.write(prompt)
  for await (const line of console) return line.trim()
  return ""
}

/** Claude Code (~/.claude.json, user + this project) and Claude Desktop configs. */
async function claudeServers(cwd: string) {
  const found: { name: string; from: string; config: unknown }[] = []
  const claudeJson = path.join(os.homedir(), ".claude.json")
  const cc = await readJson<{ mcpServers?: Record<string, unknown>; projects?: Record<string, { mcpServers?: Record<string, unknown> }> }>(claudeJson, {})
  for (const [name, config] of Object.entries(cc.mcpServers ?? {})) found.push({ name, from: "Claude Code (user)", config })
  const project = Object.entries(cc.projects ?? {}).find(([p]) => path.resolve(p).toLowerCase() === path.resolve(cwd).toLowerCase())
  for (const [name, config] of Object.entries(project?.[1].mcpServers ?? {})) found.push({ name, from: "Claude Code (local)", config })
  const desktop =
    process.platform === "win32"
      ? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json")
  const cd = await readJson<{ mcpServers?: Record<string, unknown> }>(desktop, {})
  for (const [name, config] of Object.entries(cd.mcpServers ?? {})) found.push({ name, from: "Claude Desktop", config })
  return found
}

type Out = (line: string) => void

/** Entry point; returns the process exit code. `out` is injectable for tests. */
export async function runMcpCli(argv: string[], opts: { home?: string; cwd?: string; out?: Out; err?: Out } = {}): Promise<number> {
  const home = opts.home ?? dataDir()
  const cwd = opts.cwd ?? process.cwd()
  const out = opts.out ?? ((l) => console.log(l))
  const err = opts.err ?? ((l) => console.error(l))
  try {
    const p = parseArgs(argv)
    const [cmd, name] = p.positional
    if (!cmd || cmd === "help" || has(p, "help")) {
      out(HELP)
      return 0
    }
    const need = () => {
      if (!name) throw new UsageError(`Thiếu tên server. Xem: opentrading mcp help`)
      return name
    }

    switch (cmd) {
      case "list": {
        const entries = await loadServers(home, cwd)
        if (entries.length === 0) {
          out(`Chưa có MCP server nào. Thêm: opentrading mcp add <tên> <url>  (xem: opentrading mcp help)`)
          return 0
        }
        out(`Đang kết nối ${entries.length} server…`)
        await withManager(home, cwd, async (m) => {
          await m.start()
          for (const s of m.status()) out(`${MARK[s.state]} ${s.name}  ${s.target}\n    ${describe(s)}`)
        })
        return 0
      }

      case "get": {
        const entry = (await loadServers(home, cwd)).find((e) => e.name === need())
        if (!entry) throw new UsageError(`Không có server "${name}".`)
        out(`${entry.name}  [${entry.scope === "global" ? "user" : "project"}] ${entry.file}`)
        out(JSON.stringify(entry.config ?? { error: entry.error }, null, 2))
        if (entry.config && isRemote(entry.config)) out(`OAuth: ${await oauthStatus(home, entry.name, entry.config.url)}`)
        return 0
      }

      case "add":
      case "add-json": {
        need()
        if (!/^[A-Za-z0-9_-]{1,48}$/.test(name!)) throw new UsageError(`Tên server chỉ được dùng chữ, số, "_" và "-".`)
        let config: ServerConfig
        if (cmd === "add-json") {
          const raw = p.positional[2]
          if (!raw) throw new UsageError(`Thiếu JSON. Ví dụ: opentrading mcp add-json ctx7 '{"type":"http","url":"https://mcp.context7.com/mcp"}'`)
          let json: unknown
          try {
            json = JSON.parse(raw)
          } catch (error) {
            throw new UsageError(`JSON lỗi: ${(error as Error).message}`)
          }
          const parsed = ServerConfig.safeParse(json)
          if (!parsed.success) throw new UsageError(`Cấu hình không hợp lệ: ${parsed.error.issues[0]?.message}`)
          config = json as ServerConfig
        } else {
          config = configFromArgs(p)
        }
        const scope = scopeOf(p) ?? "global"
        const file = fileFor(scope, home, cwd)
        const existing = (await loadServers(home, cwd)).find((e) => e.name === name && e.scope === scope)
        if (existing && !has(p, "force")) throw new UsageError(`Đã có server "${name}" trong ${file}. Thêm --force để ghi đè.`)
        await putServer(file, name!, config)
        out(`Đã thêm "${name}" vào ${file}.`)
        const { missing } = expandConfig(config, process.env, await secretEnv(home))
        for (const v of missing) out(`  Cần giá trị cho \${${v}}: opentrading mcp secret set ${v}`)
        out(`Kiểm tra: opentrading mcp list`)
        return 0
      }

      case "import": {
        if (name !== "claude") throw new UsageError(`Hiện chỉ hỗ trợ: opentrading mcp import claude`)
        const found = await claudeServers(cwd)
        if (found.length === 0) {
          out("Không tìm thấy MCP server nào trong Claude Code / Claude Desktop.")
          return 0
        }
        const wanted = p.positional.slice(2)
        if (!has(p, "all") && wanted.length === 0) {
          out("Tìm thấy:")
          for (const f of found) out(`  ${f.name}  (${f.from})`)
          out(`Nhập tất cả: opentrading mcp import claude --all   ·   hoặc chọn: opentrading mcp import claude <tên>…`)
          return 0
        }
        const scope = scopeOf(p) ?? "global"
        const file = fileFor(scope, home, cwd)
        const existing = new Set((await loadServers(home, cwd)).filter((e) => e.scope === scope).map((e) => e.name))
        for (const f of found) {
          if (wanted.length > 0 && !wanted.includes(f.name)) continue
          if (existing.has(f.name) && !has(p, "force")) {
            out(`  bỏ qua ${f.name}: đã có (thêm --force để ghi đè)`)
            continue
          }
          const parsed = ServerConfig.safeParse(f.config)
          if (!parsed.success) {
            out(`  bỏ qua ${f.name}: không hỗ trợ (${parsed.error.issues[0]?.message})`)
            continue
          }
          // Keep the user's original object (e.g. a missing `type` stays missing).
          await putServer(file, f.name, f.config as ServerConfig)
          existing.add(f.name)
          out(`  đã nhập ${f.name} (${f.from})`)
        }
        out(`Lưu ở ${file}. Kiểm tra: opentrading mcp list`)
        return 0
      }

      case "remove": {
        need()
        const scopes: Scope[] = scopeOf(p) ? [scopeOf(p)!] : ["global", "project"]
        let removed = false
        for (const scope of scopes) {
          const file = fileFor(scope, home, cwd)
          if (existsSync(file) && (await deleteServer(file, name!))) {
            out(`Đã xoá "${name}" khỏi ${file}.`)
            removed = true
          }
        }
        if (!removed) throw new UsageError(`Không có server "${name}".`)
        await clearOAuth(home, name!)
        return 0
      }

      case "enable":
      case "disable": {
        const entry = (await loadServers(home, cwd)).find((e) => e.name === need())
        if (!entry) throw new UsageError(`Không có server "${name}".`)
        await setServerEnabled(entry.file, name!, cmd === "enable")
        out(`Đã ${cmd === "enable" ? "bật" : "tắt"} "${name}".`)
        return 0
      }

      case "login": {
        need()
        const code = await withManager(home, cwd, async (m) => {
          await m.start()
          const s = m.status().find((x) => x.name === name)
          if (!s) throw new UsageError(`Không có server "${name}".`)
          await m.login(name!, {
            onUrl: (url) => out(`Mở trình duyệt để đăng nhập. Nếu không tự mở, dán link này vào trình duyệt:\n\n${url}\n\nĐang chờ (tối đa 5 phút)…`),
          })
          const after = m.status().find((x) => x.name === name)!
          out(`${MARK[after.state]} ${name}: ${describe(after)}`)
          return after.state === "connected" ? 0 : 1
        })
        return code
      }

      case "logout": {
        await clearOAuth(home, need())
        out(`Đã xoá thông tin đăng nhập OAuth của "${name}".`)
        return 0
      }

      case "secret": {
        const sub = name
        const key = p.positional[2]
        if (sub === "list") {
          const env = await secretEnv(home)
          const keys = Object.keys(env)
          if (keys.length === 0) out("Chưa lưu secret nào.")
          for (const k of keys) out(`  ${k} = ${maskKey(env[k]!)}`)
          return 0
        }
        if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new UsageError(`Tên biến không hợp lệ. Ví dụ: opentrading mcp secret set GITHUB_PAT`)
        if (sub === "unset") {
          await setSecretEnv(home, key, undefined)
          out(`Đã xoá ${key}.`)
          return 0
        }
        if (sub !== "set") throw new UsageError(`Dùng: opentrading mcp secret set|unset|list`)
        const value = p.positional[3] ?? (await readLine(`Giá trị cho ${key}: `))
        if (!value) throw new UsageError("Giá trị rỗng.")
        await setSecretEnv(home, key, value)
        out(`Đã lưu ${key} (${maskKey(value)}) vào ${path.join(home, "mcp-auth.json")}.`)
        return 0
      }

      case "debug": {
        const entry = (await loadServers(home, cwd)).find((e) => e.name === need())
        if (!entry?.config) throw new UsageError(entry ? entry.error! : `Không có server "${name}".`)
        const { config, missing } = expandConfig(entry.config, process.env, await secretEnv(home))
        if (missing.length > 0) out(`Thiếu biến: ${missing.join(", ")}`)
        if (isRemote(config)) {
          out(`URL: ${config.url} (${config.type})`)
          for (const [k, v] of Object.entries(config.headers ?? {})) out(`  header ${k}: ${maskKey(v)}`)
          try {
            const res = await fetch(config.url, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...config.headers },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "opentrading-debug", version: "0.1.0" } },
              }),
              signal: AbortSignal.timeout(config.startupTimeoutMs ?? 30_000),
            })
            out(`POST initialize → HTTP ${res.status} ${res.statusText}`)
            out(`  content-type: ${res.headers.get("content-type") ?? "-"}`)
            if (res.headers.get("mcp-session-id")) out(`  mcp-session-id: có`)
            if (res.headers.get("www-authenticate")) out(`  www-authenticate: ${res.headers.get("www-authenticate")}`)
            await res.body?.cancel().catch(() => {})
          } catch (error) {
            out(`POST initialize lỗi: ${(error as Error).message}`)
          }
          try {
            const info = await discoverOAuthServerInfo(config.url)
            out(`OAuth: authorization server ${info.authorizationServerUrl}`)
            const md = info.authorizationServerMetadata
            out(`  đăng ký client động (DCR): ${md?.registration_endpoint ? "có" : "không"}`)
          } catch (error) {
            out(`OAuth: không tìm thấy metadata (${(error as Error).message})`)
          }
          out(`Token đã lưu: ${await oauthStatus(home, entry.name, entry.config && isRemote(entry.config) ? entry.config.url : config.url)}`)
        } else {
          out(`Lệnh: ${[config.command, ...(config.args ?? [])].join(" ")}`)
        }
        await withManager(home, cwd, async (m) => {
          await m.start()
          const s = m.status().find((x) => x.name === name)!
          out(`Kết nối qua OpenTrading: ${MARK[s.state]} ${describe(s)}`)
        })
        return 0
      }

      default:
        throw new UsageError(`Lệnh không rõ: ${cmd}. Xem: opentrading mcp help`)
    }
  } catch (error) {
    err(error instanceof UsageError ? error.message : `Lỗi: ${error instanceof Error ? error.message : String(error)}`)
    return error instanceof UsageError ? 2 : 1
  }
}
