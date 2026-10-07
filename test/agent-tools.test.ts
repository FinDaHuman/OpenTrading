import { expect, test } from "bun:test"
import { z } from "zod"
import { PermissionGate } from "../src/core/permission"
import { ToolRegistry } from "../src/core/tools/registry"
import { childRegistry, SubagentManager } from "../src/core/subagents/manager"
import { spawnSubagentTool } from "../src/core/tools/subagent/spawn"
import type { ToolDef } from "../src/core/tools/types"
import { fetchPublic, isPrivateHost, webFetchTool } from "../src/core/tools/web/fetch"
import { parseDuckDuckGo, webSearchTool } from "../src/core/tools/web/search"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })

const tool = (name: string, readOnly: boolean, extra: Partial<ToolDef> = {}): ToolDef => ({
  name,
  description: name,
  input: z.object({}),
  readOnly,
  execute: async () => name,
  ...extra,
})

test("web_fetch refuses non-http(s) URLs and local addresses without touching the network", async () => {
  const fetchTool = webFetchTool()
  await expect(fetchTool.execute({ url: "ftp://x/y" }, ctx())).rejects.toThrow("http")
  await expect(fetchTool.execute({ url: "http://127.0.0.1:8080/admin" }, ctx())).rejects.toThrow("nội bộ")
  await expect(fetchTool.execute({ url: "http://localhost/" }, ctx())).rejects.toThrow("nội bộ")
  expect(fetchTool.readOnly).toBe(true)
})

test("private hosts are recognised; public names that merely look similar are not", () => {
  for (const host of ["localhost", "a.localhost", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "[::1]", "fd00::1", "printer.local"]) {
    expect(isPrivateHost(host)).toBe(true)
  }
  for (const host of ["cafef.vn", "fcbarcelona.com", "fd.example.com", "172.32.0.1", "8.8.8.8"]) {
    expect(isPrivateHost(host)).toBe(false)
  }
})

test("web_fetch checks every redirect hop before sending a request to it", async () => {
  const sent: string[] = []
  const fake = (async (input: URL) => {
    sent.push(input.href)
    if (input.hostname === "news.example") return new Response(null, { status: 302, headers: { location: "https://cdn.example/a" } })
    if (input.hostname === "cdn.example") return new Response(null, { status: 301, headers: { location: "http://127.0.0.1:9000/admin" } })
    return new Response("ok")
  }) as unknown as typeof fetch
  const signal = new AbortController().signal
  await expect(fetchPublic(new URL("https://news.example/x"), signal, fake)).rejects.toThrow("nội bộ")
  expect(sent).toEqual(["https://news.example/x", "https://cdn.example/a"]) // 127.0.0.1 never requested

  const loop = (async (input: URL) => new Response(null, { status: 302, headers: { location: `${input.href}x` } })) as unknown as typeof fetch
  await expect(fetchPublic(new URL("https://loop.example/"), signal, loop)).rejects.toThrow("Quá nhiều lần chuyển hướng")
  const ok = await fetchPublic(new URL("https://news.example.org/"), signal, (async () => new Response("body")) as unknown as typeof fetch)
  expect(await ok.text()).toBe("body")
})

test("DuckDuckGo results are parsed and redirect links unwrapped", () => {
  const html =
    '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcafef.vn%2Fa.html&rut=x">VCB <b>lãi</b> kỷ lục</a>' +
    '<a class="result__snippet" href="#">Ngân hàng &amp; lợi nhuận</a>'
  expect(parseDuckDuckGo(html, 8)).toEqual([{ title: "VCB lãi kỷ lục", url: "https://cafef.vn/a.html", text: "Ngân hàng & lợi nhuận" }])
  expect(webSearchTool().readOnly).toBe(true)
})

test("a subagent gets the parent's tools minus spawn/ask/todo/memory, the same gate and lock, and its own tool_search/load_skill", () => {
  const parent = new ToolRegistry()
  parent.gate = new PermissionGate()
  for (const def of [
    tool("spawn_subagent", true),
    tool("send_message", true),
    tool("tool_search", true),
    tool("load_skill", true),
    tool("ask_user", true),
    tool("todo_write", false),
    tool("propose_memory", false, { source: "memory:file" }),
    tool("current_time", true),
    tool("watchlist_local_delete", false),
    tool("mcp__data__quote", true, { deferrable: true, source: "mcp:data" }),
    tool("mcp__data__place_order", false, { deferrable: true, source: "mcp:data" }),
  ])
    parent.register(def)

  const origin = { id: "ag-1", type: "nghien-cuu", description: "x" }
  const child = childRegistry(parent, origin, undefined, () => [])
  expect(child.gate).toBe(parent.gate)
  expect(child.lock).toBe(parent.lock)
  expect(child.origin).toEqual(origin)
  expect(child.list().map((t) => t.name).sort()).toEqual([
    "current_time",
    "load_skill",
    "mcp__data__place_order",
    "mcp__data__quote",
    "tool_search",
    "watchlist_local_delete",
  ])
  // tool_search and load_skill are the child's own, bound to its registry.
  expect(child.get("tool_search")).not.toBe(parent.get("tool_search"))
  expect(child.get("load_skill")).not.toBe(parent.get("load_skill"))

  // A filter can narrow, never re-add an excluded tool.
  expect(() => childRegistry(parent, origin, (t) => t.name === "spawn_subagent")).toThrow("không có tool nào")
  expect(childRegistry(parent, origin, (t) => t.readOnly).list().map((t) => t.name)).toEqual(["current_time", "mcp__data__quote", "tool_search"])
})

test("spawn_subagent holds no lock, has no timeout, and reports an empty tool set before calling any model", async () => {
  const parent = new ToolRegistry()
  parent.register(tool("ask_user", true))
  const spawn = spawnSubagentTool(new SubagentManager({ parent }))
  expect(spawn.unlocked).toBe(true)
  expect(spawn.timeoutMs).toBe(0)
  await expect(spawn.execute({ description: "t", prompt: "ask" }, ctx())).rejects.toThrow("không có tool nào")
})
