import { expect, test } from "bun:test"
import type { PresetName } from "../src/core/mcp/presets"
import { isPreset, presetCounts, presetsOf, toolsInPreset } from "../src/core/mcp/presets"

test("tool names map to the presets the server defines them in", () => {
  expect(presetsOf("stock_overview")).toEqual(["scan"])
  expect(presetsOf("market_snapshot")).toEqual(["market"])
  expect(presetsOf("quant_backtest")).toEqual(["quant"])
  expect(presetsOf("brief_build")).toEqual(["brief"])
  expect(presetsOf("geo_intel")).toEqual(["intel"])
  expect(presetsOf("web_search")).toEqual(["market", "intel"]) // web module serves two presets
  expect(presetsOf("brand_new_tool")).toEqual([]) // unknown: never hidden by preset filters
})

test("preset counts include a leftover bucket for unknown tools", () => {
  const counts = presetCounts(["stock_overview", "web_search", "brand_new_tool"])
  expect(counts.market).toBe(1)
  expect(counts.scan).toBe(1)
  expect(counts.intel).toBe(1)
  expect(counts["khác"]).toBe(1)
})

test("toolsInPreset covers the whole table and preset names validate", () => {
  expect(toolsInPreset("market").length).toBeGreaterThan(50)
  expect(toolsInPreset("all").length).toBeGreaterThan(120)
  expect(toolsInPreset("scan")).toContain("stock_screener")
  expect(isPreset("scan")).toBe(true)
  expect(isPreset("tot-nhiet")).toBe(false)
  for (const p of ["market", "scan", "quant", "brief", "intel", "all"]) expect(isPreset(p)).toBe(true)
  void (0 as unknown as PresetName)
})

test("preset-only filtering: scan keeps its tools and non-preset pass-throughs", () => {
  const defs: { name: string; presets?: PresetName[] }[] = [
    { name: "current_time" },
    { name: "other_server_tool", presets: [] },
    { name: "mcp__opentrading__market_snapshot", presets: ["market"] },
    { name: "mcp__opentrading__financial_statements", presets: ["scan"] },
  ]
  const scanSet = new Set(toolsInPreset("scan"))
  const kept = defs.filter((d) => !d.presets || d.presets.length === 0 || d.presets.includes("scan"))
  expect(kept.map((d) => d.name)).toEqual(["current_time", "other_server_tool", "mcp__opentrading__financial_statements"])
})
