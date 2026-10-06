import { expect, test } from "bun:test"
import { z } from "zod"
import { PermissionGate } from "../src/core/permission"
import { ToolRegistry } from "../src/core/tools/registry"
import { childRegistry, spawnSubagentTool } from "../src/core/tools/subagent/spawn"
import type { ToolDef } from "../src/core/tools/types"
import { isPrivateHost, webFetchTool } from "../src/core/tools/web/fetch"
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

test("DuckDuckGo results are parsed and redirect links unwrapped", () => {
  const html =
    '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcafef.vn%2Fa.html&rut=x">VCB <b>lãi</b> kỷ lục</a>' +
    '<a class="result__snippet" href="#">Ngân hàng &amp; lợi nhuận</a>'
  expect(parseDuckDuckGo(html, 8)).toEqual([{ title: "VCB lãi kỷ lục", url: "https://cafef.vn/a.html", text: "Ngân hàng & lợi nhuận" }])
  expect(webSearchTool().readOnly).toBe(true)
})

test("a subagent gets only the parent's read-only tools, the same gate, and its own tool_search", () => {
  const parent = new ToolRegistry()
  parent.gate = new PermissionGate()
  for (const def of [
    tool("spawn_subagent", true),
    tool("tool_search", true),
    tool("ask_user", true),
    tool("current_time", true),
    tool("watchlist_local_delete", false),
    tool("mcp__data__quote", true, { deferrable: true, source: "mcp:data" }),
    tool("mcp__data__place_order", false, { deferrable: true, source: "mcp:data" }),
  ])
    parent.register(def)

  const child = childRegistry(parent)
  expect(child.gate).toBe(parent.gate)
  expect(child.list().map((t) => t.name).sort()).toEqual(["current_time", "mcp__data__quote", "tool_search"])
  // The child's tool_search is its own, not the parent's stub.
  expect(child.get("tool_search")).not.toBe(parent.get("tool_search"))

  // Naming a write tool does not smuggle it in.
  expect(() => childRegistry(parent, ["watchlist_local_delete", "mcp__data__place_order"])).toThrow("không có tool chỉ đọc")
  expect(() => childRegistry(parent, ["spawn_subagent"])).toThrow("không có tool chỉ đọc")
  expect(childRegistry(parent, ["current_time"]).list().map((t) => t.name)).toEqual(["current_time"])
})

test("spawn_subagent reports an empty tool set before calling any model", async () => {
  const parent = new ToolRegistry()
  parent.register(tool("watchlist_local_add", false))
  const spawn = spawnSubagentTool(parent)
  await expect(spawn.execute({ description: "t", task: "ask" }, ctx())).rejects.toThrow("không có tool chỉ đọc")
})
