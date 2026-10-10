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
import { type CallStats, startHttpServer, startSseServer } from "./fixtures/remote-mcp"

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

test("a 502 HTML page (cold PaaS host) becomes a short one-line error with a retry hint", async () => {
  const page = `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <title>502</title>\n    <style>@font-face { src: url("data:font/woff2;base64,${"A".repeat(20_000)}") }</style>\n  </head>\n</html>`
  const remote = startHttpServer({ failFirst: { count: 99, status: 502, body: page } })
  cleanups.push(remote.stop)
  const { manager } = await managerWith({ cold: { type: "http", url: remote.url } })
  await manager.start()
  const s = state(manager, "cold")
  expect(s.state).toBe("failed")
  expect(s.error).toContain('[trang HTML "502"]')
  expect(s.error).toContain("HTTP 502")
  expect(s.error).not.toMatch(/<html|base64|\n/)
  expect(s.error!.length).toBeLessThan(700)
}, 20_000)

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
  expect(state(manager, "api")).toMatchObject({ state: "connected", tools: ["mcp__api__screenshot"], hiddenTools: 1 })
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
  expect(lines.join(" ")).toContain("● api: http · 2 tool")
  const manager = new McpManager(new ToolRegistry(), { home, cwd, trustFile: path.join(home, "mcp-trust.json") })
  cleanups.push(() => manager.stop())
  await manager.start()
  expect(state(manager, "api").state).toBe("connected")
})

test("prompts, resources, images and lenient output schemas work end to end", async () => {
  const remote = startHttpServer()
  cleanups.push(remote.stop)
  const { manager, registry } = await managerWith({ data: { url: remote.url } })
  await manager.start()
  const s = state(manager, "data")
  expect(s.state).toBe("connected")
  expect(s.resources).toBe(true)
  expect(s.prompts.map((p) => p.name)).toEqual(["ticker_analysis"])
  expect(s.prompts[0]!.arguments).toEqual([
    { name: "ticker", required: true },
    { name: "focus", required: false },
  ])
  expect(manager.allPrompts()[0]).toMatchObject({ server: "data", name: "ticker_analysis" })

  const text = await manager.getPrompt("data", "ticker_analysis", { ticker: "VCB", focus: "biên lãi" })
  expect(text).toBe("Phân tích VCB (trọng tâm: biên lãi)\n\n(gợi ý của server) Tôi sẽ dùng dữ liệu giá.")

  // Resource tools appear because a server offers resources.
  const listed = (await registry.get("list_mcp_resources")!.execute({}, ctx)) as string
  expect(JSON.parse(listed)).toEqual([{ server: "data", uri: "ot://calendar", name: "calendar", description: "Lịch nghỉ lễ", mimeType: "text/plain" }])
  expect(await registry.get("read_mcp_resource")!.execute({ server: "data", uri: "ot://calendar" }, ctx)).toBe("02/09: nghỉ Quốc khánh")

  const shot = await registry.get("mcp__data__screenshot")!.execute({}, ctx)
  expect(shot).toMatchObject({ output: "đã chụp", images: [{ mediaType: "image/png" }] })


  await manager.stop()
  await manager.start([])
  expect(registry.get("list_mcp_resources")).toBeUndefined()
})

test("a tool that breaks its own outputSchema still returns its content (no double run)", async () => {
  const remote = startHttpServer({ sloppy: true })
  cleanups.push(remote.stop)
  const { manager, registry } = await managerWith({ s: { url: remote.url } })
  await manager.start()
  expect(state(manager, "s").state).toBe("connected")
  // The SDK's callTool would throw here after the tool already ran; we read the content.
  expect(await registry.get("mcp__s__price")!.execute({}, ctx)).toBe("giá 25.000")
})

test("manager add / setEnabled / remove edit mcp.json and reload only what changed", async () => {
  const a = startHttpServer()
  const b = startHttpServer({ token: "tok" })
  cleanups.push(a.stop, b.stop)
  const { manager, home, registry } = await managerWith({ first: { url: a.url } })
  await manager.start()
  const firstTool = registry.get("mcp__first__echo")

  // Like enabling a catalog entry that needs a token: secret saved, config merged, connected.
  await manager.add("second", { type: "http", url: b.url, headers: { Authorization: "Bearer ${OT_TEST_SECOND}" } }, { OT_TEST_SECOND: "tok" })
  expect(state(manager, "second").state).toBe("connected")
  // The untouched server kept its connection (same registered tool object, not re-listed).
  expect(registry.get("mcp__first__echo")).toBe(firstTool)
  const file = JSON.parse(await readFile(path.join(home, "mcp.json"), "utf8"))
  expect(Object.keys(file.mcpServers)).toEqual(["first", "second"])
  expect(JSON.stringify(file)).not.toContain('"tok"')

  await manager.setEnabled("second", false)
  expect(state(manager, "second").state).toBe("disabled")
  expect(registry.get("mcp__second__echo")).toBeUndefined()
  await manager.setEnabled("second", true)
  expect(state(manager, "second").state).toBe("connected")

  await manager.remove("second")
  expect(manager.status().map((s) => s.name)).toEqual(["first"])
  expect(registry.get("mcp__second__echo")).toBeUndefined()
  expect(Object.keys(JSON.parse(await readFile(path.join(home, "mcp.json"), "utf8")).mcpServers)).toEqual(["first"])
  // MCP tools carry what the approval prompt needs.
  expect(registry.get("mcp__first__screenshot")).toMatchObject({ readOnly: true, displayName: "first · screenshot" })
  expect(registry.get("mcp__first__echo")!.permissionScope).toMatch(/^global:first@[0-9a-f]{16}$/)
})

// --- Server restarts under load (Render free tier killing the instance mid-call) ---

const newStats = (): CallStats => ({ calls: 0, inFlight: 0, maxInFlight: 0, notes: 0 })

test("calls made while a dropped server restarts wait for it instead of failing at once", async () => {
  const first = startHttpServer()
  const { manager, registry } = await managerWith({ data: { type: "http", url: first.url } })
  await manager.start()
  expect(state(manager, "data").state).toBe("connected")
  // A subagent holds this definition from before the drop.
  const echo = registry.get("mcp__data__echo")!
  first.stop()

  const started = Date.now()
  const pending = echo.execute({ text: "vẫn chạy" }, ctx)
  await Bun.sleep(400)
  // Tools stay registered while reconnecting: the model can still call them.
  expect(registry.get("mcp__data__echo")).toBeDefined()
  const again = startHttpServer({ port: first.port })
  cleanups.push(again.stop)

  const result = await pending
  expect(typeof result === "string" ? result : result.output).toContain("vẫn chạy")
  expect(Date.now() - started).toBeGreaterThanOrEqual(400)
  expect(state(manager, "data").state).toBe("connected")
}, 20_000)

test("reconnect keeps trying past the old five-attempt budget", async () => {
  const first = startHttpServer()
  const { manager } = await managerWith({ data: { type: "http", url: first.url } })
  ;(manager as unknown as { opts: { reconnectDelaysMs: number[] } }).opts.reconnectDelaysMs = [30]
  await manager.start()
  const states: string[] = []
  manager.onChange((all) => states.push(all.find((s) => s.name === "data")!.error ?? ""))
  // Force the drop to be noticed: the dead connection fails the next call.
  first.stop()
  void manager.toolsOf("data")[0]!.execute({ text: "x" }, ctx).catch(() => {})
  await Bun.sleep(600)
  expect(states.some((e) => /thử lại lần ([6-9]|\d\d)/.test(e))).toBe(true)
  const again = startHttpServer({ port: first.port })
  cleanups.push(again.stop)
  for (let i = 0; i < 100 && state(manager, "data").state !== "connected"; i++) await Bun.sleep(50)
  expect(state(manager, "data").state).toBe("connected")
}, 20_000)

test("a read-only call is retried after a 502 page; a write call is not, and the model never sees the HTML", async () => {
  const stats = newStats()
  const remote = startHttpServer({ stats })
  cleanups.push(remote.stop)
  const { manager, registry } = await managerWith({ data: { type: "http", url: remote.url } })
  ;(manager as unknown as { opts: { callRetryDelaysMs: number[] } }).opts.callRetryDelaysMs = [20, 20]
  await manager.start()

  remote.failCalls.count = 1
  const ok = await registry.get("mcp__data__slow")!.execute({ ms: 1 }, ctx)
  expect(typeof ok === "string" ? ok : ok.output).toContain("waited 1")
  expect(stats.calls).toBe(1)

  remote.failCalls.count = 3
  const failed = await errorOf(Promise.resolve(registry.get("mcp__data__slow")!.execute({ ms: 1 }, ctx)))
  expect(failed).toContain("HTTP 502")
  expect(failed).toContain("Đã thử lại 2 lần")
  remote.failCalls.count = 0

  remote.failCalls.count = 1
  const write = await errorOf(Promise.resolve(registry.get("mcp__data__note")!.execute({ text: "a" }, ctx)))
  expect(write).toContain("HTTP 502")
  expect(write).toContain("không tự thử lại")
  expect(write).not.toContain("<html")
  expect(write.length).toBeLessThan(400)
  expect(remote.failCalls.count).toBe(0)
  expect(stats.notes).toBe(0)
  // The connection itself is fine after a 502: the next write goes through.
  const saved = await registry.get("mcp__data__note")!.execute({ text: "b" }, ctx)
  expect(typeof saved === "string" ? saved : saved.output).toContain("saved b")
}, 20_000)

test("the server dies with calls in flight: read-only calls finish after it is back, a write fails fast", async () => {
  const stats = newStats()
  const first = startHttpServer({ stats })
  const { manager, registry } = await managerWith({ data: { type: "http", url: first.url } })
  ;(manager as unknown as { opts: { callRetryDelaysMs: number[] } }).opts.callRetryDelaysMs = [20, 20]
  await manager.start()
  const slow = registry.get("mcp__data__slow")!
  const note = registry.get("mcp__data__note")!
  const reads = Array.from({ length: 3 }, () => slow.execute({ ms: 500 }, ctx))
  const write = errorOf(Promise.resolve(note.execute({ text: "a", ms: 500 }, ctx)))
  await Bun.sleep(100)
  first.stop()
  const writeError = await Promise.race([write, Bun.sleep(3000).then(() => "(hang)")])
  expect(writeError).toContain("lỗi tạm thời")
  expect(writeError).toContain("không tự thử lại")
  const again = startHttpServer({ port: first.port, stats })
  cleanups.push(again.stop)
  const results = await Promise.all(reads)
  for (const r of results) expect(typeof r === "string" ? r : r.output).toContain("waited 500")
}, 20_000)

test("a host answering 502 to everything while it restarts: calls wait for one reconnect, then succeed", async () => {
  const stats = newStats()
  const remote = startHttpServer({ stats })
  cleanups.push(remote.stop)
  const { manager, registry } = await managerWith({ data: { type: "http", url: remote.url } })
  ;(manager as unknown as { opts: { callRetryDelaysMs: number[] } }).opts.callRetryDelaysMs = [20, 20]
  await manager.start()
  const slow = registry.get("mcp__data__slow")!
  remote.down.status = 502
  const calls = Array.from({ length: 3 }, () => slow.execute({ ms: 1 }, ctx))
  await Bun.sleep(800)
  // Retries alone (20ms + 20ms) are long over: the calls are waiting on the reconnect.
  expect(state(manager, "data").state).not.toBe("connected")
  remote.down.status = 0
  const results = await Promise.all(calls)
  for (const r of results) expect(typeof r === "string" ? r : r.output).toContain("waited 1")
  expect(stats.calls).toBe(3)
}, 20_000)

test("an error the tool reports itself is returned once, even when its text looks like a network error", async () => {
  const stats = newStats()
  const remote = startHttpServer({ stats })
  cleanups.push(remote.stop)
  const { manager, registry } = await managerWith({ data: { type: "http", url: remote.url } })
  ;(manager as unknown as { opts: { callRetryDelaysMs: number[] } }).opts.callRetryDelaysMs = [20, 20]
  await manager.start()
  const seen: string[] = []
  manager.onChange((all) => seen.push(all.find((s) => s.name === "data")!.state))
  const error = await errorOf(Promise.resolve(registry.get("mcp__data__upstream_down")!.execute({}, ctx)))
  expect(error).toContain("ECONNRESET")
  expect(stats.calls).toBe(1)
  expect(seen).not.toContain("connecting")
  expect(state(manager, "data").state).toBe("connected")
})

test("tool calls to one server are capped at maxConcurrent (default 4), the rest queue", async () => {
  const stats = newStats()
  const remote = startHttpServer({ stats })
  cleanups.push(remote.stop)
  const { manager, registry, home } = await managerWith({ data: { type: "http", url: remote.url } })
  await manager.start()
  const slow = registry.get("mcp__data__slow")!
  await Promise.all(Array.from({ length: 7 }, () => slow.execute({ ms: 80 }, ctx)))
  expect(stats.calls).toBe(7)
  expect(stats.maxInFlight).toBe(4)

  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { data: { type: "http", url: remote.url, maxConcurrent: 2 } } }))
  await manager.reload()
  stats.maxInFlight = 0
  const slow2 = registry.get("mcp__data__slow")!
  await Promise.all(Array.from({ length: 5 }, () => slow2.execute({ ms: 80 }, ctx)))
  expect(stats.maxInFlight).toBe(2)
}, 20_000)

test("a queued call can be cancelled before it reaches the server", async () => {
  const stats = newStats()
  const remote = startHttpServer({ stats })
  cleanups.push(remote.stop)
  const { manager, registry } = await managerWith({ data: { type: "http", url: remote.url, maxConcurrent: 1 } })
  await manager.start()
  const slow = registry.get("mcp__data__slow")!
  const running = slow.execute({ ms: 300 }, ctx)
  const abort = new AbortController()
  const queued = errorOf(Promise.resolve(slow.execute({ ms: 1 }, { signal: abort.signal, callId: "c2" })))
  await Bun.sleep(50)
  abort.abort()
  expect(await queued).toContain("Đã huỷ")
  await running
  expect(stats.calls).toBe(1)
}, 20_000)
