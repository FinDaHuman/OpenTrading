import { expect, test } from "bun:test"
import { chartCompareTool } from "../src/core/tools/chart/compare"
import { chartDepthTool, chartRenderTool, type ChartRenderInput } from "../src/core/tools/chart/render"
import { modelOutput } from "../src/core/tools/registry"
import type { ToolResult } from "../src/core/tools/types"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
const ESC = String.fromCharCode(27)

/** The text the model sees: chart_render now returns a ToolResult (output + chart). */
const text = async (input: ChartRenderInput) => ((await chartRenderTool().execute(input, ctx())) as ToolResult).output as string

const bars = [
  { o: 57.3, h: 58.5, l: 57.2, c: 58.1 },
  { o: 58.1, h: 58.9, l: 57.8, c: 58.0 },
  { o: 58.0, h: 58.4, l: 57.0, c: 57.4 },
  { o: 57.4, h: 57.9, l: 56.8, c: 57.7 },
  { o: 57.7, h: 58.6, l: 57.5, c: 58.4 },
]

test("chart_render candlestick needs >=5 bars", async () => {
  const tool = chartRenderTool()
  await expect(tool.execute({ kind: "candlestick", bars: bars.slice(0, 3) }, ctx())).rejects.toThrow("ít nhất 5 nến")
  expect(await text({ kind: "candlestick", bars, symbol: "VCB" })).toContain("VCB")
})

test("chart_render line and sparkline", async () => {
  const tool = chartRenderTool()
  expect(await text({ kind: "line", series: [1, 2, 1.5, 3] })).toContain("line")
  expect(await text({ kind: "sparkline", series: [1, 2, 3] })).toBeTruthy()
  await expect(tool.execute({ kind: "line", series: [1] }, ctx())).rejects.toThrow("ít nhất 2 điểm")
})

test("chart_depth renders ladder and rejects empty book", async () => {
  const tool = chartDepthTool()
  const res = (await tool.execute({ symbol: "VCB", bids: [{ price: 57.3, volume: 100 }], asks: [{ price: 57.4, volume: 50 }] }, ctx())) as ToolResult
  expect(res.output).toContain("BID")
  expect(res.output).toContain("ASK")
  expect(res.chart).toEqual({ kind: "depth", symbol: "VCB", bids: [{ price: 57.3, volume: 100 }], asks: [{ price: 57.4, volume: 50 }], depth: 5 })
  await expect(tool.execute({ bids: [], asks: [] }, ctx())).rejects.toThrow("rỗng")
})

test("chart output is plain text: no ANSI codes reach the model or the transcript", async () => {
  const series = [1.12, -0.8, -1.33, 2, 0.5]
  const inputs: ChartRenderInput[] = [
    { kind: "candlestick", bars },
    { kind: "line", series },
    { kind: "sparkline", series },
    { kind: "area", series },
    { kind: "bar", series, labels: ["Vật liệu", "Tài chính", "BĐS"] },
    { kind: "histogram", series },
    { kind: "heatmap", matrix: [[1, 0.5], [0.5, 1]] },
    // The library colours these two unconditionally.
    { kind: "gauge", value: 72, max: 100 },
    { kind: "donut", value: 35, max: 100 },
    { kind: "winloss", series },
  ]
  for (const input of inputs) expect(await text(input)).not.toContain(ESC)
  const bar = await text({ kind: "bar", series, labels: ["Vật liệu"] })
  expect(bar).toContain("Vật liệu")
  expect(bar).toContain("█ dương, ░ âm")
})

test("chart_render gauge donut histogram heatmap winloss", async () => {
  const tool = chartRenderTool()
  expect(await text({ kind: "gauge", value: 72, max: 100, unit: "%" })).toContain("72%")
  expect(await text({ kind: "donut", value: 35, max: 100, unit: "%" })).toContain("35%")
  await expect(tool.execute({ kind: "gauge", value: 1 }, ctx())).rejects.toThrow("cần value + max")
  expect(await text({ kind: "histogram", series: [1, 2, 2, 3, 3, 3, 4, 5] })).toContain("phân phối")
  const heat = await text({ kind: "heatmap", matrix: [[1, 0.5], [0.5, 1]], labels: ["VCB", "HPG", "VCB", "HPG"] })
  expect(heat).toContain("heatmap (2x2)")
  await expect(tool.execute({ kind: "heatmap", matrix: [] }, ctx())).rejects.toThrow("matrix 2D")
  expect(await text({ kind: "winloss", series: [1, -1, 1] })).toContain("▲+1 ▼-1 ▲+1")
})

test("chart_render returns structured chart data for the TUI, text only for the model", async () => {
  const tool = chartRenderTool()
  const res = (await tool.execute({ kind: "candlestick", bars, symbol: "VCB" }, ctx())) as ToolResult
  expect(res.chart).toEqual({ kind: "candlestick", symbol: "VCB", bars })
  expect(res.output).toContain("VCB")
  // The model sees the text only: chart data costs zero tokens.
  const forModel = modelOutput(res, false)
  expect(forModel).toEqual({ type: "text", value: res.output })
  expect(JSON.stringify(forModel)).not.toContain('"o":')
  const pie = (await tool.execute({ kind: "pie", series: [25, 18, 15], labels: ["Ngân hàng", "Vật liệu", "BĐS"] }, ctx())) as ToolResult
  expect(pie.chart).toEqual({ kind: "pie", symbol: undefined, series: [25, 18, 15], labels: ["Ngân hàng", "Vật liệu", "BĐS"] })
})

test("chart_compare puts each series on its own row, on one shared % scale", async () => {
  const tool = chartCompareTool()
  const res = (await tool.execute(
    { title: "VCB vs HPG", series: [{ label: "VCB", values: [50, 55] }, { label: "HPG", values: [20, 19, 18] }] },
    ctx(),
  )) as ToolResult
  const out = res.output as string
  const lines = out.split("\n")
  expect(lines[0]).toBe("VCB vs HPG · % thay đổi từ điểm đầu, cùng thang -10.0% … +10.0%:")
  expect(lines[1]).toMatch(/^VCB .+ \+10\.0%$/)
  expect(lines[2]).toMatch(/^HPG .+ -10\.0%$/)
  // The shorter series is right-aligned, so the last points line up.
  expect(lines[1]!.lastIndexOf(" ")).toBe(lines[2]!.lastIndexOf(" "))
  expect(out).not.toContain(ESC)
  expect(res.chart).toEqual({
    kind: "compare",
    title: "VCB vs HPG",
    series: [{ label: "VCB", values: [50, 55] }, { label: "HPG", values: [20, 19, 18] }],
  })
  await expect(tool.execute({ series: [{ label: "A", values: [0, 1] }, { label: "B", values: [1, 2] }] }, ctx())).rejects.toThrow("bắt đầu bằng 0")
})

const matrix3 = [
  [25, 18, 15],
  [20, 12, 8],
  [15, 10, 7],
]

test("chart_render pie: proportional rows sorted desc, % of total, skips <=0 slices", async () => {
  const tool = chartRenderTool()
  const out = await text({ kind: "pie", series: [25, 18, 15], labels: ["Ngân hàng", "Vật liệu", "BĐS"] })
  const lines = out.split("\n")
  expect(lines[0]!).toContain("3 lát")
  expect(lines[1]!).toMatch(/^Ngân hàng\s+█+ 43\.1%$/)
  expect(lines[2]!).toContain("Vật liệu")
  expect(lines[3]!).toContain("BĐS")
  const withZero = await text({ kind: "pie", series: [10, 0, 5], labels: ["A", "B", "C"] })
  expect(withZero).toContain("bỏ 1 lát ≤0")
  await expect(tool.execute({ kind: "pie", series: [5] }, ctx())).rejects.toThrow("ít nhất 2 lát")
  await expect(tool.execute({ kind: "pie", series: [0, -1] }, ctx())).rejects.toThrow("≤ 0")
  expect(out).not.toContain(ESC)
})

test("chart_render waterfall: cumulative bars, delta and running total, start/end markers", async () => {
  const tool = chartRenderTool()
  const out = await text({
    kind: "waterfall",
    start: 57.3,
    series: [0.8, -0.7, 1.0],
    labels: ["KTQL", "Khối ngoại", "Dòng tiền"],
    symbol: "VCB",
  })
  const lines = out.split("\n")
  expect(lines[0]!).toContain("3 bước")
  expect(lines[0]!).toContain("57.3 → 58.4")
  expect(lines[1]!).toContain("Bắt đầu")
  expect(lines[2]!).toMatch(/^KTQL\s+├█+┤\s+\+0\.8 → 58\.1$/)
  expect(lines[3]!).toMatch(/^Khối ngoại\s+├░+┤\s+-0\.7 → 57\.4$/)
  expect(lines[4]!).toMatch(/^Dòng tiền\s+├█+┤\s+\+1 → 58\.4$/)
  expect(lines[5]!).toContain("Kết thúc")
  await expect(tool.execute({ kind: "waterfall", series: [1] }, ctx())).rejects.toThrow("cần start")
  await expect(tool.execute({ kind: "waterfall", start: 1, series: [] }, ctx())).rejects.toThrow("ít nhất 1 bước")
  expect(out).not.toContain(ESC)
})

test("chart_render multiline: distinct markers per series on one axes, legend after", async () => {
  const tool = chartRenderTool()
  const out = await text({ kind: "multiline", matrix: [[57.3, 58.1, 57.4, 58.4], [20.1, 19.8, 20.5, 21.2]], labels: ["VCB", "HPG"] })
  expect(out).toContain("2 series")
  expect(out).toContain("● VCB")
  expect(out).toContain("◆ HPG")
  expect(out).toContain("└")
  expect(out).toContain("┤")
  // The two series sit on one grid, so both markers appear in the plot rows.
  const plotRows = out.split("\n").filter((l) => l.includes("●") || l.includes("◆"))
  expect(plotRows.length).toBeGreaterThan(2)
  await expect(tool.execute({ kind: "multiline", matrix: [[1, 2]] }, ctx())).rejects.toThrow("ít nhất 2 dòng")
  await expect(tool.execute({ kind: "multiline", matrix: [[1, 2], [1]] }, ctx())).rejects.toThrow("ít nhất 2 điểm")
  expect(out).not.toContain(ESC)
})

test("chart_render stacked: shades per component, totals and legend", async () => {
  const tool = chartRenderTool()
  const out = await text({ kind: "stacked", matrix: matrix3, labels: ["VCB", "HPG", "VNM", "Lãi", "Dịch vụ", "Khác"] })
  const lines = out.split("\n")
  expect(lines[0]!).toContain("3 nhóm x 3 thành phần")
  expect(lines[1]!).toMatch(/^VCB\s+[█▓▒]+ 58$/)
  expect(lines[3]!).toContain("VNM")
  expect(lines[4]!).toContain("█ Lãi  ▓ Dịch vụ  ▒ Khác")
  await expect(tool.execute({ kind: "stacked", matrix: [[5], [4]] }, ctx())).rejects.toThrow("ít nhất 2 thành phần")
  await expect(tool.execute({ kind: "stacked", matrix: [[5, 3], [4]] }, ctx())).rejects.toThrow("cùng số cột")
  expect(out).not.toContain(ESC)
})

test("chart_render boxplot: whiskers, box, median and min/Q1/median/Q3/max values", async () => {
  const tool = chartRenderTool()
  const out = await text({ kind: "boxplot", matrix: [[56.8, 57.2, 57.4, 58.1, 58.9], [19.8, 20.1, 20.4, 20.8, 21.2]], labels: ["VCB", "HPG"] })
  const lines = out.split("\n")
  expect(lines[0]!).toContain("2 nhóm")
  expect(lines[1]!).toMatch(/^VCB\s+\[.+\] 56.8 ─ 57.2 ─ 57.4 ─ 58.1 ─ 58.9$/)
  expect(lines[1]!).toContain("◆")
  expect(lines[2]!).toContain("HPG")
  await expect(tool.execute({ kind: "boxplot", matrix: [[1, 2, 3]] }, ctx())).rejects.toThrow("ít nhất 4 điểm")
  expect(out).not.toContain(ESC)
})

test("chart_render scatter sparkcolumn linebox from the library", async () => {
  const tool = chartRenderTool()
  const scatter = await text({ kind: "scatter", points: [{ x: 1, y: 20 }, { x: 2, y: 21 }, { x: 3, y: 19.5 }, { x: 4, y: 22 }] })
  expect(scatter).toContain("4 điểm")
  expect(scatter).toContain("┤")
  const column = await text({ kind: "sparkcolumn", series: [1, 2, 3, 2, 4] })
  expect(column).toContain("▃")
  const linebox = await text({ kind: "linebox", series: [57.3, 58.1, 57.4, 58.4] })
  expect(linebox).toContain("╭")
  await expect(tool.execute({ kind: "scatter", points: [{ x: 1, y: 2 }] }, ctx())).rejects.toThrow("ít nhất 3 điểm")
  await expect(tool.execute({ kind: "sparkcolumn", series: [1] }, ctx())).rejects.toThrow("ít nhất 2 điểm")
  expect(scatter).not.toContain(ESC)
  expect(linebox).not.toContain(ESC)
})

test("chart tools passthrough dữ liệu mới: volume nến, groups scatter, domain compare", async () => {
  const tool = chartRenderTool()
  const candle = (await tool.execute(
    { kind: "candlestick", bars: bars.map((b, i) => ({ ...b, v: (i + 1) * 1e6 })), symbol: "VCB", times: ["T1", "T2", "T3", "T4", "T5"] },
    ctx(),
  )) as ToolResult
  expect(candle.chart).toMatchObject({ kind: "candlestick", times: ["T1", "T2", "T3", "T4", "T5"] })
  expect((candle.chart as { bars: { v?: number }[] }).bars[0]!.v).toBe(1e6)
  const line = (await tool.execute({ kind: "line", series: [1, 2, 3], times: ["a", "b", "c"] }, ctx())) as ToolResult
  expect(line.chart).toMatchObject({ kind: "line", times: ["a", "b", "c"] })
  const scatter = (await tool.execute(
    { kind: "scatter", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], groups: [0, 0, 1], labels: ["A", "B"] },
    ctx(),
  )) as ToolResult
  expect(scatter.chart).toMatchObject({ kind: "scatter", groups: [0, 0, 1], labels: ["A", "B"] })
  const compare = (await chartCompareTool().execute(
    { title: "T", series: [{ label: "A", values: [50, 55] }, { label: "B", values: [20, 19] }], ymin: -15, ymax: 15, times: ["T1", "T2"] },
    ctx(),
  )) as ToolResult
  expect(compare.chart).toMatchObject({ kind: "compare", domain: [-15, 15], times: ["T1", "T2"] })
})
