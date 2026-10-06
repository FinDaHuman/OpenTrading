import { expect, test } from "bun:test"
import { chartCompareTool } from "../src/core/tools/chart/compare"
import { chartDepthTool, chartRenderTool, type ChartRenderInput } from "../src/core/tools/chart/render"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
const ESC = String.fromCharCode(27)

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
  expect((await tool.execute({ kind: "candlestick", bars, symbol: "VCB" }, ctx())) as string).toContain("VCB")
})

test("chart_render line and sparkline", async () => {
  const tool = chartRenderTool()
  expect((await tool.execute({ kind: "line", series: [1, 2, 1.5, 3] }, ctx())) as string).toContain("line")
  expect((await tool.execute({ kind: "sparkline", series: [1, 2, 3] }, ctx())) as string).toBeTruthy()
  await expect(tool.execute({ kind: "line", series: [1] }, ctx())).rejects.toThrow("ít nhất 2 điểm")
})

test("chart_depth renders ladder and rejects empty book", async () => {
  const tool = chartDepthTool()
  const text = (await tool.execute({ symbol: "VCB", bids: [{ price: 57.3, volume: 100 }], asks: [{ price: 57.4, volume: 50 }] }, ctx())) as string
  expect(text).toContain("BID")
  expect(text).toContain("ASK")
  await expect(tool.execute({ bids: [], asks: [] }, ctx())).rejects.toThrow("rỗng")
})

test("chart output is plain text: no ANSI codes reach the model or the transcript", async () => {
  const tool = chartRenderTool()
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
  for (const input of inputs) expect((await tool.execute(input, ctx())) as string).not.toContain(ESC)
  const bar = (await tool.execute({ kind: "bar", series, labels: ["Vật liệu"] }, ctx())) as string
  expect(bar).toContain("Vật liệu")
  expect(bar).toContain("█ dương, ░ âm")
})

test("chart_render gauge donut histogram heatmap winloss", async () => {
  const tool = chartRenderTool()
  expect((await tool.execute({ kind: "gauge", value: 72, max: 100, unit: "%" }, ctx())) as string).toContain("72%")
  expect((await tool.execute({ kind: "donut", value: 35, max: 100 }, ctx())) as string).toContain("35%")
  await expect(tool.execute({ kind: "gauge", value: 1 }, ctx())).rejects.toThrow("cần value + max")
  expect((await tool.execute({ kind: "histogram", series: [1, 2, 2, 3, 3, 3, 4, 5] }, ctx())) as string).toContain("phân phối")
  const heat = (await tool.execute({ kind: "heatmap", matrix: [[1, 0.5], [0.5, 1]], labels: ["VCB", "HPG", "VCB", "HPG"] }, ctx())) as string
  expect(heat).toContain("heatmap (2x2)")
  await expect(tool.execute({ kind: "heatmap", matrix: [] }, ctx())).rejects.toThrow("matrix 2D")
  expect((await tool.execute({ kind: "winloss", series: [1, -1, 1] }, ctx())) as string).toContain("▲▼▲")
})

test("chart_compare puts each series on its own row, on one shared % scale", async () => {
  const tool = chartCompareTool()
  const out = (await tool.execute(
    { title: "VCB vs HPG", series: [{ label: "VCB", values: [50, 55] }, { label: "HPG", values: [20, 19, 18] }] },
    ctx(),
  )) as string
  const lines = out.split("\n")
  expect(lines[0]).toBe("VCB vs HPG · % thay đổi từ điểm đầu, cùng thang -10.0% … +10.0%:")
  expect(lines[1]).toMatch(/^VCB .+ \+10\.0%$/)
  expect(lines[2]).toMatch(/^HPG .+ -10\.0%$/)
  // The shorter series is right-aligned, so the last points line up.
  expect(lines[1]!.lastIndexOf(" ")).toBe(lines[2]!.lastIndexOf(" "))
  expect(out).not.toContain(ESC)
  await expect(tool.execute({ series: [{ label: "A", values: [0, 1] }, { label: "B", values: [1, 2] }] }, ctx())).rejects.toThrow("bắt đầu bằng 0")
})
