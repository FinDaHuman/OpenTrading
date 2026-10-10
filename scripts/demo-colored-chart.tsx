import { render, useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { ChartData } from "../src/core/tools/chart/data"
import type { ToolResult } from "../src/core/tools/types"
import { chartRenderTool, type ChartRenderInput } from "../src/core/tools/chart/render"
import { color } from "../src/tui/theme"
import { ChartBox } from "../src/tui/ui/chart-box"

/**
 * Toàn bộ biểu đồ vẽ được, xem MÀU trực tiếp trong terminal (component ChartBox thật).
 * Cách chạy: bun scripts/demo-colored-chart.tsx
 * Tất cả vẽ bằng thư viện TUI thuần (@crafter/charts + renderer nội bộ), không python.
 * Quy ước: trục X mọi chart dài bằng nhau (cùng plotW) để so sánh khớp nhau.
 * Pager: ←/→ hoặc space chuyển chart, q thoát.
 */
const ctx = () => ({ signal: new AbortController().signal, callId: "demo" })
const renderTool = chartRenderTool()
const chartOf = async (input: ChartRenderInput) => ((await renderTool.execute(input, ctx())) as ToolResult).chart!

const closes = [60.1, 59.3, 61.5, 62.7, 63.9, 63.2, 62.1, 61.4, 60.8, 59.9, 60.6, 61.8, 62.4, 61.9, 62.8]
const hpg = [20.1, 19.8, 20.5, 21.2, 20.9, 21.5, 22.0, 21.8, 21.2, 20.9, 21.4, 22.1, 21.9, 22.3, 22.05]
const dates = ["09-01", "09-02", "09-03", "09-04", "09-05", "09-08", "09-09", "09-10", "09-11", "09-12", "09-15", "09-16", "09-17", "09-18", "09-19"]
const bars = closes.map((c, i) => ({
  o: c - 0.3,
  h: c + 0.6,
  l: c - 0.7,
  c: c + (i % 3 === 0 ? -0.4 : 0.3),
  v: [8.2, 18.9, 24.2, 12.5, 9.1, 15.7, 21.3, 11.8, 7.4, 13.9, 19.5, 23.1, 16.4, 10.2, 14.8][i]! * 1e6,
}))
const volumes = [8.2, 18.9, 24.2, 12.5, 9.1, 15.7, 21.3, 11.8, 7.4, 13.9, 19.5, 23.1, 16.4, 10.2, 14.8]
// Volume mỗi phiên + hướng giá so phiên trước (volume luôn dương, màu theo hướng).
const volDirs = bars.map((b, i) => (i === 0 ? true : b.c >= bars[i - 1]!.c))
// Chỉ số dao động (multiline KHÔNG vẽ giá): RSI 14 + Stochastic %K.
const rsi = [41, 45, 52, 58, 63, 61, 55, 49, 44, 47, 53, 59, 66, 62, 57]
const stoch = [28, 35, 48, 60, 72, 68, 55, 42, 36, 44, 58, 70, 78, 71, 64]
// Lợi suất % ngày (boxplot cùng magnitude để so được).
const retVcb = [0.8, -0.5, 1.2, -1.1, 0.4, 0.9, -0.7, 1.5, -0.3, 0.6, 1.1, -0.9, 0.2, 0.7, -0.4]
const retHpg = [-0.4, 0.6, -1.3, 0.2, 0.8, -0.6, 1.1, -0.8, 0.3, -0.5, 0.9, -1.1, 0.4, -0.2, 0.7]

const charts: { note: string; data: ChartData }[] = [
  { note: "nến + VOLUME dưới (màu theo hướng nến) + trục X ngày", data: await chartOf({ kind: "candlestick", symbol: "VCB", bars, times: dates, unit: "kVND" }) },
  { note: "line braille mượt + trục X", data: await chartOf({ kind: "line", symbol: "VCB", series: closes, times: dates, unit: "kVND" }) },
  {
    note: "multiline CHỈ SỐ (RSI+Stoch, KHÔNG phải giá) + trục X",
    data: await chartOf({ kind: "multiline", symbol: "VCB chỉ số", matrix: [rsi, stoch], labels: ["RSI 14", "Stoch %K"], times: dates, unit: "điểm" }),
  },
  {
    note: "scatter 2 NHÓM: VCB (giá cao, vol lớn) tách HPG (giá thấp) — legend đếm điểm",
    data: await chartOf({
      kind: "scatter",
      symbol: "Khối lượng vs giá",
      points: closes.map((c, i) => ({ x: (10 + i * 2) * 1e6, y: c })).concat(hpg.map((c, i) => ({ x: (4 + i * 1.5) * 1e6, y: c }))),
      groups: [...Array(closes.length).fill(0), ...Array(hpg.length).fill(1)],
      labels: ["VCB", "HPG"],
    }),
  },
  {
    note: "area: đường bo góc + fill đủ dưới đường + trục X",
    data: await chartOf({ kind: "area", symbol: "VCB", series: closes, times: dates, unit: "kVND" }),
  },
  {
    note: "bar diverging: ÂM trái / DƯƠNG phải (vạch 0 giữa, có viền)",
    data: await chartOf({
      kind: "bar",
      symbol: "Ngành",
      series: [25, -8, 18, 12, -5, 22],
      labels: ["Ngân hàng", "BĐS", "Vật liệu", "Bán lẻ", "Dầu khí", "Chứng khoán"],
      unit: "%",
    }),
  },
  {
    note: "pie THANH TỶ LỆ 100%: mỗi lát 1 segment + legend",
    data: await chartOf({
      kind: "pie",
      symbol: "VCB cổ đông",
      series: [74.8, 15.0, 6.2, 2.5, 1.5],
      labels: ["NHNN", "Mizuho", "Quỹ CP", "T.Rowe", "VHolding"],
      unit: "%",
    }),
  },
  {
    note: "waterfall: dòng tiền cộng dồn, giãn dòng",
    data: await chartOf({ kind: "waterfall", symbol: "VCB", start: 0, series: [-910, 3150, -3298, -283, -2519], labels: ["P1", "P2", "P3", "P4", "P5"], unit: "tỷ" }),
  },
  {
    note: "stacked: mỗi thành phần 1 màu (mua/bán theo phiên)",
    data: await chartOf({
      kind: "stacked",
      symbol: "VCB",
      matrix: [[1890, 2171], [1620, 1325], [3100, 3520], [2900, 3058]],
      labels: ["P1", "P2", "P3", "P4", "Mua", "Bán"],
      unit: "tỷ",
    }),
  },
  {
    note: "boxplot CHUẨN (râu+mũ, box Q1-Q3, median ┃) trên lợi suất %",
    data: await chartOf({ kind: "boxplot", symbol: "lợi suất % ngày", matrix: [retVcb, retHpg], labels: ["VCB%", "HPG%"], unit: "%" }),
  },
  {
    note: "heatmap: nền gradient xanh (thấp) → đỏ (cao)",
    data: await chartOf({
      kind: "heatmap",
      symbol: "tương quan",
      matrix: [[1, 0.62, 0.41], [0.62, 1, 0.55], [0.41, 0.55, 1]],
      labels: ["VCB", "HPG", "VNM", "VCB", "HPG", "VNM"],
    }),
  },
  { note: "gauge: đỏ <30, vàng <70, xanh ≥70", data: await chartOf({ kind: "gauge", symbol: "Fear & Greed", value: 73, max: 100, unit: "%" }) },
  { note: "donut THANH TỶ LỆ (giống pie): phần đạt xanh + còn lại xám", data: await chartOf({ kind: "donut", symbol: "Tỷ trọng", value: 35, max: 100, unit: "%" }) },
  { note: "winloss: từng phiên thắng/thua + cột số %", data: await chartOf({ kind: "winloss", symbol: "VCB", series: [4.5, -2.4, 1.2, 3.1, -0.8, 2.2], unit: "%" }) },
  {
    note: "histogram: bins tự động (có viền)",
    data: await chartOf({ kind: "histogram", symbol: "CAR", series: [1, 2, 2, 3, 3, 3, 4, 5, 2, 3, 4, 1, 5, 3, 2], unit: "%" }),
  },
  { note: "sparkline: đường mini + trục X", data: await chartOf({ kind: "sparkline", symbol: "VCB", series: closes, times: dates, unit: "kVND" }) },
  { note: "sparkcolumn: volume VCB, xanh/đỏ theo hướng giá", data: { kind: "sparkcolumn", symbol: "Vol VCB", series: volumes, dirs: volDirs, unit: "triệu cp" } },
  {
    note: "compare: trục y riêng từng mã + trục X + giãn dòng",
    data: { kind: "compare", title: "VCB vs HPG", series: [{ label: "VCB", values: closes }, { label: "HPG", values: hpg }], domain: [-15, 15], times: dates, unit: "%" },
  },
  {
    note: "depth: ASK đỏ / BID xanh (có viền)",
    data: {
      kind: "depth",
      symbol: "VCB",
      bids: [{ price: 57.3, volume: 1200 }, { price: 57.2, volume: 800 }, { price: 57.1, volume: 1500 }],
      asks: [{ price: 57.4, volume: 900 }, { price: 57.5, volume: 2000 }, { price: 57.6, volume: 600 }],
      depth: 3,
      unit: "kVND",
    },
  },
]

function Demo() {
  const width = process.stdout.columns ?? 80
  const [idx, setIdx] = createSignal(0)
  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "q" || evt.name === "escape") process.exit(0)
    if (evt.name === "right" || evt.name === "space" || evt.name === "enter" || evt.name === "n" || evt.name === "down") {
      setIdx((i) => Math.min(charts.length - 1, i + 1))
    }
    if (evt.name === "left" || evt.name === "p" || evt.name === "up") {
      setIdx((i) => Math.max(0, i - 1))
    }
    if (evt.name === "home") setIdx(0)
    if (evt.name === "end") setIdx(charts.length - 1)
  })
  const current = () => charts[idx()]!
  return (
    <box flexDirection="column" padding={1} backgroundColor={color.bg}>
      <text fg={color.tx}>{`Demo chart màu ${idx() + 1}/${charts.length} — ←/→ hoặc space chuyển, q thoát`}</text>
      <text fg={color.tx3}>{`— ${current().note}`}</text>
      <ChartBox data={current().data} width={width - 4} />
    </box>
  )
}

await render(() => <Demo />, { exitOnCtrlC: true, targetFps: 5, backgroundColor: color.bg })
