import { z } from "zod"
import { LOCAL_SOURCE, type ToolDef } from "../types"

/**
 * Chart output is plain text. The model reads it and may copy it into its answer, which
 * the TUI renders as markdown; ANSI colour codes would show up there as garbage and
 * roughly double the tokens. Some library marks (gauge, donut) colour unconditionally,
 * so every result is stripped.
 */
export const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")

/** Widths above this wrap in the transcript's tool output. */
export const MAX_CHART_WIDTH = 120

const BarSchema = z.object({ o: z.number(), h: z.number(), l: z.number(), c: z.number() })

const KINDS = ["candlestick", "line", "sparkline", "bar", "histogram", "heatmap", "gauge", "donut", "area", "winloss"] as const

export type ChartRenderInput = {
  kind: (typeof KINDS)[number]
  symbol?: string
  bars?: { o: number; h: number; l: number; c: number }[]
  series?: number[]
  labels?: string[]
  matrix?: number[][]
  value?: number
  max?: number
  unit?: string
  width?: number
  height?: number
}

/** Text charts from data the model already has (MCP results); renders only, never fetches. */
export function chartRenderTool(): ToolDef<ChartRenderInput> {
  return {
    name: "chart_render",
    description:
      "Vẽ biểu đồ dạng text từ dữ liệu đã có. kind: candlestick (bars OHLC ≥5), line/sparkline/area (series), bar (series+labels), histogram (series phân phối), heatmap (matrix), gauge/donut (value+max), winloss (series âm/dương). Dùng sau khi đã gọi tool dữ liệu; không dùng khi chưa có dữ liệu.",
    input: z.object({
      kind: z.enum(KINDS).describe("Loại biểu đồ"),
      symbol: z.string().optional().describe("Mã hoặc tiêu đề, ví dụ VCB"),
      bars: z.array(BarSchema).max(500).optional().describe("Nến OHLC cho kind=candlestick (tối thiểu 5)"),
      series: z.array(z.number()).max(2000).optional().describe("Chuỗi số cho line/sparkline/area/bar/histogram/winloss"),
      labels: z.array(z.string()).max(200).optional().describe("Nhãn cho bar (mỗi cột) và heatmap (nhãn hàng rồi nhãn cột)"),
      matrix: z.array(z.array(z.number()).max(30)).max(30).optional().describe("Ma trận cho kind=heatmap"),
      value: z.number().optional().describe("Giá trị cho kind=gauge/donut"),
      max: z.number().positive().optional().describe("Thang tối đa cho gauge/donut"),
      unit: z.string().max(10).optional().describe("Đơn vị hiển thị, ví dụ %"),
      width: z.number().int().min(20).max(MAX_CHART_WIDTH).optional().describe("Rộng (ký tự, mặc định 64)"),
      height: z.number().int().min(3).max(40).optional().describe("Cao (dòng, mặc định theo kind)"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `chart_render ${input.kind}${input.symbol ? ` ${input.symbol}` : ""}`,
    async execute(input) {
      return stripAnsi(await render(input))
    },
  }
}

async function render(input: ChartRenderInput): Promise<string> {
  const lib = await import("@crafter/charts")
  const title = input.symbol ? `${input.symbol} · ` : ""
  const head = (body: string, subtitle: string) => `${title}${subtitle}:\n${body}`
  const W = (d: number) => Math.min(Math.max(input.width ?? d, 20), MAX_CHART_WIDTH)
  const H = (d: number) => Math.min(Math.max(input.height ?? d, 3), 40)
  const series = input.series ?? []
  const needSeries = (min: number, what: string) => {
    if (series.length < min) throw new Error(`${input.kind} cần series ít nhất ${min} ${what}.`)
  }
  const needValue = (example: string) => {
    if (input.value === undefined || input.max === undefined) throw new Error(`${input.kind} cần value + max (ví dụ ${example}).`)
    return { value: input.value, max: input.max }
  }
  const withUnit = (out: string) => (input.unit && !out.trimEnd().endsWith(input.unit) ? `${out} ${input.unit}` : out)

  switch (input.kind) {
    case "sparkline":
      needSeries(2, "điểm")
      return head(lib.sparkline(series), `sparkline (${series.length} điểm)`)
    case "area":
      needSeries(2, "điểm")
      return head(lib.sparkArea(series, { width: W(64), height: H(10) }), `area (${series.length} điểm)`)
    case "line": {
      needSeries(2, "điểm")
      const rows = series.map((c, t) => ({ t, c }))
      const builder = lib.chart({ width: W(64), height: H(10) }).data(rows, { xKey: "t" }).line({ key: "c" }).yAxis()
      return head(lib.renderToString(builder), `line (${series.length} điểm)`)
    }
    case "candlestick": {
      const bars = input.bars ?? []
      if (bars.length < 5) throw new Error(`candlestick cần ít nhất 5 nến, đang có ${bars.length}.`)
      const rows = bars.map((bar, t) => ({ t, ...bar }))
      const builder = lib
        .chart({ width: W(64), height: H(14) })
        .data(rows, { xKey: "t" })
        .candlestick({ open: "o", high: "h", low: "l", close: "c" })
        .yAxis()
        .xAxis()
      return head(lib.renderToString(builder), `nến (${bars.length} phiên)`)
    }
    case "bar": {
      needSeries(1, "cột")
      const maxAbs = Math.max(1e-9, ...series.map((v) => Math.abs(v)))
      const lines = series.map((v, i) => {
        const bar = (v >= 0 ? "█" : "░").repeat(Math.max(1, Math.round((Math.abs(v) / maxAbs) * 20)))
        return `${(input.labels?.[i] ?? `#${i + 1}`).padEnd(12)} ${bar} ${v}`
      })
      return head(lines.join("\n"), `bar (${series.length} cột; █ dương, ░ âm)`)
    }
    case "histogram":
      needSeries(5, "điểm")
      return head(lib.sparkHistogram(series, { height: H(8) }), `phân phối (${series.length} điểm)`)
    case "heatmap": {
      const matrix = input.matrix ?? []
      if (matrix.length === 0 || !matrix[0]?.length) throw new Error("heatmap cần matrix 2D.")
      const n = matrix[0].length
      const rows = input.labels?.slice(0, matrix.length)
      const cols = input.labels?.slice(matrix.length, matrix.length + n)
      const labels = rows?.length === matrix.length && cols?.length === n ? { labels: { rows, cols } } : {}
      return head(lib.sparkHeatmap(matrix, labels), `heatmap (${matrix.length}x${n})`)
    }
    case "gauge": {
      const { value, max } = needValue("fear & greed 72/100")
      return head(withUnit(lib.sparkGauge(value, max)), "gauge")
    }
    case "donut": {
      const { value, max } = needValue("tỷ trọng 35/100")
      return head(withUnit(lib.sparkDonut(value, max)), "donut")
    }
    case "winloss":
      needSeries(2, "phiên")
      return head(series.map((v) => (v >= 0 ? "▲" : "▼")).join(""), `thắng/thua (${series.length} phiên; ▲ tăng, ▼ giảm)`)
  }
}

export type ChartDepthInput = {
  symbol?: string
  bids: { price: number; volume: number }[]
  asks: { price: number; volume: number }[]
  depth?: number
}

const LevelSchema = z.object({ price: z.number(), volume: z.number().nonnegative() })

/** Bid/ask ladder as text from an order book the model already fetched. */
export function chartDepthTool(): ToolDef<ChartDepthInput> {
  return {
    name: "chart_depth",
    description:
      "Vẽ sổ lệnh mua/bán dạng text từ dữ liệu orderbook đã có (dnse_orderbook, vn_trades). Dùng khi hỏi cung cầu, bid/ask. Không dùng khi chưa có dữ liệu orderbook.",
    input: z.object({
      symbol: z.string().optional().describe("Mã để ghi tiêu đề"),
      bids: z.array(LevelSchema).max(200).describe("Các mức mua (giá + khối lượng)"),
      asks: z.array(LevelSchema).max(200).describe("Các mức bán (giá + khối lượng)"),
      depth: z.number().int().min(1).max(20).optional().describe("Số mức mỗi bên (mặc định 5)"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `chart_depth${input.symbol ? ` ${input.symbol}` : ""}`,
    async execute(input) {
      const depth = input.depth ?? 5
      const bids = [...input.bids].sort((a, b) => b.price - a.price).slice(0, depth)
      const asks = [...input.asks].sort((a, b) => a.price - b.price).slice(0, depth)
      if (bids.length === 0 && asks.length === 0) throw new Error("Sổ lệnh rỗng cả hai bên (ngoài giờ giao dịch thì đúng là vậy); báo trung thực.")
      const maxVol = Math.max(1, ...bids.map((b) => b.volume), ...asks.map((a) => a.volume))
      const bar = (vol: number) => "█".repeat(Math.max(1, Math.round((vol / maxVol) * 16)))
      return [
        `${input.symbol ? `${input.symbol} · ` : ""}sổ lệnh (top ${depth}):`,
        ...[...asks].reverse().map((a) => `ASK ${a.price.toFixed(2).padStart(10)} ${bar(a.volume)} ${a.volume}`),
        "──────────── giữa ────────────",
        ...bids.map((b) => `BID ${b.price.toFixed(2).padStart(10)} ${bar(b.volume)} ${b.volume}`),
      ].join("\n")
    },
  }
}
