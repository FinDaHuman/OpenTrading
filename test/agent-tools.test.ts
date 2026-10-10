import { expect, test } from "bun:test"
import { z } from "zod"
import { PermissionGate } from "../src/core/permission"
import { ToolRegistry } from "../src/core/tools/registry"
import { childRegistry, SubagentManager } from "../src/core/subagents/manager"
import { spawnSubagentTool } from "../src/core/tools/subagent/spawn"
import type { ToolDef } from "../src/core/tools/types"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })

const tool = (name: string, readOnly: boolean, extra: Partial<ToolDef> = {}): ToolDef => ({
  name,
  description: name,
  input: z.object({}),
  readOnly,
  execute: async () => name,
  ...extra,
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
