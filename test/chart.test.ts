import { expect, test } from "bun:test"
import { chartDepthTool, chartRenderTool } from "../src/core/tools/chart/render"
import { chartCompareTool } from "../src/core/tools/chart/compare"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })

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
  const out = await tool.execute({ kind: "candlestick", bars, symbol: "VCB" }, ctx())
  expect(typeof out === "string" ? out : out.output).toContain("VCB")
})

test("chart_render line and sparkline", async () => {
  const tool = chartRenderTool()
  const line = await tool.execute({ kind: "line", series: [1, 2, 1.5, 3] }, ctx())
  expect(typeof line === "string" ? line : line.output).toContain("line")
  const spark = await tool.execute({ kind: "sparkline", series: [1, 2, 3] }, ctx())
  expect(typeof spark === "string" ? spark : spark.output).toBeTruthy()
  await expect(tool.execute({ kind: "line", series: [1] }, ctx())).rejects.toThrow("ít nhất 2 điểm")
})

test("chart_depth renders ladder and rejects empty book", async () => {
  const tool = chartDepthTool()
  const out = await tool.execute(
    { symbol: "VCB", bids: [{ price: 57.3, volume: 100 }], asks: [{ price: 57.4, volume: 50 }] },
    ctx(),
  )
  const text = typeof out === "string" ? out : out.output
  expect(text).toContain("BID")
  expect(text).toContain("ASK")
  await expect(tool.execute({ bids: [], asks: [] }, ctx())).rejects.toThrow("rỗng")
})

test("chart_render bar with per-column colors", async () => {
  const tool = chartRenderTool()
  const out = (await tool.execute(
    { kind: "bar", symbol: "Ngành", series: [1.12, -0.8, -1.33], labels: ["Vật liệu", "Tài chính", "BĐS"] },
    ctx(),
  )) as string
  expect(out).toContain("Vật liệu")
  expect(out).toContain("\u001b[32m")
  expect(out).toContain("\u001b[31m")
  const plain = (await tool.execute(
    { kind: "bar", series: [1, 2], color: "never" },
    ctx(),
  )) as string
  expect(plain).not.toContain("\u001b[")
})

test("chart_render gauge donut histogram heatmap winloss", async () => {
  const tool = chartRenderTool()
  expect(((await tool.execute({ kind: "gauge", value: 72, max: 100, unit: "%" }, ctx())) as string)).toContain("72%")
  expect(((await tool.execute({ kind: "donut", value: 35, max: 100 }, ctx())) as string)).toContain("35%")
  await expect(tool.execute({ kind: "gauge", value: 1 }, ctx())).rejects.toThrow("cần value + max")
  const hist = (await tool.execute({ kind: "histogram", series: [1, 2, 2, 3, 3, 3, 4, 5] }, ctx())) as string
  expect(hist).toContain("phân phối")
  const heat = (await tool.execute(
    { kind: "heatmap", matrix: [[1, 0.5], [0.5, 1]], labels: ["VCB", "HPG", "VCB", "HPG"] },
    ctx(),
  )) as string
  expect(heat).toContain("heatmap (2x2)")
  await expect(tool.execute({ kind: "heatmap", matrix: [] }, ctx())).rejects.toThrow("matrix 2D")
  const wl = (await tool.execute({ kind: "winloss", series: [1, -1, 1] }, ctx())) as string
  expect(wl).toContain("thắng/thua")
})

test("chart_compare overlays series with legend", async () => {
  const tool = chartCompareTool()
  const out = (await tool.execute(
    { title: "VCB vs HPG", series: [{ label: "VCB", values: [57.4, 58.1, 57.7] }, { label: "HPG", values: [19.9, 20.1, 19.95, 20.3] }] },
    ctx(),
  )) as string
  expect(out).toContain("VCB")
  expect(out).toContain("HPG")
  await expect(
    tool.execute({ series: [{ label: "A", values: [1, 2] }] }, ctx()),
  ).rejects.toThrow()
})
