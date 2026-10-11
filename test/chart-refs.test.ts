import { beforeEach, expect, test } from "bun:test"
import { z } from "zod"
import { chartCompareTool } from "../src/core/tools/chart/compare"
import { chartRenderTool } from "../src/core/tools/chart/render"
import { clearResults, recallResult } from "../src/core/tools/refs"
import { RwLock, runTool } from "../src/core/tools/wrap"
import type { ToolDef, ToolResult } from "../src/core/tools/types"
import { buildChart, resampleBars } from "../src/tui/ui/chart-box"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })

/** A fake MCP candle tool: envelope with newest-first rows, as some upstreams send. */
function candleTool(symbol: string, closes: number[]): ToolDef {
  const rows = closes
    .map((c, i) => ({ time: `2026-09-${String(i + 1).padStart(2, "0")}`, open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1000 * (i + 1) }))
    .reverse()
  return {
    name: `mcp__ot__${symbol.toLowerCase()}_history`,
    source: "mcp:ot",
    description: "candles",
    input: z.object({}),
    readOnly: true,
    execute: async () => JSON.stringify({ data: { symbol, candles: rows }, provenance: { source: "vnstock" } }),
  }
}

const callTool = async (def: ToolDef) => (await runTool(def, {}, ctx(), new RwLock())).output
const refOf = (output: string) => output.match(/^\[ref (r\d+)\]/)?.[1]

beforeEach(() => clearResults())

test("an MCP result with a data array is stamped [ref rN] and kept whole; plain text is not", async () => {
  const out = await callTool(candleTool("FPT", [100, 101, 102, 103, 104, 105]))
  const ref = refOf(out)
  expect(ref).toBe("r1")
  expect(recallResult(ref!)!.text.startsWith("{")).toBe(true)
  const plain: ToolDef = { name: "mcp__ot__note", source: "mcp:ot", description: "", input: z.object({}), readOnly: true, execute: async () => "Không có dữ liệu." }
  expect(refOf(await callTool(plain))).toBeUndefined()
  const local: ToolDef = { ...plain, name: "local_json", source: "local", execute: async () => JSON.stringify([1, 2, 3, 4]) }
  expect(refOf(await callTool(local))).toBeUndefined()
})

test("chart_render from_call draws candles from the stored result, oldest first, without the model typing numbers", async () => {
  const ref = refOf(await callTool(candleTool("FPT", [100, 101, 102, 103, 104, 106])))!
  const res = (await chartRenderTool().execute({ kind: "candlestick", from_call: ref }, ctx())) as ToolResult
  expect(res.chart).toMatchObject({ kind: "candlestick", symbol: "FPT" })
  const chart = res.chart as { bars: { c: number; v?: number }[]; times: string[] }
  expect(chart.bars.map((b) => b.c)).toEqual([100, 101, 102, 103, 104, 106])
  expect(chart.times[0]).toBe("2026-09-01")
  expect(res.output).toContain(`Đã vẽ nến FPT 6 phiên 2026-09-01→2026-09-06 (số lấy từ ${ref})`)
  expect(res.output).toContain("đóng cửa cuối 106")

  const vol = (await chartRenderTool().execute({ kind: "sparkcolumn", from_call: ref, field: "volume" }, ctx())) as ToolResult
  expect(vol.chart).toMatchObject({ kind: "sparkcolumn", series: [1000, 2000, 3000, 4000, 5000, 6000], dirs: [true, true, true, true, true, true] })

  await expect(chartRenderTool().execute({ kind: "line", from_call: ref, field: "eps" }, ctx())).rejects.toThrow("Trường số có")
  await expect(chartRenderTool().execute({ kind: "heatmap", from_call: ref }, ctx())).rejects.toThrow("chưa hỗ trợ from_call")
  await expect(chartRenderTool().execute({ kind: "line", from_call: "r99" }, ctx())).rejects.toThrow("Không còn kết quả")
})

test("chart_compare from_calls compares the close series of two results", async () => {
  const a = refOf(await callTool(candleTool("FPT", [100, 110])))!
  const b = refOf(await callTool(candleTool("CMG", [50, 45, 40])))!
  const res = (await chartCompareTool().execute({ from_calls: [a, b] }, ctx())) as ToolResult
  expect(res.output).toContain("FPT +10%, CMG -20%")
  await expect(chartCompareTool().execute({ from_calls: [a, b], ymin: 5 }, ctx())).rejects.toThrow("đi cùng nhau")
})

test("input checks: OHLC must be consistent, times must match the points, multiline takes 60 points", async () => {
  const bad = [{ o: 10, h: 9, l: 8, c: 9.5 }, ...Array.from({ length: 4 }, () => ({ o: 10, h: 11, l: 9, c: 10 }))]
  expect(chartRenderTool().input.safeParse({ kind: "candlestick", bars: bad }).success).toBe(false)
  await expect(chartRenderTool().execute({ kind: "line", series: [1, 2, 3], times: ["a", "b"] }, ctx())).rejects.toThrow("times có 2 nhãn")
  const long = Array.from({ length: 60 }, (_, i) => i + 1)
  expect(chartRenderTool().input.safeParse({ kind: "multiline", matrix: [long, long.map((v) => v * 2)] }).success).toBe(true)
  const res = (await chartRenderTool().execute({ kind: "sparkcolumn", series: [3, 1, 2], dirs: [true, false, true] }, ctx())) as ToolResult
  expect(res.chart).toMatchObject({ dirs: [true, false, true] })
})

test("candles: resampling merges OHLC (keeps the extremes), the title counts every session, the axis labels the drawn range", () => {
  const bars = Array.from({ length: 90 }, (_, i) => ({ o: 50, h: i === 37 ? 80 : 51, l: i === 61 ? 20 : 49, c: 50.5, v: 10 }))
  const merged = resampleBars(bars, [], 30)
  expect(merged).toHaveLength(30)
  expect(Math.max(...merged.map((m) => m.b.h))).toBe(80)
  expect(Math.min(...merged.map((m) => m.b.l))).toBe(20)
  expect(merged.reduce((a, m) => a + (m.b.v ?? 0), 0)).toBe(900)
  const built = buildChart({ kind: "candlestick", symbol: "VCB", bars }, 80)
  const title = built.title.map((r) => r.text).join("")
  expect(title).toContain("nến 90 phiên")
  expect(title).toContain("Vol 900")
  // Padded range: 20 - 0.1*60 = 14 at the bottom, 80 + 0.2*60 = 92 at the top.
  const rows = built.grid.map((r) => r.map((c) => c.ch).join(""))
  expect(rows[0]).toContain("92┤")
  expect(rows[11]).toContain("14┤")
})

test("compare: a shorter series is right-aligned; heatmap with ± values is centred on 0", () => {
  const built = buildChart({ kind: "compare", series: [{ label: "A", values: [10, 11, 12, 13, 14, 15, 16, 17, 18, 20] }, { label: "B", values: [10, 12] }] }, 80)
  const rows = built.grid.map((r) => r.map((c) => c.ch).join(""))
  const bRows = rows.slice(rows.findIndex((r) => r.includes("B +20")))
  const firstMark = (r: string) => r.slice(8).search(/[^\s│┤]/)
  const marks = bRows.slice(1, 10).map(firstMark).filter((i) => i >= 0)
  expect(Math.min(...marks)).toBeGreaterThan(20)
  const heat = buildChart({ kind: "heatmap", matrix: [[1, -1], [0, 0.5]] }, 80)
  const zero = heat.grid[1]!.find((c) => c.ch === "0")!
  const neg = heat.grid[0]!.find((c) => c.ch === "-")!
  expect(String(zero.bg)).not.toBe(String(neg.bg))
})

/** A fake batch tool shaped like market_candles_batch: one entry per symbol under data.series. */
function batchTool(series: Record<string, number[]>): ToolDef {
  const entries = Object.entries(series).map(([symbol, closes]) => ({
    symbol,
    candles: closes.map((c, i) => ({ t: `2026-06-${String(i + 1).padStart(2, "0")}`, o: c + 1, h: c + 2, l: c - 2, c, v: 100 * (i + 1) })),
  }))
  return {
    name: "mcp__ot__market_candles_batch",
    source: "mcp:ot",
    description: "batch",
    input: z.object({}),
    readOnly: true,
    execute: async () => JSON.stringify({ data: { series: entries } }),
  }
}

const five = (start: number, step: number) => Array.from({ length: 5 }, (_, i) => start + i * step)
const render = (input: Parameters<ReturnType<typeof chartRenderTool>["execute"]>[0]) => chartRenderTool().execute(input, ctx()) as Promise<ToolResult>

test("batch ref: chart_compare splits one result into one labelled series per symbol", async () => {
  const ref = refOf(await callTool(batchTool({ FPT: [100, 110], SHB: [10, 8], NVL: [20, 25] })))!
  const res = (await chartCompareTool().execute({ from_calls: [ref] }, ctx())) as ToolResult
  expect(res.output).toContain("FPT +10%, SHB -20%, NVL +25%")
  expect((res.chart as { series: { label: string }[] }).series.map((s) => s.label)).toEqual(["FPT", "SHB", "NVL"])
  const two = (await chartCompareTool().execute({ from_calls: [ref], symbols: ["nvl", "FPT"] }, ctx())) as ToolResult
  expect(two.output).toContain("FPT +10%, NVL +25%")
  await expect(chartCompareTool().execute({ from_calls: [ref], symbols: ["VCB"] }, ctx())).rejects.toThrow("không có mã VCB")
  await expect(chartCompareTool().execute({ from_calls: [ref], symbols: ["FPT"] }, ctx())).rejects.toThrow("cần 2–5")
})

test("single-symbol results in the batch shape are labelled by their symbol, not the ref", async () => {
  const a = refOf(await callTool(batchTool({ FPT: [100, 110] })))!
  const b = refOf(await callTool(batchTool({ SHB: [10, 8] })))!
  const res = (await chartCompareTool().execute({ from_calls: [a, b] }, ctx())) as ToolResult
  expect(res.output).toContain("FPT +10%, SHB -20%")
  expect(res.output).not.toContain(`${a} +`)
})

test("batch ref: chart_render never draws the first symbol by default; from_symbol or a leading ticker picks one", async () => {
  const ref = refOf(await callTool(batchTool({ FPT: five(100, 1), SHB: five(10, -1), NVL: five(20, 1) })))!
  await expect(render({ kind: "candlestick", from_call: ref })).rejects.toThrow("nhiều mã: FPT, SHB, NVL")
  const byName = await render({ kind: "candlestick", from_call: ref, symbol: "SHB — 90 ngày" })
  expect((byName.chart as { bars: { c: number }[] }).bars.map((b) => b.c)).toEqual(five(10, -1))
  expect(byName.output).toContain("Đã vẽ nến SHB — 90 ngày")
  const explicit = await render({ kind: "line", from_call: ref, from_symbol: "nvl" })
  expect(explicit.chart).toMatchObject({ symbol: "NVL", series: five(20, 1) })
  await expect(render({ kind: "line", from_call: ref, from_symbol: "VCB" })).rejects.toThrow("Mã có trong kết quả: FPT, SHB, NVL")
})

test("a single-symbol ref refuses a display name naming another stored result's symbol, or another from_symbol", async () => {
  const ref = refOf(await callTool(batchTool({ FPT: five(100, 1) })))!
  // Titles that start with an abbreviation, not a ticker, draw.
  for (const symbol of ["KLGD FPT 20 phiên", "LNST FPT theo quý", "ROE FPT", "SHB — 90 ngày", "Giá đóng cửa 2026"]) {
    expect((await render({ kind: "line", from_call: ref, symbol })).chart).toMatchObject({ kind: "line" })
  }
  await expect(render({ kind: "candlestick", from_call: ref, from_symbol: "SHB" })).rejects.toThrow("không có dữ liệu mã SHB")
  // Once SHB's data is stored, "SHB — …" on FPT's ref is the r38/r39 mix-up: refused.
  refOf(await callTool(batchTool({ SHB: five(10, 1) })))
  await expect(render({ kind: "candlestick", from_call: ref, symbol: "SHB — 90 ngày" })).rejects.toThrow(`${ref} là dữ liệu mã FPT`)
  expect((await render({ kind: "candlestick", from_call: ref, symbol: "FPT — 90 ngày" })).chart).toMatchObject({ kind: "candlestick" })
  expect((await render({ kind: "line", from_call: ref, symbol: "SHB so với", from_symbol: "FPT" })).chart).toMatchObject({ kind: "line" })
})

test("a batch of more than five symbols is fully seen; a large nested result is walked quickly", async () => {
  const many = Object.fromEntries(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].map((s, i) => [s, five(10 + i, 1)]))
  const ref = refOf(await callTool(batchTool(many)))!
  expect((await render({ kind: "line", from_call: ref, from_symbol: "FFF" })).chart).toMatchObject({ series: five(15, 1) })

  const nest = (depth: number): unknown => (depth === 0 ? [1, 2, 3] : Array.from({ length: 30 }, () => ({ x: 1, child: nest(depth - 1) })))
  const huge: ToolDef = { ...batchTool({}), execute: async () => JSON.stringify({ data: nest(3) }) }
  const deep = refOf(await callTool(huge))!
  const started = Date.now()
  await render({ kind: "line", from_call: deep }).catch(() => undefined)
  expect(Date.now() - started).toBeLessThan(3000)
})

test("% over the period is close to close everywhere: candle summary, candle header and chart_compare agree", async () => {
  // First bar opens at 101 but closes at 100; the last close is 110 → +10%, not +8.91%.
  const ref = refOf(await callTool(batchTool({ FPT: [100, 102, 104, 106, 110] })))!
  const candle = await render({ kind: "candlestick", from_call: ref })
  expect(candle.output).toContain("(+10% cả kỳ)")
  const title = buildChart(candle.chart as Parameters<typeof buildChart>[0], 80).title.map((r) => r.text).join("")
  expect(title).toContain("+10.0%")
  const other = refOf(await callTool(batchTool({ SHB: [10, 10, 10, 10, 10] })))!
  expect(((await chartCompareTool().execute({ from_calls: [ref, other] }, ctx())) as ToolResult).output).toContain("FPT +10%")
})

test("bar with a matrix (grouped bars) says which kinds draw several series", async () => {
  await expect(render({ kind: "bar", labels: ["a", "b"], matrix: [[1, 2], [3, 4]] })).rejects.toThrow("không nhận matrix. Nhiều mã theo thời gian: kind=multiline")
  await expect(render({ kind: "bar", series: [] })).rejects.toThrow("cần series ít nhất 1 cột")
})
