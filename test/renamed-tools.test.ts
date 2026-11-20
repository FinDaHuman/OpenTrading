import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { z } from "zod"
import { toolFilter } from "../src/core/agents/resolve"
import { childTools } from "../src/core/subagents/manager"
import { chartRenderTool } from "../src/core/tools/chart/render"
import { PermissionGate } from "../src/core/permission"
import { RENAMED_TOOLS, renamedCallMatches, renamedInput } from "../src/core/tools/renamed"
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

test("an agent written with old names keeps its meaning, never gaining an action", () => {
  const tool = (name: string) => ({ name, description: "", input: {}, readOnly: false, execute: async () => "" }) as never
  expect(toolFilter({ tools: ["chart_compare"] })(chartRenderTool())).toBe(true)
  expect(toolFilter({ tools: ["chart_compare"] })(tool("watchlist_local"))).toBe(false)
  const [full] = localWatchlistTools("/nowhere")
  const variant = full!.readOnlyVariant!
  const gets = (def: Parameters<typeof toolFilter>[0]) => childTools([full!], toolFilter(def)).map((t) => (t.readOnly ? "read" : "full"))
  // Read names only: the list/get variant, never create/add/delete.
  expect(gets({ tools: ["watchlist_local_list", "watchlist_local_get"] })).toEqual(["read"])
  // A partial set of write names grants no write (narrower than before, never wider).
  expect(gets({ tools: ["watchlist_local_list", "watchlist_local_add"] })).toEqual(["read"])
  expect(gets({ tools: ["watchlist_local_add"] })).toEqual([])
  // Every old name (a wildcard): the full tool.
  expect(gets({ tools: ["watchlist_local_*"] })).toEqual(["full"])
  // disallowedTools: a write name keeps list/get; a read name removes both.
  expect(gets({ disallowedTools: ["watchlist_local_delete"] })).toEqual(["read"])
  expect(gets({ disallowedTools: ["watchlist_local_list"] })).toEqual([])
  expect(toolFilter({ disallowedTools: ["watchlist_local_delete"] })(variant)).toBe(true)
})

test("an old call's arguments map to the new tool's fields", async () => {
  const chart = chartRenderTool()
  const compare = renamedInput(RENAMED_TOOLS.chart_compare!, {
    title: "VCB vs HPG",
    series: [{ label: "VCB", values: [1, 2, 3] }, { label: "HPG", values: [3, 2, 1] }],
    ymin: -5,
    ymax: 5,
    width: 10,
  })
  const parsed = (chart.input as z.ZodType).parse(compare) as Record<string, unknown>
  expect(parsed).toMatchObject({ kind: "compare", symbol: "VCB vs HPG", labels: ["VCB", "HPG"], matrix: [[1, 2, 3], [3, 2, 1]] })
  expect(parsed.width).toBeUndefined()
  const depth = renamedInput(RENAMED_TOOLS.chart_depth!, { bids: [{ price: 1, volume: 1 }], asks: [{ price: 2, volume: 1 }], depth: 3 })
  expect((chart.input as z.ZodType).parse(depth)).toMatchObject({ kind: "depth", levels: 3 })
  const [watch] = localWatchlistTools("/nowhere")
  expect((watch!.input as z.ZodType).parse(renamedInput(RENAMED_TOOLS.watchlist_local_add!, { name: "core", symbols: ["FPT"] }))).toMatchObject({ action: "add" })
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

test("every old name points at a registered tool and a value of its enum", () => {
  const tools = new Map([chartRenderTool(), ...localWatchlistTools("/nowhere")].map((t) => [t.name, t]))
  for (const [old, to] of Object.entries(RENAMED_TOOLS)) {
    const def = tools.get(to.tool)
    expect(def, old).toBeDefined()
    const shape = (def!.input as z.ZodObject<z.ZodRawShape>).shape
    expect((shape[to.field] as z.ZodEnum).options, old).toContain(to.value)
  }
})
