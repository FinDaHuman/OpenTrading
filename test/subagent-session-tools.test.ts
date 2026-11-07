import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

// Isolated state dir before core modules read it (the session store resolves it on import).
const home = await mkdtemp(path.join(os.tmpdir(), "ot-subagent-session-"))
process.env.OPENTRADING_HOME = home
afterAll(() => rm(home, { recursive: true, force: true }))

const { agentRoots, loadAgents } = await import("../src/core/agents/loader")
const { toolFilter } = await import("../src/core/agents/resolve")
const { childRegistry, SubagentManager } = await import("../src/core/subagents/manager")
const { ToolRegistry } = await import("../src/core/tools/registry")
const { sessionHistoryTools } = await import("../src/core/tools/session/history")
type ToolDef = import("../src/core/tools/types").ToolDef

const tool = (name: string, readOnly: boolean): ToolDef => ({ name, description: name, input: z.object({}), readOnly, execute: async () => name })

const historyNames = sessionHistoryTools().map((t) => t.name)

function parentWithHistory() {
  const parent = new ToolRegistry()
  for (const def of [...sessionHistoryTools(), tool("current_time", true), tool("web_search", true), tool("watchlist_local_add", false)]) parent.register(def)
  return parent
}

const origin = { id: "ag-1", type: "x", description: "x" }

/** The child's tool names, or [] when the filter left nothing (childRegistry throws then). */
function childNames(parent: InstanceType<typeof ToolRegistry>, filter?: (def: ToolDef) => boolean) {
  try {
    return childRegistry(parent, origin, filter)
      .list()
      .map((t) => t.name)
  } catch (error) {
    expect(String(error)).toContain("không có tool nào")
    return []
  }
}

test("TC-007: every session history tool is marked main-agent-only", () => {
  const tools = sessionHistoryTools()
  expect(tools.length).toBeGreaterThan(0)
  for (const def of tools) expect(def.mainAgentOnly).toBe(true)
})

test("no bundled agent type, nor one naming the history tools outright, gets them; the parent keeps them (TC-006)", async () => {
  const parent = parentWithHistory()
  const { agents, problems } = await loadAgents(agentRoots(home).filter((r) => r.source === "bundled"))
  expect(problems).toEqual([])
  expect(agents).toHaveLength(17)
  const custom = { tools: ["session_get", "session_list", "@chi-doc"] }
  for (const def of [...agents, custom, {}]) {
    const names = childNames(parent, toolFilter(def))
    for (const name of historyNames) expect(names).not.toContain(name)
  }
  // The named type still gets the read-only tools its "@chi-doc" allows.
  expect(childNames(parent, toolFilter(custom))).toEqual([])
  expect(childNames(parent, toolFilter({ tools: ["@chi-doc"] }))).toEqual(["current_time", "web_search"])
  // The main agent's registry is untouched.
  const parentNames = parent.list().map((t) => t.name)
  for (const name of historyNames) expect(parentNames).toContain(name)
})

// SubagentManager.start (and the ultradesk, which starts its agents through the manager's
// start, runtime.ts) builds the child registry before any model call and throws at once when
// it is empty: a parent holding only history tools must leave the subagent with nothing.
// The resume path (continue) needs a real sidechain file; it calls the same childRegistry,
// so the childRegistry tests above cover it.
test("SubagentManager.start never hands a subagent the history tools", () => {
  const parent = new ToolRegistry()
  for (const def of sessionHistoryTools()) parent.register(def)
  const manager = new SubagentManager({ parent })
  expect(() => manager.start({ description: "x", prompt: "đọc phiên cũ" })).toThrow("không có tool nào")
  expect(() => manager.start({ description: "x", prompt: "đọc phiên cũ", toolFilter: toolFilter({ tools: ["session_*"] }) })).toThrow(
    "không có tool nào",
  )
})
