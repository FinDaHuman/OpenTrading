import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resultToOutput } from "../src/core/mcp/convert"
import { MAX_MODEL_ERROR, modelErrorText } from "../src/core/mcp/errors"
import { McpManager } from "../src/core/mcp/manager"
import { setSecretEnv } from "../src/core/mcp/secrets"
import { toolErrorText } from "../src/core/tools/errors"
import { ToolRegistry } from "../src/core/tools/registry"
import { startHttpServer } from "./fixtures/remote-mcp"

/**
 * #326: whatever an MCP server fails with, the model reads one short English line that
 * keeps the HTTP status and the envelope's error_code / reason.
 */

const ERRORS = path.resolve(import.meta.dir, "fixtures/mcp-error-server.ts")
const cleanups: (() => unknown)[] = []

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

async function managerWith(servers: Record<string, unknown>) {
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-home-"))
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ot-cwd-"))
  cleanups.push(() => rm(home, { recursive: true, force: true }), () => rm(cwd, { recursive: true, force: true }))
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: servers }))
  const registry = new ToolRegistry()
  const manager = new McpManager(registry, { home, cwd, trustFile: path.join(home, "mcp-trust.json"), retryDelaysMs: [10], reconnectDelaysMs: [10] })
  cleanups.push(() => manager.stop())
  return { home, registry, manager }
}

const ctx = { signal: new AbortController().signal, callId: "c1" }

/** What the model reads for a failed call: the thrown message after the agent's own cleaning. */
async function modelReads(promise: unknown) {
  try {
    await promise
  } catch (error) {
    return toolErrorText(error)
  }
  return "(no error)"
}

const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i

function expectClean(text: string) {
  expect(text.length).toBeLessThanOrEqual(MAX_MODEL_ERROR)
  expect(text).not.toMatch(/<html|<!doctype|<\/?\w+>|\n|\s at \S+ \(/i)
  expect(text).not.toMatch(VIETNAMESE)
}

test("modelErrorText: HTML page → title, stack frames dropped, codes kept after the cut", () => {
  const page = modelErrorText(`Error POSTing to endpoint: <!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>${"x".repeat(5000)}</body></html>`, { status: 502 })
  expect(page).toBe(`Error POSTing to endpoint: [HTML error page "502 Bad Gateway"] [HTTP 502]`)

  const stack = modelErrorText("TypeError: boom\n    at f (/a.js:1:2)\n    at g (/b.js:3:4)")
  expect(stack).toBe("TypeError: boom")

  const python = modelErrorText('Traceback (most recent call last):\n  File "/srv/x.py", line 3, in <module>\n    fetch()\nValueError: bad symbol')
  expect(python).toBe("ValueError: bad symbol")

  // The codes sit after 900 characters of prose: found before cutting, shown after it.
  const long = modelErrorText(`${"words ".repeat(150)}{"ok":false,"error_code":"quota","reason":"upstream_down","retry_after_s":30}`)
  expect(long.length).toBeLessThanOrEqual(MAX_MODEL_ERROR)
  expect(long).toEndWith("… [error_code=quota, reason=upstream_down, retry_after_s=30]")

  // A JSON-RPC error and a JSON body read as their message.
  expect(modelErrorText("MCP error -32603: database is locked")).toBe("database is locked [code -32603]")
  expect(modelErrorText('{"error":"rate_limited","message":"Too many requests","retry_after":5}', { status: 429 })).toBe(
    "Too many requests [HTTP 429, error=rate_limited, retry_after=5]",
  )
  expect(modelErrorText("   ")).toBe("the server reported an error without a message")
})

test("isError results: a long one is cut to one line that keeps its codes; a short one is unchanged", () => {
  expect(() => resultToOutput({ isError: true, content: [{ type: "text", text: "hỏng" }] })).toThrow("hỏng")
  let message = ""
  try {
    resultToOutput({ isError: true, content: [{ type: "text", text: `${"long prose. ".repeat(100)}\n{"error_code":"vendor_disabled","reason":"upstream_down"}` }] })
  } catch (error) {
    message = (error as Error).message
  }
  expect(message.length).toBeLessThanOrEqual(MAX_MODEL_ERROR)
  expect(message).toContain("error_code=vendor_disabled")
  expect(message).toContain("reason=upstream_down")
})

test("stdio server: an HTML page, a stack trace and a long isError all reach the model short and with their codes", async () => {
  const { registry, manager } = await managerWith({ errs: { command: process.execPath, args: [ERRORS] } })
  await manager.start()
  expect(manager.status()[0]!.state).toBe("connected")

  const html = await modelReads(registry.get("mcp__errs__html_page")!.execute({}, ctx))
  expectClean(html)
  expect(html).toContain('MCP server "errs" failed')
  expect(html).toContain("HTTP 502")
  expect(html).toContain('"502 Bad Gateway"')
  expect(html).toContain("code -32603")

  const stack = await modelReads(registry.get("mcp__errs__stack_trace")!.execute({}, ctx))
  expectClean(stack)
  expect(stack).toContain("Cannot read properties of undefined")
  expect(stack).not.toContain("quote.js")

  const long = await modelReads(registry.get("mcp__errs__long_is_error")!.execute({}, ctx))
  expectClean(long)
  expect(long).toContain("error_code=vendor_disabled")
  expect(long).toContain("reason=upstream_down")
  expect(long).toContain("retryable=false")
}, 30_000)

test("remote server: a non-retryable status with an HTML page reaches the model as one short line", async () => {
  const remote = startHttpServer({ stats: { calls: 0, inFlight: 0, maxInFlight: 0, notes: 0 } })
  cleanups.push(remote.stop)
  const { registry, manager } = await managerWith({ data: { type: "http", url: remote.url } })
  await manager.start()
  Object.assign(remote.failCalls, { count: 1, status: 413 })
  const error = await modelReads(registry.get("mcp__data__slow")!.execute({ ms: 1 }, ctx))
  expectClean(error)
  expect(error).toContain('MCP server "data" failed')
  expect(error).toContain("HTTP 413")
  expect(error).toContain('"413 Bad Gateway"')
}, 20_000)

test("remote server: a rejected token reaches the model in English, without the panel's Vietnamese hint", async () => {
  const remote = startHttpServer({ stats: { calls: 0, inFlight: 0, maxInFlight: 0, notes: 0 } })
  cleanups.push(remote.stop)
  const { registry, manager, home } = await managerWith({ data: { type: "http", url: remote.url, headers: { Authorization: "Bearer ${OT_TEST_ERR_TOKEN}" } } })
  await setSecretEnv(home, "OT_TEST_ERR_TOKEN", "anything")
  await manager.start()
  expect(manager.status()[0]!.state).toBe("connected")
  Object.assign(remote.failCalls, { count: 1, status: 401 })
  const error = await modelReads(registry.get("mcp__data__slow")!.execute({ ms: 1 }, ctx))
  expectClean(error)
  expect(error).toContain("rejected the credentials (HTTP 401)")
  // The /mcp panel keeps its Vietnamese explanation for the user.
  expect(manager.status()[0]!.state).toBe("needs-auth")
  expect(manager.status()[0]!.error).toContain("Server từ chối token")
}, 20_000)

test("remote server: the quota message is English", async () => {
  const remote = startHttpServer({ stats: { calls: 0, inFlight: 0, maxInFlight: 0, notes: 0 } })
  cleanups.push(remote.stop)
  const { registry, manager } = await managerWith({ data: { type: "http", url: remote.url } })
  await manager.start()
  Object.assign(remote.failCalls, { count: 1, status: 429, body: { error: "quota_exceeded", retry_after: 3600 } })
  const error = await modelReads(registry.get("mcp__data__slow")!.execute({ ms: 1 }, ctx))
  expectClean(error)
  expect(error).toMatch(/daily quota is exhausted.*\(around \d\d:\d\d local time\)/)
}, 20_000)
