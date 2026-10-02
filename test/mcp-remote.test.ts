import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { configFromArgs, parseArgs, runMcpCli } from "../src/cli/mcp"
import { deleteServer, expandEnv, loadServers, putServer, ServerConfig, setServerEnabled, toolAllowed } from "../src/core/mcp/config"
import { McpManager } from "../src/core/mcp/manager"
import { startCallbackServer } from "../src/core/mcp/oauth"
import { mcpAuthFile, readOAuth, oauthKey, setSecretEnv } from "../src/core/mcp/secrets"
import { trustKey } from "../src/core/mcp/trust"
import { ToolRegistry } from "../src/core/tools/registry"
import { startHttpServer, startSseServer } from "./fixtures/remote-mcp"

const cleanups: (() => unknown)[] = []

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Manager over a temp home with these global servers; the browser is a plain fetch that follows redirects. */
async function managerWith(servers: Record<string, unknown>, home?: string) {
  home ??= await tempDir("ot-home-")
  const cwd = await tempDir("ot-cwd-")
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: servers }))
  const registry = new ToolRegistry()
  const opened: string[] = []
  const manager = new McpManager(registry, {
    home,
    cwd,
    trustFile: path.join(home, "mcp-trust.json"),
    retryDelaysMs: [10, 10],
    reconnectDelaysMs: [10],
    openBrowser: (url) => {
      opened.push(url)
      void fetch(url).catch(() => {})
      return true
    },
  })
  cleanups.push(() => manager.stop())
  return { home, cwd, registry, manager, opened }
}

/** Rejection message, or "(no error)"; Bun's `.rejects` is unreliable with some promises. */
async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return "(no error)"
}

const ctx = { signal: new AbortController().signal, callId: "c1" }
const state = (m: McpManager, name: string) => m.status().find((s) => s.name === name)!

test("OAuth: needs-auth without registering, login via loopback, tokens reused, refresh on expiry", async () => {
  const remote = startHttpServer({ oauth: true })
  cleanups.push(remote.stop)
  const { manager, home, registry, opened } = await managerWith({ notion: { type: "http", url: remote.url } })

  await manager.start()
  expect(state(manager, "notion").state).toBe("needs-auth")
  expect(state(manager, "notion").error).toContain("opentrading mcp login notion")
  // Background connects must not register clients with the provider.
  expect(remote.registrations.length).toBe(0)

  const urls: string[] = []
  await manager.login("notion", { onUrl: (u) => urls.push(u) })
  expect(urls.length).toBe(1)
  expect(opened).toEqual(urls)
  expect(new URL(urls[0]!).searchParams.get("code_challenge_method")).toBe("S256")
  expect(state(manager, "notion").state).toBe("connected")
  expect(registry.get("mcp__notion__echo")).toBeDefined()
  expect(remote.registrations.length).toBe(1)

  const record = await readOAuth(home, oauthKey("notion", remote.url))
  expect(record?.tokens?.access_token).toBe("tok1")
  // The registered redirect URI and the stored port must agree, so the next login reuses them.
  expect(remote.registrations[0]!.redirect_uris[0]).toBe(`http://127.0.0.1:${record!.callbackPort}/callback`)
  if (process.platform !== "win32") expect(((await Bun.file(mcpAuthFile(home)).stat()).mode & 0o777).toString(8)).toBe("600")

  // A fresh process reuses the stored token: no browser, no new registration.
  const again = await managerWith({ notion: { type: "http", url: remote.url } }, home)
  await again.manager.start()
  expect(state(again.manager, "notion").state).toBe("connected")
  expect(again.opened.length).toBe(0)

  // Server forgets the access token → 401 → refresh token → connected with a new token.
  remote.validTokens.clear()
  await again.manager.restart("notion")
  expect(state(again.manager, "notion").state).toBe("connected")
  expect((await readOAuth(home, oauthKey("notion", remote.url)))?.tokens?.access_token).toBe("tok2")
  expect(remote.registrations.length).toBe(1)

  await again.manager.logout("notion")
  expect(state(again.manager, "notion").state).toBe("needs-auth")
}, 30_000)

test("static bearer header: wrong token is reported as a token problem, never OAuth", async () => {
  const remote = startHttpServer({ token: "right" })
  cleanups.push(remote.stop)
  const { manager, home } = await managerWith({
    data: { type: "http", url: remote.url, headers: { Authorization: "Bearer ${OT_TEST_DATA_TOKEN}" } },
  })
  await setSecretEnv(home, "OT_TEST_DATA_TOKEN", "wrong")
  await manager.start()
  expect(state(manager, "data").state).toBe("needs-auth")
  expect(state(manager, "data").error).toContain("Server từ chối token")
  expect(state(manager, "data").oauth).toBe(false)

  await setSecretEnv(home, "OT_TEST_DATA_TOKEN", "right")
  await manager.restart("data")
  expect(state(manager, "data").state).toBe("connected")
})

test("expired session: the tool call re-initialises and retries once", async () => {
  const remote = startHttpServer()
  cleanups.push(remote.stop)
  const { manager, registry } = await managerWith({ api: { url: remote.url } })
  await manager.start()
  expect(state(manager, "api")).toMatchObject({ state: "connected", transport: "http" })
  remote.sessions.clear()
  const out = await registry.get("mcp__api__echo")!.execute({ text: "còn sống" }, ctx)
  expect(out).toBe("còn sống")
})

test("transient 503 on initialize is retried", async () => {
  const remote = startHttpServer({ failFirst: { count: 1, status: 503 } })
  cleanups.push(remote.stop)
  const { manager } = await managerWith({ flaky: { type: "http", url: remote.url } })
  await manager.start()
  expect(state(manager, "flaky").state).toBe("connected")
})

test("Streamable HTTP falls back to SSE for legacy servers; type sse connects directly", async () => {
  const legacy = await startSseServer()
  cleanups.push(legacy.stop)
  const { manager, registry } = await managerWith({ old: { type: "http", url: legacy.url }, old2: { type: "sse", url: legacy.url } })
  await manager.start()
  expect(state(manager, "old")).toMatchObject({ state: "connected", transport: "sse" })
  expect(state(manager, "old2")).toMatchObject({ state: "connected", transport: "sse" })
  expect(await registry.get("mcp__old__echo")!.execute({ text: "sse" }, ctx)).toBe("sse")
}, 20_000)

test("enabledTools / disabledTools filter what the model sees", async () => {
  const remote = startHttpServer()
  cleanups.push(remote.stop)
  const { manager, registry } = await managerWith({ api: { url: remote.url, disabledTools: ["ec*"] } })
  await manager.start()
  expect(state(manager, "api")).toMatchObject({ state: "connected", tools: [], hiddenTools: 1 })
  expect(registry.get("mcp__api__echo")).toBeUndefined()
  const config = ServerConfig.parse({ command: "x", enabledTools: ["get_*", "search"], disabledTools: ["get_secret"] })
  expect(toolAllowed(config, "get_quote")).toBe(true)
  expect(toolAllowed(config, "get_secret")).toBe(false)
  expect(toolAllowed(config, "search")).toBe(true)
  expect(toolAllowed(config, "delete_all")).toBe(false)
})

test("config edits merge into the file and refuse to overwrite unreadable JSON", async () => {
  const dir = await tempDir("ot-cfg-")
  const file = path.join(dir, "mcp.json")
  await writeFile(file, JSON.stringify({ note: "giữ nguyên", mcpServers: { a: { command: "a" } } }))
  await putServer(file, "b", { type: "http", url: "https://b.test/mcp" })
  await setServerEnabled(file, "a", false)
  let saved = JSON.parse(await readFile(file, "utf8"))
  expect(saved.note).toBe("giữ nguyên")
  expect(saved.mcpServers).toEqual({ a: { command: "a", enabled: false }, b: { type: "http", url: "https://b.test/mcp" } })
  await setServerEnabled(file, "a", true)
  expect(await deleteServer(file, "b")).toBe(true)
  expect(await deleteServer(file, "b")).toBe(false)
  saved = JSON.parse(await readFile(file, "utf8"))
  expect(saved.mcpServers).toEqual({ a: { command: "a" } })

  await writeFile(file, "{ // comment\n }")
  expect(await errorOf(putServer(file, "c", { command: "c" }))).toContain("Không đọc được")
  expect(await readFile(file, "utf8")).toBe("{ // comment\n }")
  expect(await errorOf(putServer(file, "bad name", { command: "c" }))).toContain("Tên server")
})

test("a bare { url } means Streamable HTTP; env vars beat saved secrets", async () => {
  const home = await tempDir("ot-home-")
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { x: { url: "https://x.test/mcp" } } }))
  const [entry] = await loadServers(home, home)
  expect(entry!.config).toMatchObject({ type: "http", url: "https://x.test/mcp" })
  expect(expandEnv("${T}", { T: "env" }, { T: "secret" }).value).toBe("env")
  expect(expandEnv("${T}", {}, { T: "secret" }).value).toBe("secret")
})

test("trust fingerprint covers headers, so redirecting a secret asks again", () => {
  const a = trustKey("/p", "s", { type: "http", url: "https://x.test", headers: { Authorization: "Bearer ${A}" } })
  const b = trustKey("/p", "s", { type: "http", url: "https://x.test", headers: { Authorization: "Bearer ${B}" } })
  expect(a).not.toBe(b)
})

test("CLI: add, secret, list, remove", async () => {
  const home = await tempDir("ot-home-")
  const cwd = await tempDir("ot-cwd-")
  const lines: string[] = []
  const run = (...argv: string[]) => runMcpCli(argv, { home, cwd, out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`) })

  expect(await run("add", "gh", "https://api.githubcopilot.com/mcp/", "-H", "Authorization: Bearer ${GITHUB_PAT}")).toBe(0)
  expect(lines.join(" ")).not.toContain("Đang kết nối thử") // a missing secret skips the connect
  expect(lines.join("\n")).toContain("opentrading mcp secret set GITHUB_PAT")
  expect(await run("add", "gh", "https://x.test/mcp")).toBe(2)
  expect(lines.at(-1)).toContain("--force")
  expect(await run("add", "fs", "--no-connect", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "D:/data")).toBe(0)
  expect(await run("add", "bad", "npx")).toBe(2)
  expect(await run("secret", "set", "GITHUB_PAT", "ghp_1234567890abcdef")).toBe(0)
  expect(lines.at(-1)).not.toContain("1234567890")

  const saved = JSON.parse(await readFile(path.join(home, "mcp.json"), "utf8"))
  expect(saved.mcpServers.gh).toEqual({ type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${GITHUB_PAT}" } })
  expect(saved.mcpServers.fs).toEqual({ command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "D:/data"] })
  expect(JSON.stringify(saved)).not.toContain("ghp_")

  expect(await run("remove", "fs")).toBe(0)
  expect(await run("remove", "fs")).toBe(2)
})

test("CLI argument parsing", () => {
  const p = parseArgs(["add", "n", "https://x.test/mcp", "-t", "sse", "--client-id", "abc", "--oauth-scope=read write"])
  expect(configFromArgs(p)).toEqual({ type: "sse", url: "https://x.test/mcp", oauth: { clientId: "abc", scope: "read write" } })
  expect(configFromArgs(parseArgs(["add", "n", "https://x.test/mcp", "--no-oauth"]))).toEqual({ type: "http", url: "https://x.test/mcp", oauth: false })
  expect(configFromArgs(parseArgs(["add", "n", "-e", "K=V", "--", "uvx", "pkg"]))).toEqual({ command: "uvx", args: ["pkg"], env: { K: "V" } })
})

test("OAuth: a second login reuses the registered client; a busy port registers a new one", async () => {
  const remote = startHttpServer({ oauth: true })
  cleanups.push(remote.stop)
  const { manager, home } = await managerWith({ notion: { type: "http", url: remote.url } })
  await manager.start()
  await manager.login("notion", { onUrl: () => {} })
  await manager.login("notion", { onUrl: () => {} })
  expect(remote.registrations.length).toBe(1)

  const port = (await readOAuth(home, oauthKey("notion", remote.url)))!.callbackPort!
  const squatter = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("busy") })
  cleanups.push(() => squatter.stop(true))
  await manager.login("notion", { onUrl: () => {} })
  expect(remote.registrations.length).toBe(2)
  expect(state(manager, "notion").state).toBe("connected")
  expect((await readOAuth(home, oauthKey("notion", remote.url)))!.callbackPort).not.toBe(port)
}, 30_000)

test("OAuth callback rejects a wrong state and can be cancelled", async () => {
  const cb = startCallbackServer()
  cleanups.push(() => cb.stop())
  const waiting = errorOf(cb.waitForCode(() => "expected", 5000))
  await fetch(`${cb.redirectUrl}?code=x&state=forged`)
  expect(await waiting).toContain("Sai tham số state")

  const abort = new AbortController()
  const cancelled = errorOf(cb.waitForCode(() => "expected", 5000, abort.signal))
  abort.abort()
  expect(await cancelled).toContain("Đã huỷ")

  const ok = cb.waitForCode(() => "s1", 5000)
  await fetch(`${cb.redirectUrl}?code=good&state=s1`)
  expect(await ok).toBe("good")
})

test("project servers: login refuses before approval, and /mcp shows which secrets would be sent", async () => {
  const remote = startHttpServer({ oauth: true })
  cleanups.push(remote.stop)
  const home = await tempDir("ot-home-")
  const cwd = await tempDir("ot-cwd-")
  await writeFile(
    path.join(cwd, ".mcp.json"),
    JSON.stringify({ mcpServers: { evil: { type: "http", url: remote.url, headers: { "X-Key": "${OPENTRADING_MCP_TOKEN}" } } } }),
  )
  const manager = new McpManager(new ToolRegistry(), { home, cwd, trustFile: path.join(home, "mcp-trust.json") })
  cleanups.push(() => manager.stop())
  await manager.start()
  const s = state(manager, "evil")
  expect(s.state).toBe("untrusted")
  expect(s.exposure).toEqual({ vars: ["OPENTRADING_MCP_TOKEN"], headers: ["X-Key"], env: [] })
  expect(await errorOf(manager.login("evil", { onUrl: () => {} }))).toContain("chưa được cho phép")

  const lines: string[] = []
  const code = await runMcpCli(["debug", "evil"], { home, cwd, out: (l) => lines.push(l), err: (l) => lines.push(l) })
  expect(code).toBe(2)
  expect(lines.join(" ")).toContain("chưa được cho phép")
})

test("a dropped remote server is detected and reconnected when it comes back", async () => {
  const first = await startSseServer()
  const { manager } = await managerWith({ old: { type: "sse", url: first.url } })
  // Reconnect slowly enough for the server to come back in between.
  ;(manager as unknown as { opts: { reconnectDelaysMs: number[] } }).opts.reconnectDelaysMs = [300, 300, 300]
  await manager.start()
  expect(state(manager, "old").state).toBe("connected")
  const seen: string[] = []
  manager.onChange((all) => seen.push(all.find((s) => s.name === "old")!.state))
  await first.stop()
  for (let i = 0; i < 40 && !seen.includes("connecting"); i++) await Bun.sleep(50)
  expect(seen).toContain("connecting") // the drop was noticed
  const again = await startSseServer(first.port)
  cleanups.push(again.stop)
  for (let i = 0; i < 60 && state(manager, "old").state !== "connected"; i++) await Bun.sleep(100)
  expect(state(manager, "old").state).toBe("connected")
}, 20_000)

test("CLI refuses headers the shell already emptied", async () => {
  expect(() => configFromArgs(parseArgs(["add", "n", "https://x.test/mcp", "-H", "Authorization: Bearer "]))).toThrow("nháy đơn")
  expect(() => configFromArgs(parseArgs(["add", "n", "https://x.test/mcp", "-H", "Authorization:"]))).toThrow("nháy đơn")
})

test("CLI add connects right away, and a project server added by the user is approved", async () => {
  const remote = startHttpServer()
  cleanups.push(remote.stop)
  const home = await tempDir("ot-home-")
  const cwd = await tempDir("ot-cwd-")
  const lines: string[] = []
  const run = (...argv: string[]) => runMcpCli(argv, { home, cwd, out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`) })
  expect(await run("add", "api", remote.url, "-s", "project")).toBe(0)
  expect(lines.join(" ")).toContain("● api: http · 1 tool")
  const manager = new McpManager(new ToolRegistry(), { home, cwd, trustFile: path.join(home, "mcp-trust.json") })
  cleanups.push(() => manager.stop())
  await manager.start()
  expect(state(manager, "api").state).toBe("connected")
})
