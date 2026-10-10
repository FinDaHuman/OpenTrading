import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { cycleStatsTools } from "../src/core/tools/cycle-stats/cycle-stats"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
let home = ""

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "ot-cs-"))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

function tool(name: string) {
  const t = cycleStatsTools(home).find((t) => t.name === name)!
  expect(t).toBeDefined()
  return t
}

test("three tools registered, deferred, refresh is the only writer", () => {
  const tools = cycleStatsTools(home)
  expect(tools.map((t) => t.name).sort()).toEqual(
    ["cycle_stats_check", "cycle_stats_finalize", "cycle_stats_refresh"].sort(),
  )
  for (const t of tools) expect((t as { deferrable?: boolean }).deferrable).toBe(true)
  expect(tool("cycle_stats_check").readOnly).toBe(true)
  expect(tool("cycle_stats_finalize").readOnly).toBe(true)
  expect(tool("cycle_stats_refresh").readOnly).toBe(false)
  expect(tool("cycle_stats_refresh").timeoutMs).toBeGreaterThanOrEqual(120_000)
})

test("refresh input capped at 15 symbols", () => {
  const t = tool("cycle_stats_refresh")
  const schema = t.input as { safeParse: (v: unknown) => { success: boolean } }
  expect(schema.safeParse({ symbols: [] }).success).toBe(false)
  expect(schema.safeParse({ symbols: Array(15).fill("VCB") }).success).toBe(true)
  expect(schema.safeParse({ symbols: Array(16).fill("VCB") }).success).toBe(false)
})

test("check on empty cache reports zero coverage without fetching", async () => {
  const out = (await tool("cycle_stats_check").execute({ as_of: "2026-10-09" }, ctx())) as string
  const data = JSON.parse(out)
  expect(data.cached_symbols).toBe(0)
  expect(data.members_version).toBe("v1")
  expect(typeof data.days_stale).toBe("number")
  expect(data.needs_refresh).toBe(false)
})
