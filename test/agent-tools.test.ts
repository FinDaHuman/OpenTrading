import { expect, test } from "bun:test"
import { z } from "zod"
import { ToolRegistry } from "../src/core/tools/registry"
import { spawnSubagentTool } from "../src/core/tools/subagent/spawn"
import { webFetchTool } from "../src/core/tools/web/fetch"
import { webSearchTool } from "../src/core/tools/web/search"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })

test("web_fetch từ chối URL không phải http(s) mà không chạm mạng", async () => {
  const tool = webFetchTool()
  await expect(tool.execute({ url: "ftp://x/y" }, ctx())).rejects.toThrow("http")
  expect(tool.readOnly).toBe(true)
})

test("web_search định nghĩa đúng (thực thi cần mạng, không test ở đây)", () => {
  const tool = webSearchTool()
  expect(tool.name).toBe("web_search")
  expect(tool.readOnly).toBe(true)
  expect(tool.input instanceof z.ZodType).toBe(true)
})

test("spawn_subagent loại chính nó khỏi tập con và đòi allowlist hợp lệ", async () => {
  const parent = new ToolRegistry()
  parent.register({
    name: "spawn_subagent",
    description: "parent",
    input: z.object({}),
    readOnly: true,
    execute: async () => "parent",
  })
  parent.register({
    name: "current_time",
    description: "clock",
    input: z.object({}),
    readOnly: true,
    execute: async () => "now",
  })
  const tool = spawnSubagentTool(parent)
  expect(tool.name).toBe("spawn_subagent")
  // allowlist rỗng -> lỗi rõ ràng, không gọi model
  await expect(
    tool.execute({ description: "t", task: "ask", tools: [] }, ctx()),
  ).rejects.toThrow("không có tool nào khả dụng")
  // allowlist chỉ chứa spawn_subagent -> cũng rỗng sau khi loại
  await expect(
    tool.execute({ description: "t", task: "ask", tools: ["spawn_subagent"] }, ctx()),
  ).rejects.toThrow("không có tool nào khả dụng")
})
