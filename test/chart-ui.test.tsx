import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { chartCompareTool } from "../src/core/tools/chart/compare"
import { chartRenderTool } from "../src/core/tools/chart/render"
import { setState } from "../src/tui/state"
import { color } from "../src/tui/theme"
import type { ToolResult } from "../src/core/tools/types"
import type { ChartData } from "../src/core/tools/chart/data"
import { AXIS_COL, buildChart } from "../src/tui/ui/chart-box"
import { Transcript } from "../src/tui/transcript"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
const closes = [57.3, 58.1, 58.0, 57.4, 57.7, 58.4, 59.0, 58.6, 59.4, 60.1]
const bars = closes.map((c, i) => ({ o: c - 0.3, h: c + 0.5, l: c - 0.6, c: c + (i % 2 ? -0.2 : 0.2) }))

let setup: Awaited<ReturnType<typeof testRender>> | undefined

// The TUI store is a module singleton shared by every test file: leave it empty.
afterAll(() => {
  setup?.renderer.destroy()
  setState("lines", [])
  setState("expandTools", false)
})

async function frameWith(text: string) {
  let frame = ""
  for (let i = 0; i < 50 && !frame.includes(text); i++) {
    await new Promise((r) => setTimeout(r, 100))
    await setup!.renderOnce()
    frame = setup!.captureCharFrame()
  }
  if (process.env.SHOW_FRAME) console.log(frame)
  return frame
}

test("the tool row shows a one-line summary and the coloured chart is drawn once, no ASCII art", async () => {
  const res = (await chartRenderTool().execute({ kind: "candlestick", bars, symbol: "VCB" }, ctx())) as ToolResult
  setState("expandTools", true)
  setState("lines", [
    { kind: "user", text: "vẽ nến VCB" },
    { kind: "tool", callId: "c1", name: "chart_render", label: "chart_render candlestick VCB", status: "ok", output: res.output },
    { kind: "chart", data: res.chart! },
    { kind: "assistant", text: "Xu hướng tăng nhẹ.", done: true },
  ])
  setup = await testRender(() => <Transcript />, { width: 100, height: 60 })
  const frame = await frameWith("Xu hướng tăng nhẹ.")
  expect(frame).not.toContain(String.fromCharCode(27))
  expect(frame).toContain("Đã vẽ nến VCB")
  // The model's text never carries the picture, so the transcript shows it once (the chart line).
  expect(frame.split("Đã vẽ nến VCB").length - 1).toBe(1)
  expect(frame).toContain("Xu hướng tăng nhẹ.")
})

test("a chart line paints up candles green and down candles red", async () => {
  const mixed = [
    { o: 57.3, h: 58.5, l: 57.2, c: 58.1 }, // lên
    { o: 58.1, h: 58.9, l: 57.5, c: 57.6 }, // xuống
    { o: 57.6, h: 58.4, l: 57.0, c: 58.2 }, // lên
    { o: 58.2, h: 58.6, l: 57.4, c: 57.5 }, // xuống
    { o: 57.5, h: 58.8, l: 57.3, c: 58.6 }, // lên
  ]
  const res = (await chartRenderTool().execute({ kind: "candlestick", bars: mixed, symbol: "VCB" }, ctx())) as ToolResult
  setup?.renderer.destroy()
  setState("lines", [{ kind: "chart", data: res.chart! }])
  setup = await testRender(() => <Transcript />, { width: 100, height: 40 })
  const frame = await frameWith("VCB")
  expect(frame).toContain("█")
  expect(frame).toContain("│")
  // Colours the model never sees: theme green for up candles, red for down ones.
  const spans = setup!.captureSpans().lines.flatMap((l) => l.spans)
  const up = RGBA.fromHex(color.tang)
  const down = RGBA.fromHex(color.giam)
  expect(spans.some((s) => s.text.includes("█") && s.fg.equals(up))).toBe(true)
  expect(spans.some((s) => s.text.includes("█") && s.fg.equals(down))).toBe(true)
})

test("a multiline chart paints each series in its own colour", async () => {
  const res = (await chartRenderTool().execute(
    {
      kind: "multiline",
      matrix: [
        [57.3, 58.1, 58.0, 57.4, 57.7, 58.4, 59.0, 58.6, 59.4, 60.1],
        [20.1, 19.8, 20.5, 21.2, 20.9, 21.5, 22.0, 21.8, 21.2, 20.9],
      ],
      labels: ["VCB", "HPG"],
    },
    ctx(),
  )) as ToolResult
  setup?.renderer.destroy()
  setState("lines", [{ kind: "chart", data: res.chart! }])
  setup = await testRender(() => <Transcript />, { width: 100, height: 40 })
  const frame = await frameWith("multiline")
  expect(frame).toContain("VCB")
  expect(frame).toContain("HPG")
  // Braille plot cells (U+2800 block) carry one theme colour per series.
  // Same-colour runs merge into one span, so expect the two series colours, not a count.
  const isBraille = (t: string) => [...t].some((ch) => ch >= "⠀" && ch <= "⣿")
  const plot = setup!.captureSpans().lines.flatMap((l) => l.spans).filter((s) => isBraille(s.text))
  expect(plot.length).toBeGreaterThanOrEqual(2)
  const fgs = new Set(plot.map((s) => `${s.fg.r.toFixed(2)},${s.fg.g.toFixed(2)},${s.fg.b.toFixed(2)}`))
  const key = (c: RGBA) => `${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}`
  // Categorical colours, not the up/down pair (two tickers in green/red read as up vs down).
  expect(fgs.has(key(RGBA.fromHex(color.san)))).toBe(true)
  expect(fgs.has(key(RGBA.fromHex(color.tham)))).toBe(true)
  expect(fgs.has(key(RGBA.fromHex(color.giam)))).toBe(false)
})

const text = (data: ChartData, width = 80) => buildChart(data, width).grid.map((row) => row.map((c) => c.ch).join("")).join("\n")

test("trục X mọi chart thẳng hàng: marker ┤/│ cùng cột, plot cùng rộng", () => {
  const grids = [
    buildChart({ kind: "candlestick", bars, times: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"] }, 80).grid,
    buildChart({ kind: "line", series: closes, times: ["T1", "T2"] }, 80).grid,
    buildChart({ kind: "multiline", matrix: [closes, closes.map((v) => 80 - v)], labels: ["VCB", "HPG"] }, 80).grid,
  ]
  for (const grid of grids) {
    const axisRow = grid.find((row) => row.map((c) => c.ch).join("").includes("┤"))!
    expect(axisRow.map((c) => c.ch).join("").indexOf("┤")).toBe(AXIS_COL)
  }
  // Hàng X cuối cùng canh đều: ngày đầu trái, ngày cuối phải.
  const candleX = grids[0]![grids[0]!.length - 1]!.map((c) => c.ch).join("")
  expect(candleX).toContain("T1")
  expect(candleX.trimEnd().endsWith("T10")).toBe(true)
})

test("nến có volume thì vẽ pane volume màu hướng nến, không thì thôi", () => {
  const withVol = buildChart({ kind: "candlestick", bars: bars.map((b, i) => ({ ...b, v: (i + 1) * 1e6 })), symbol: "VCB" }, 80)
  const without = buildChart({ kind: "candlestick", bars, symbol: "VCB" }, 80)
  expect(withVol.grid.length).toBeGreaterThan(without.grid.length)
  expect(withVol.title.map((t) => t.text).join("")).toContain("Vol")
})

test("bar diverging: âm trái, dương phải, vạch 0 giữa", () => {
  const out = text({ kind: "bar", series: [25, -8, 18], labels: ["NH", "BDS", "VL"] })
  const neg = out.split("\n").find((l) => l.includes("BDS"))!
  expect(neg).toMatch(/█+│/) // bar đỏ nằm trái vạch 0
  const pos = out.split("\n").find((l) => l.includes("NH"))!
  expect(pos).toMatch(/│█+/) // bar xanh nằm phải vạch 0
})

test("scatter phân nhóm: legend 2 màu + trục X theo x", () => {
  const built = buildChart(
    { kind: "scatter", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 10, y: 9 }], groups: [0, 0, 1], labels: ["A", "B"] },
    80,
  )
  const s = built.grid.map((row) => row.map((c) => c.ch).join("")).join("\n")
  expect(s).toContain("● A (2 điểm)")
  expect(s).toContain("● B (1 điểm)")
  expect(s).toMatch(/1.*10/)
})

test("area fill đủ: không còn lỗ hổng dưới đường", () => {
  const built = buildChart({ kind: "area", series: [60.1, 59.3, 61.5, 62.7, 63.9, 63.2, 62.1] }, 80)
  const filled = built.grid.flat().filter((c) => c.bg !== undefined).length
  expect(filled).toBeGreaterThan(50)
})

test("pie thanh tỷ lệ + donut thanh + boxplot mũ râu + histogram viền", () => {
  const pie = text({ kind: "pie", series: [70, 20, 10], labels: ["A", "B", "C"] })
  expect(pie).toContain("█") // thanh segment theo %
  expect(pie).toContain("70.0%")
  expect(pie).toContain("█ A")
  const lines = pie.split("\n")
  expect(lines[1]).toBe("") // dòng trống ngăn thanh với legend
  const donut = text({ kind: "donut", symbol: "T", value: 35, max: 100 })
  expect(donut.indexOf("T 35.0%")).toBeLessThan(donut.indexOf("còn lại")) // phần đạt trước
  const wl = text({ kind: "winloss", series: [4.5, -2.4] })
  expect(wl).toContain("+4.5")
  expect(wl).toContain("-2.4")
  const box = text({ kind: "boxplot", matrix: [[1, 2, 3, 4, 5]], labels: ["G"] })
  expect(box.match(/│/g)!.length).toBeGreaterThanOrEqual(2) // mũ râu 2 đầu
  expect(box).toContain("┃") // median xuyên box
  expect(box).toContain("median (trung vị)") // legend
  expect(box).toContain("█") // box Q1–Q3
  const hist = text({ kind: "histogram", series: [1, 2, 2, 3] })
  expect(hist).toContain("┌")
})

test("compare nhận domain tùy biến + trục X", () => {
  const built = buildChart(
    { kind: "compare", title: "T", series: [{ label: "A", values: [50, 55] }, { label: "B", values: [20, 19] }], domain: [-15, 15], times: ["T1", "T2"] },
    80,
  )
  expect(built.title.map((t) => t.text).join("")).toContain("thang -15.0 … 15.0%")
  const s = built.grid.map((row) => row.map((c) => c.ch).join("")).join("\n")
  expect(s).toContain("T1")
})

test("date quá dài quay dọc dưới cột nến", () => {
  const bars5 = [60.1, 59.3, 61.5, 62.7, 63.9].map((c, i) => ({ o: c - 0.3, h: c + 0.6, l: c - 0.7, c }))
  const built = buildChart(
    { kind: "candlestick", bars: bars5, times: ["2025-09-01", "2025-09-08", "2025-09-15", "2025-09-22", "2025-09-29"] },
    80,
  )
  const rows = built.grid.map((row) => row.map((c) => c.ch).join(""))
  // Đọc dọc: cột 0 của nhãn đầu ghép thành "2025-09-01".
  const firstCol = rows.slice(-10).map((r) => r[8]).join("")
  expect(firstCol).toBe("2025-09-01")
  const lastCol = rows.slice(-10).map((r) => r[16]).join("")
  expect(lastCol).toBe("2025-09-29")
})

test("bar chung gốc 0: │ cùng cột mọi dòng, số âm sát thanh", () => {
  const out = text({ kind: "bar", series: [25, -8, 18, -22], labels: ["NH", "BDS", "VL", "DK"] })
  const rows = out.split("\n").filter((l) => l.includes("│"))
  // Vạch 0 ở cùng cột cho mọi dòng (tính từ đầu dòng).
  const zeros = new Set(rows.map((l) => l.indexOf("│", l.indexOf("│") + 1)))
  expect(zeros.size).toBe(1)
  expect(out).toMatch(/-8 █████/) // số ngay sát thanh đỏ
  expect(out).toMatch(/███████████████ 25/) // số ngay sát thanh xanh
})

test("bar có viền ngăn từng thanh + nhãn dài wrap đều", () => {
  const built = buildChart({ kind: "bar", symbol: "Ng", series: [25, -8], labels: ["Ngân Hàng Nhà Nước Việt Nam", "BDS"] }, 80)
  const s = built.grid.map((row) => row.map((c) => c.ch).join("")).join("\n")
  expect(s).toContain("┌")
  expect(s).toContain("├") // vạch ngăn giữa các thanh
  expect(s).toContain("┤")
  // Nhãn dài wrap 2 dòng, khối ngắn nâng bằng khối dài.
  expect(s).toContain("Ngân Hàng Nhà")
  // Gốc 0 (│ nội dung, bỏ │ viền frame 2 đầu) cùng cột mọi khối.
  const inner = built.grid.map((row) => row.map((c) => c.ch).join("").slice(1, -1))
  const zeroCols = new Set(inner.filter((l) => l.includes("│")).map((l) => l.indexOf("│")))
  expect(zeroCols.size).toBe(1)
})

test("histogram có viền + vạch ngăn", () => {
  const s = text({ kind: "histogram", series: [1, 2, 2, 3] })
  expect(s).toContain("┌")
  expect(s).toContain("├")
})

test("trục X có đường ngang + chấm từng điểm", () => {
  const b = buildChart({ kind: "line", series: [1, 2, 3, 2, 4], times: ["T1", "T2", "T3", "T4", "T5"] }, 80)
  const s = b.grid.map((row) => row.map((c) => c.ch).join("")).join("\n")
  const axisRow = s.split("\n").find((l) => l.includes("└"))!
  expect(axisRow).toContain("─")
  expect((axisRow.match(/●/g) ?? []).length).toBe(5) // 1 chấm mỗi điểm
  expect(s).toContain("T1")
  expect(s).toContain("T5")
})

test("unit hiện ở tiêu đề mọi chart", () => {
  const line = buildChart({ kind: "line", symbol: "VCB", series: [1, 2, 3], unit: "kVND" }, 80)
  expect(line.title.map((t) => t.text).join("")).toContain("[kVND]")
  const bar = buildChart({ kind: "bar", series: [1, -2], unit: "%" }, 80)
  expect(bar.title.map((t) => t.text).join("")).toContain("[%]")
  const cmp = buildChart({ kind: "compare", series: [{ label: "A", values: [1, 2] }, { label: "B", values: [2, 1] }], unit: "%" }, 80)
  expect(cmp.title.map((t) => t.text).join("")).toContain("[%]")
  // gauge/donut đã nhúng unit trong số — không lặp.
  const gauge = buildChart({ kind: "gauge", value: 73, max: 100, unit: "%" }, 80)
  expect(gauge.title.map((t) => t.text).join("")).not.toContain("[%]")
})

test("compare giữ trục Y riêng từng series", () => {
  const b = buildChart({ kind: "compare", title: "T", series: [{ label: "VCB", values: [50, 55, 53] }, { label: "HPG", values: [20, 19, 18] }] }, 80)
  const s = b.grid.map((row) => row.map((c) => c.ch).join("")).join("\n")
  expect(s).toContain("● VCB")
  expect(s).toContain("● HPG")
  expect((s.match(/┤/g) ?? []).length).toBeGreaterThanOrEqual(2) // mỗi chart có ┤ riêng
})
