import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { toolFilter } from "../src/core/agents/resolve"
import { PermissionGate } from "../src/core/permission"
import { RENAMED_TOOLS, renamedCallMatches } from "../src/core/tools/renamed"
import { localWatchlistTools } from "../src/core/tools/watchlist/local"
import { removeTempDir } from "./helpers/temp"

const signal = () => new AbortController().signal

test("a deny rule for an old watchlist tool still refuses that action, and only that action", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ot-ren-"))
  try {
    const [tool] = localWatchlistTools(home)
    const gate = new PermissionGate({ load: async () => [], save: async () => {}, lists: async () => ({ deny: [{ tool: "watchlist_local_delete" }], ask: [] }) })
    await gate.refreshRules()
    expect((await gate.check(tool!, { action: "delete", name: "core" }, signal())).reason).toBe("rule")
    // list runs unasked: the old rule did not cover it.
    expect((await gate.check(tool!, { action: "list" }, signal())).allow).toBe(true)
    // A wildcard over the old names covers every action.
    expect(renamedCallMatches((old) => old.startsWith("watchlist_local_"), "watchlist_local", { action: "get" })).toBe(true)
  } finally {
    await removeTempDir(home)
  }
})

test("an agent written with old names keeps its meaning", () => {
  const tool = (name: string) => ({ name, description: "", input: {}, readOnly: false, execute: async () => "" }) as never
  expect(toolFilter({ disallowedTools: ["watchlist_local_delete"] })(tool("watchlist_local"))).toBe(false)
  expect(toolFilter({ tools: ["chart_compare"] })(tool("chart_render"))).toBe(true)
  expect(toolFilter({ tools: ["chart_compare"] })(tool("watchlist_local"))).toBe(false)
})

test("only delete is marked destructive in the approval prompt", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ot-ren-"))
  try {
    const [tool] = localWatchlistTools(home)
    expect(tool!.annotationsFor!({ action: "delete", name: "x" })).toEqual({ destructive: true })
    expect(tool!.annotationsFor!({ action: "add", name: "x", symbols: ["FPT"] })).toBeUndefined()
  } finally {
    await removeTempDir(home)
  }
})

test("every old name points at a tool field value", () => {
  for (const to of Object.values(RENAMED_TOOLS)) expect(to.tool && to.field && to.value).toBeTruthy()
})
