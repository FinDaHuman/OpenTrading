import { z } from "zod"
import type { ToolDef } from "../types"

const BarSchema = z.object({
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
})

type AnsiColor = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray"

/** Bảng màu tài chính VN: tăng xanh, giảm đỏ, tham chiếu vàng, trần tím, sàn cyan. */
export const FIN_COLORS = {
  up: "green",
  down: "red",
  ref: "yellow",
  ceiling: "magenta",
  floor: "cyan",
  compare: ["green", "cyan", "yellow", "magenta", "blue"],
} as const

export type ChartRenderInput = {
  kind:
    | "candlestick"
    | "line"
    | "sparkline"
    | "bar"
    | "histogram"
    | "heatmap"
    | "gauge"
    | "donut"
    | "area"
    | "winloss"
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
  color?: "auto" | "always" | "never"
}

const KIND_HELP: Record<ChartRenderInput["kind"], string> = {
  candlestick: "nến OHLC (bars ≥5: vn_equity_ohlcv, market_candles_batch, dnse_ohlc_history)",
  line: "đường giá (series: vn_quote_history closes, fred_series, vs_indicator_data)",
  sparkline: "1 dòng inline (market_pins, giá nhanh)",
  bar: "cột theo nhãn (sector_performance, valuation per/pb, planned_targets, odds, seasonality tháng)",
  histogram: "phân phối (event_study CARs, pattern_match corrs, quant returns)",
  heatmap: "ma trận (correlation_matrix, compare_assets, vs_industry_heatmap)",
  gauge: "đồng hồ 1 giá trị (world_fear_greed 0-100, sentiment_score, quant_risk sharpe/win-rate)",
  donut: "tỷ trọng (portfolio_optimize weights, holders, breadth adv/dec)",
  area: "vùng dưới đường (drawdown backtest, macro area)",
  winloss: "thắng/thua theo phiên (money_flow, vs_nn_flow buy/sell sign)",
}

/**
 * Vẽ biểu đồ text có màu ANSI (phase 1+2 đợt 1&2).
 * Data do MCP tools cung cấp — tool này chỉ render, không fetch.
 * Output ANSI hiển thị màu trên terminal thật; color=never để lấy bản trắng đen.
 */
export function chartRenderTool(): ToolDef<ChartRenderInput> {
  return {
    name: "chart_render",
    description:
      "Vẽ biểu đồ text có màu từ dữ liệu đã có. kind: candlestick (bars OHLC ≥5), line/sparkline/area (series), bar (series+labels), histogram (series phân phối), heatmap (matrix), gauge/donut (value+max), winloss (series âm/dương). Dùng sau khi đã gọi tool dữ liệu. Không dùng khi chưa có dữ liệu.",
    input: z.object({
      kind: z.enum(["candlestick", "line", "sparkline", "bar", "histogram", "heatmap", "gauge", "donut", "area", "winloss"]).describe("Loại biểu đồ"),
      symbol: z.string().optional().describe("Mã/tiêu đề, ví dụ VCB"),
      bars: z.array(BarSchema).optional().describe("Nến OHLC cho kind=candlestick (tối thiểu 5)"),
      series: z.array(z.number()).optional().describe("Chuỗi số cho line/sparkline/area/bar/histogram/winloss"),
      labels: z.array(z.string()).optional().describe("Nhãn cho bar (mỗi cột) và heatmap (rows,cols nối nhau)"),
      matrix: z.array(z.array(z.number())).optional().describe("Ma trận cho kind=heatmap"),
      value: z.number().optional().describe("Giá trị cho kind=gauge/donut"),
      max: z.number().optional().describe("Thang tối đa cho gauge/donut"),
      unit: z.string().optional().describe("Đơn vị hiển thị, ví dụ %"),
      width: z.number().int().min(20).max(200).optional().describe("Rộng ký tự (mặc định theo kind 40-64)"),
      height: z.number().int().min(3).max(40).optional().describe("Cao dòng (mặc định theo kind)"),
      color: z.enum(["auto", "always", "never"]).optional().describe("Màu ANSI (mặc định auto = có màu)"),
    }),
    readOnly: true,
    summarize: (input) => `chart_render ${input.kind}${input.symbol ? ` ${input.symbol}` : ""}`,
    async execute(input) {
      const lib = await import("@crafter/charts")
      const useColor = (input.color ?? "auto") !== "never"
      const title = input.symbol ? `${input.symbol} · ` : ""
      const head = (body: string, subtitle: string) => `${title}${subtitle}:\n${body}`
      const W = (d: number) => Math.min(Math.max(input.width ?? d, 20), 200)
      const H = (d: number) => Math.min(Math.max(input.height ?? d, 3), 40)

      switch (input.kind) {
        case "sparkline": {
          const series = input.series ?? []
          if (series.length < 2) throw new Error("sparkline cần series ít nhất 2 điểm.")
          return head(lib.sparkline(series), `sparkline (${series.length} điểm)`)
        }
        case "area": {
          const series = input.series ?? []
          if (series.length < 2) throw new Error("area cần series ít nhất 2 điểm.")
          const up = series[series.length - 1]! >= series[0]!
          return head(
            lib.sparkArea(series, {
              width: W(64),
              height: H(10),
              ...(useColor ? { color: (up ? FIN_COLORS.up : FIN_COLORS.down) as AnsiColor } : {}),
            }),
            `area (${series.length} điểm)`,
          )
        }
        case "line": {
          const series = input.series ?? []
          if (series.length < 2) throw new Error("line cần series ít nhất 2 điểm.")
          const rows = series.map((c, t) => ({ t, c }))
          const up = series[series.length - 1]! >= series[0]!
          const markColor = useColor ? { color: (up ? FIN_COLORS.up : FIN_COLORS.down) as AnsiColor } : {}
          const builder = lib.chart({ width: W(64), height: H(10) }).data(rows, { xKey: "t" }).line({ key: "c", ...markColor }).yAxis()
          return head(useColor ? lib.renderToAnsi(builder) : lib.renderToString(builder), `line (${series.length} điểm)`)
        }
        case "candlestick": {
          const bars = input.bars ?? []
          if (bars.length < 5) throw new Error(`candlestick cần ít nhất 5 nến, đang có ${bars.length}.`)
          const rows = bars.map((bar, t) => ({ t, ...bar }))
          const b = lib
            .chart({ width: W(64), height: H(14) })
            .data(rows, { xKey: "t" })
            .candlestick({ open: "o", high: "h", low: "l", close: "c" })
            .yAxis()
            .xAxis()
          return head(useColor ? lib.renderToAnsi(b) : lib.renderToString(b), `nến (${bars.length} bars)`)
        }
        case "bar": {
          const series = input.series ?? []
          if (series.length < 1) throw new Error("bar cần series ít nhất 1 cột.")
          const labels = input.labels ?? series.map((_, i) => `#${i + 1}`)
          const maxAbs = Math.max(1e-9, ...series.map((v) => Math.abs(v)))
          const rows = series.map((v) =>
            "█".repeat(Math.max(1, Math.round((Math.abs(v) / maxAbs) * 20))),
          )
          const paint = (v: number, s: string) =>
            !useColor ? s : v >= 0 ? `\u001b[32m${s}\u001b[0m` : `\u001b[31m${s}\u001b[0m`
          const lines = series.map(
            (v, i) => `${(labels[i] ?? `#${i + 1}`).padEnd(12)} ${paint(v, rows[i]!)} ${v}`,
          )
          return head(lines.join("\n"), `bar (${series.length} cột)`)
        }
        case "histogram": {
          const series = input.series ?? []
          if (series.length < 5) throw new Error("histogram cần series ít nhất 5 điểm.")
          return head(
            lib.sparkHistogram(series, { height: H(8), ...(useColor ? { color: "green" as AnsiColor } : {}) }),
            `phân phối (${series.length} điểm)`,
          )
        }
        case "heatmap": {
          const matrix = input.matrix ?? []
          if (matrix.length === 0 || !matrix[0]?.length) throw new Error("heatmap cần matrix 2D.")
          const labels = input.labels
          const n = matrix[0]!.length
          const rowLabels = labels?.slice(0, matrix.length)
          const colLabels = labels?.slice(matrix.length, matrix.length + n)
          return head(
            lib.sparkHeatmap(matrix, {
              ...(rowLabels && colLabels ? { labels: { rows: rowLabels, cols: colLabels } } : {}),
            }),
            `heatmap (${matrix.length}x${n})`,
          )
        }
        case "gauge": {
          if (input.value === undefined || input.max === undefined)
            throw new Error("gauge cần value + max (vd fear 72/100).")
          const gout = lib.sparkGauge(input.value, input.max, { ...(useColor ? { color: "green" as AnsiColor } : {}) })
          const gunit = input.unit && !gout.trimEnd().endsWith(input.unit) ? ` ${input.unit}` : ""
          return head(gout + gunit, "gauge")
        }
        case "donut": {
          if (input.value === undefined || input.max === undefined)
            throw new Error("donut cần value + max (vd weight 35/100).")
          const dout = lib.sparkDonut(input.value, input.max, { ...(useColor ? { color: "cyan" as AnsiColor } : {}) })
          const dunit = input.unit && !dout.trimEnd().endsWith(input.unit) ? ` ${input.unit}` : ""
          return head(dout + dunit, "donut")
        }
        case "winloss": {
          const series = input.series ?? []
          if (series.length < 2) throw new Error("winloss cần series ít nhất 2 phiên.")
          return head(
            useColor
              ? lib.sparkWinLoss(series, { winColor: "green" as AnsiColor, lossColor: "red" as AnsiColor })
              : series.map((v) => (v >= 0 ? "▲" : "▼")).join(""),
            `thắng/thua (${series.length} phiên)`,
          )
        }
      }
    },
  }
}

export function chartKindHelp(): string {
  return Object.entries(KIND_HELP)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n")
}

export type ChartDepthInput = {
  symbol?: string
  bids: { price: number; volume: number }[]
  asks: { price: number; volume: number }[]
  depth?: number
}

const LevelSchema = z.object({ price: z.number(), volume: z.number() })

/**
 * Vẽ ladder bid/ask text (depth-area native để phase sau).
 */
export function chartDepthTool(): ToolDef<ChartDepthInput> {
  return {
    name: "chart_depth",
    description:
      "Vẽ ladder bid/ask text từ orderbook đã có (dnse_orderbook, vn_trades). Dùng khi hỏi cung-cầu/bid-ask. Không dùng khi chưa có dữ liệu orderbook.",
    input: z.object({
      symbol: z.string().optional().describe("Mã để ghi tiêu đề"),
      bids: z.array(LevelSchema).describe("Các mức mua (giá + khối lượng)"),
      asks: z.array(LevelSchema).describe("Các mức bán (giá + khối lượng)"),
      depth: z.number().int().min(1).max(20).optional().describe("Số mức mỗi bên (mặc định 5)"),
    }),
    readOnly: true,
    summarize: (input) => `chart_depth${input.symbol ? ` ${input.symbol}` : ""}`,
    async execute(input) {
      const depth = Math.min(Math.max(input.depth ?? 5, 1), 20)
      const bids = [...input.bids].sort((a, b) => b.price - a.price).slice(0, depth)
      const asks = [...input.asks].sort((a, b) => a.price - b.price).slice(0, depth)
      if (bids.length === 0 && asks.length === 0) throw new Error("orderbook rỗng cả 2 bên — ngoài giờ thì đây là đúng, báo trung thực.")
      const maxVol = Math.max(1, ...bids.map((b) => b.volume), ...asks.map((a) => a.volume))
      const bar = (vol: number) => "█".repeat(Math.max(1, Math.round((vol / maxVol) * 16)))
      const lines = [
        `${input.symbol ? input.symbol + " · " : ""}orderbook (top ${depth}):`,
        ...[...asks].reverse().map((a) => `ASK ${a.price.toFixed(2).padStart(10)} ${bar(a.volume)} ${a.volume}`),
        "──────────── mid ────────────",
        ...bids.map((b) => `BID ${b.price.toFixed(2).padStart(10)} ${bar(b.volume)} ${b.volume}`),
      ]
      return lines.join("\n")
    },
  }
}
