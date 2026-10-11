import { z } from "zod"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import { renderBoxplot } from "./boxplot"
import type { ChartData } from "./data"
import { extractFromRef } from "./extract"
import { summarizeChart } from "./summary"
import { renderMultiline } from "./multiline"
import { renderPie } from "./pie"
import { renderStacked } from "./stacked"
import { renderWaterfall } from "./waterfall"

/**
 * The text renderers below validate the input (minimum points) and back the headless tests;
 * the model gets `summarizeChart` instead of the ASCII art, and the TUI paints the coloured
 * chart from `chartDataOf`. Some library marks colour unconditionally, so text is stripped.
 */
export const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")

/** Widths above this wrap in the transcript's tool output. */
export const MAX_CHART_WIDTH = 120

const BarSchema = z
  .object({ o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number().nonnegative().optional() })
  .refine((b) => b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c), "Nến sai: cần thấp ≤ mở/đóng ≤ cao")

/** Kinds `from_call` can fill from a stored result; the rest need their numbers passed. */
const FROM_CALL_KINDS = new Set(["candlestick", "line", "area", "sparkline", "linebox", "sparkcolumn", "histogram", "winloss", "bar", "pie"])

const KINDS = [
  "candlestick",
  "line",
  "sparkline",
  "bar",
  "histogram",
  "heatmap",
  "gauge",
  "donut",
  "area",
  "winloss",
  "pie",
  "waterfall",
  "multiline",
  "stacked",
  "boxplot",
  "scatter",
  "sparkcolumn",
  "linebox",
] as const

export type ChartRenderInput = {
  kind: (typeof KINDS)[number]
  /** `rN` from a tool result's `[ref rN]`: the harness reads the numbers itself. */
  from_call?: string
  /** Numeric field to plot (default: close/price/value). */
  field?: string
  /** Text field naming each row (bar/pie). */
  label_field?: string
  /** Dotted path of the array when the result holds several. */
  path?: string
  /** Symbol to draw from a result holding several (a batch call). */
  from_symbol?: string
  symbol?: string
  bars?: { o: number; h: number; l: number; c: number; v?: number }[]
  series?: number[]
  labels?: string[]
  matrix?: number[][]
  points?: { x: number; y: number }[]
  groups?: number[]
  times?: string[]
  dirs?: boolean[]
  start?: number
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
      "Vẽ biểu đồ màu trong TUI từ dữ liệu đã có. Ưu tiên from_call: mã rN trong [ref rN] ở đầu kết quả tool dữ liệu — harness tự lấy số, không gõ lại (candlestick, line/area/sparkline/linebox/sparkcolumn/histogram/winloss, bar/pie). Kết quả gọi gộp nhiều mã: chọn mã bằng from_symbol. Chỉ truyền số tay khi dữ liệu không đến từ tool: candlestick (bars ≥5), line… (series), bar/pie (series+labels), heatmap/multiline/stacked/boxplot (matrix), waterfall (start+series), scatter (points), gauge/donut (value+max). Trả về tóm tắt số để nhận xét; hình tự hiện cho người dùng.",
    input: z.object({
      kind: z.enum(KINDS).describe("Loại biểu đồ"),
      from_call: z.string().regex(/^r\d+$/, "dạng r12").optional().describe("Mã rN từ [ref rN] của kết quả tool dữ liệu"),
      field: z.string().max(40).optional().describe("Trường số cần vẽ khi dùng from_call (mặc định giá đóng cửa/giá trị), ví dụ volume"),
      label_field: z.string().max(40).optional().describe("Trường tên cho bar/pie khi dùng from_call, ví dụ symbol"),
      path: z.string().max(80).optional().describe("Đường dẫn mảng trong kết quả khi có nhiều mảng, ví dụ data.candles"),
      from_symbol: z.string().max(20).optional().describe("Mã cần vẽ khi kết quả from_call chứa nhiều mã (gọi gộp), ví dụ SHB"),
      symbol: z.string().optional().describe("Mã hoặc tiêu đề, ví dụ VCB; bắt đầu bằng mã thì mã đó phải khớp dữ liệu"),
      bars: z.array(BarSchema).max(500).optional().describe("Nến OHLC cho kind=candlestick (tối thiểu 5)"),
      series: z
        .array(z.number())
        .max(2000)
        .optional()
        .describe("Chuỗi số cho line/sparkline/sparkcolumn/area/bar/histogram/winloss; deltas cho waterfall"),
      dirs: z.array(z.boolean()).max(2000).optional().describe("Hướng từng cột sparkcolumn (màu xanh/đỏ theo giá, vd volume kèm close so phiên trước)"),
      labels: z.array(z.string()).max(200).optional().describe("Nhãn: bar/pie (mỗi cột), waterfall (mỗi bước), multiline/stacked/boxplot/heatmap (nhãn hàng rồi nhãn cột)"),
      matrix: z
        .array(z.array(z.number()).max(500))
        .max(30)
        .refine((m) => m.reduce((a, r) => a + r.length, 0) <= 5000, "matrix tối đa 5000 số")
        .optional()
        .describe("Ma trận, chỉ cho kind=heatmap; multiline/boxplot (mỗi dòng 1 series); stacked (mỗi hàng 1 nhóm). bar/line… nhận series, không nhận matrix"),
      points: z.array(z.object({ x: z.number(), y: z.number() })).max(500).optional().describe("Điểm (x,y) cho kind=scatter (ít nhất 3)"),
      groups: z.array(z.number().int().nonnegative()).max(500).optional().describe("Nhóm từng điểm scatter (mỗi nhóm 1 màu + legend)"),
      times: z.array(z.string()).max(2000).optional().describe("Nhãn trục X theo thời gian (nến/line/area/multiline/spark, vd 09-01)"),
      start: z.number().optional().describe("Giá trị đầu cho kind=waterfall"),
      value: z.number().optional().describe("Giá trị cho kind=gauge/donut"),
      max: z.number().positive().optional().describe("Thang tối đa cho gauge/donut"),
      unit: z.string().max(10).optional().describe("Đơn vị hiển thị, ví dụ %"),
      width: z.number().int().min(20).max(MAX_CHART_WIDTH).optional().describe("Rộng (ký tự, mặc định theo kind)"),
      height: z.number().int().min(3).max(40).optional().describe("Cao (dòng, mặc định theo kind)"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `chart_render ${input.kind}${input.symbol ? ` ${input.symbol}` : ""}${input.from_call ? ` ← ${input.from_call}` : ""}`,
    async execute(raw) {
      const input = raw.from_call ? fromCall(raw) : raw
      checkLengths(input)
      await render(input) // validates minimum points; the text itself is not sent
      const chart = chartDataOf(input)
      return { output: summarizeChart(chart, raw.from_call ? `${raw.from_call}` : undefined), chart }
    },
  }
}

/** Fill a render input from a stored tool result (refs.ts). Explicit numbers are ignored. */
export function fromCall(input: ChartRenderInput): ChartRenderInput {
  if (!FROM_CALL_KINDS.has(input.kind)) {
    throw new Error(`kind ${input.kind} chưa hỗ trợ from_call; truyền số tay (matrix/points/value…).`)
  }
  const got = extractFromRef(input.from_call!, {
    ohlc: input.kind === "candlestick",
    field: input.field,
    labelField: input.label_field,
    path: input.path,
    symbol: input.from_symbol,
    hint: input.symbol,
  })
  const base = { kind: input.kind, symbol: input.symbol ?? got.symbol, unit: input.unit, width: input.width, height: input.height, from_call: input.from_call }
  const tail = <T,>(xs: T[] | undefined, max: number) => (xs && xs.length > max ? xs.slice(-max) : xs)
  if (input.kind === "candlestick") {
    if (!got.bars?.length) throw new Error(`${input.from_call} không có nến hợp lệ.`)
    return { ...base, bars: tail(got.bars, 500), times: tail(got.times, 500) }
  }
  const series = tail(got.series, 2000) ?? []
  return {
    ...base,
    series,
    times: tail(got.times, 2000),
    labels: input.kind === "bar" || input.kind === "pie" ? tail(got.labels, 200) : undefined,
    dirs: input.kind === "sparkcolumn" ? tail(got.dirs, 2000) : undefined,
  }
}

/** `times` and `dirs` describe the data points one to one; a mismatch draws the wrong dates. */
function checkLengths(input: ChartRenderInput) {
  const points = input.bars?.length ?? input.series?.length ?? input.matrix?.[0]?.length
  if (points === undefined) return
  if (input.times && input.times.length !== points) {
    throw new Error(`times có ${input.times.length} nhãn nhưng dữ liệu có ${points} điểm; cần bằng nhau (hoặc bỏ times).`)
  }
  if (input.dirs && input.series && input.dirs.length !== input.series.length) {
    throw new Error(`dirs có ${input.dirs.length} phần tử nhưng series có ${input.series.length}.`)
  }
}

/**
 * Structured twin of the text output: what the TUI paints as a coloured chart.
 * Mirrors the validated input; every field is already range-checked by the schema.
 */
export function chartDataOf(input: ChartRenderInput): ChartData {
  const { kind, symbol } = input
  const unit = input.unit ? { unit: input.unit } : {}
  switch (kind) {
    case "candlestick":
      return { kind, symbol, bars: input.bars ?? [], ...(input.times ? { times: input.times } : {}), ...unit }
    case "line":
    case "area":
      return { kind, symbol, series: input.series ?? [], ...(input.times ? { times: input.times } : {}), ...unit }
    case "sparkline":
    case "linebox":
      return { kind, symbol, series: input.series ?? [], ...(input.times ? { times: input.times } : {}), ...unit }
    case "sparkcolumn":
      return { kind, symbol, series: input.series ?? [], ...(input.dirs ? { dirs: input.dirs } : {}), ...unit }
    case "bar":
    case "pie":
    case "winloss":
    case "histogram":
      return { kind, symbol, series: input.series ?? [], ...(input.labels ? { labels: input.labels } : {}), ...unit }
    case "heatmap":
    case "stacked":
    case "boxplot":
      return { kind, symbol, matrix: input.matrix ?? [], ...(input.labels ? { labels: input.labels } : {}), ...unit }
    case "multiline":
      return { kind, symbol, matrix: input.matrix ?? [], ...(input.labels ? { labels: input.labels } : {}), ...(input.times ? { times: input.times } : {}), ...unit }
    case "waterfall":
      return { kind, symbol, start: input.start ?? 0, series: input.series ?? [], ...(input.labels ? { labels: input.labels } : {}), ...unit }
    case "scatter":
      return {
        kind,
        symbol,
        points: input.points ?? [],
        ...(input.groups ? { groups: input.groups } : {}),
        ...(input.labels ? { labels: input.labels } : {}),
        ...unit,
      }
    case "gauge":
    case "donut":
      return { kind, symbol, value: input.value ?? 0, max: input.max ?? 1, ...unit }
  }
}

/** Plain-text rendering (headless debugging, tests); throws on too few points. */
export async function chartText(input: ChartRenderInput) {
  return stripAnsi(await render(input))
}

async function render(input: ChartRenderInput): Promise<string> {
  const lib = await import("@crafter/charts")
  const title = input.symbol ? `${input.symbol} · ` : ""
  const head = (body: string, subtitle: string) => `${title}${subtitle}:\n${body}`
  const W = (d: number) => Math.min(Math.max(input.width ?? d, 20), MAX_CHART_WIDTH)
  const H = (d: number) => Math.min(Math.max(input.height ?? d, 3), 40)
  const series = input.series ?? []
  const needSeries = (min: number, what: string) => {
    // Several series as a matrix (grouped bars, several tickers): name the kinds that take one.
    if (series.length === 0 && input.matrix?.length) {
      throw new Error(
        `${input.kind} vẽ một chuỗi (series${input.kind === "bar" || input.kind === "pie" ? " + labels" : ""}), không nhận matrix. Nhiều mã theo thời gian: kind=multiline (cùng đơn vị) hoặc chart_compare (so % thay đổi). Nhóm × thành phần: kind=stacked.`,
      )
    }
    if (series.length < min) throw new Error(`${input.kind} cần series ít nhất ${min} ${what}.`)
  }
  const needValue = (example: string) => {
    if (input.value === undefined || input.max === undefined) throw new Error(`${input.kind} cần value + max (ví dụ ${example}).`)
    return { value: input.value, max: input.max }
  }
  const withUnit = (out: string) => (input.unit && !out.trimEnd().endsWith(input.unit) ? `${out} ${input.unit}` : out)
  /** Spark marks scale by absMax (shapeless for price levels like 57→60): shift so min → 0. */
  const byRange = (s: number[]) => {
    const min = Math.min(...s)
    return s.map((v) => v - min)
  }

  switch (input.kind) {
    case "sparkline":
      needSeries(2, "điểm")
      return head(lib.sparkline(byRange(series)), `sparkline (${series.length} điểm)`)
    case "area":
      needSeries(2, "điểm")
      return head(lib.sparkArea(byRange(series), { width: W(64), height: H(10) }), `area (${series.length} điểm)`)
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
      return head(
        series.map((v) => `${v >= 0 ? "▲" : "▼"}${v >= 0 ? "+" : ""}${Number(v.toFixed(2))}`).join(" "),
        `thắng/thua (${series.length} phiên; ▲ tăng, ▼ giảm)`,
      )
    case "pie": {
      const r = renderPie(input)
      return head(r.body, r.subtitle)
    }
    case "waterfall": {
      const r = renderWaterfall(input)
      return head(r.body, r.subtitle)
    }
    case "multiline": {
      const r = renderMultiline(input)
      return head(r.body, r.subtitle)
    }
    case "stacked": {
      const r = renderStacked(input)
      return head(r.body, r.subtitle)
    }
    case "boxplot": {
      const r = renderBoxplot(input)
      return head(r.body, r.subtitle)
    }
    case "scatter": {
      const points = input.points ?? []
      if (points.length < 3) throw new Error(`scatter cần ít nhất 3 điểm (x,y), đang có ${points.length}.`)
      const rows = points.map((p) => ({ x: p.x, y: p.y }))
      const builder = lib.chart({ width: W(56), height: H(10) }).data(rows, { xKey: "x" }).scatter({ key: "y" }).xAxis().yAxis()
      return head(lib.renderToString(builder), `scatter (${points.length} điểm)`)
    }
    case "sparkcolumn":
      needSeries(2, "điểm")
      return head(lib.sparkColumn(byRange(series)), `sparkcolumn (${series.length} điểm)`)
    case "linebox": {
      needSeries(2, "điểm")
      const rows = series.map((c, t) => ({ t, c }))
      const builder = lib.chart({ width: W(56), height: H(10), charset: "box" }).data(rows, { xKey: "t" }).line({ key: "c" }).yAxis()
      return head(lib.renderToString(builder), `linebox (${series.length} điểm)`)
    }
  }
}

export type ChartDepthInput = {
  symbol?: string
  bids: { price: number; volume: number }[]
  asks: { price: number; volume: number }[]
  depth?: number
  unit?: string
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
      unit: z.string().max(10).optional().describe("Đơn vị hiển thị, ví dụ kVND"),
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
      const output = [
        `${input.symbol ? `${input.symbol} · ` : ""}sổ lệnh (top ${depth}):`,
        ...[...asks].reverse().map((a) => `ASK ${a.price.toFixed(2).padStart(10)} ${bar(a.volume)} ${a.volume}`),
        "──────────── giữa ────────────",
        ...bids.map((b) => `BID ${b.price.toFixed(2).padStart(10)} ${bar(b.volume)} ${b.volume}`),
      ].join("\n")
      const chart: ChartData = {
        kind: "depth",
        ...(input.symbol ? { symbol: input.symbol } : {}),
        bids: input.bids,
        asks: input.asks,
        depth,
        ...(input.unit ? { unit: input.unit } : {}),
      }
      return { output, chart }
    },
  }
}
