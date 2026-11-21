import { z } from "zod"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import { chartCompareTool, type ChartCompareInput } from "./compare"
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
  .refine((b) => b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c), "Invalid candle: needs low ≤ open/close ≤ high")

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

/** The tool's kinds: the renderer's, plus compare (chart_compare) and depth (chart_depth) folded in. */
const TOOL_KINDS = [...KINDS, "compare", "depth"] as const

export type ChartToolInput = Omit<ChartRenderInput, "kind"> & {
  kind: (typeof TOOL_KINDS)[number]
  /** kind=compare: refs of price results, 2–5 series in all. */
  from_calls?: string[]
  /** kind=compare: keep only these symbols from from_calls; without from_calls, the matrix rows' labels. */
  symbols?: string[]
  /** kind=compare: the matrix rows are already cumulative % change, not prices. */
  percent?: boolean
  /** kind=depth: order book levels. */
  bids?: { price: number; volume: number }[]
  asks?: { price: number; volume: number }[]
  /** kind=depth: levels per side (default 5). */
  levels?: number
}

const DESCRIPTION = [
  "Draws a colour chart in the terminal from data you already have; the picture is shown to the user and you get a numeric summary to comment on. Use when the user wants a picture, or a series is hard to read as a table. Do not use before you have the data: get it with a data tool first.",
  "Prefer from_call = the rN in a tool result's [ref rN] (the harness takes the numbers itself; do not retype them); for a result holding several tickers, pick one with from_symbol.",
  "kind=compare: 2–5 price series as % change on one scale (from_calls, filtered with symbols; or labels + matrix of raw prices, percent: true if the rows are already % change); use instead of multiline when the series differ in magnitude. kind=depth: order book (bids, asks).",
  "Hand-typed numbers by kind: candlestick bars (≥5); line/area/sparkline/sparkcolumn/linebox/histogram/winloss series; bar/pie series + labels; heatmap/multiline/stacked/boxplot matrix + labels; waterfall start + series; scatter points; gauge/donut value + max.",
].join("\n")

/** Text charts from data the model already has (MCP results); renders only, never fetches. */
export function chartRenderTool(): ToolDef<ChartToolInput> {
  return {
    name: "chart_render",
    description: DESCRIPTION,
    input: z.object({
      kind: z.enum(TOOL_KINDS).describe("Chart type; compare = % comparison of several series, depth = order book"),
      from_call: z.string().regex(/^r\d+$/, "like r12").optional().describe("rN from [ref rN]"),
      from_calls: z.array(z.string().regex(/^r\d+$/)).min(1).max(5).optional().describe("compare: the rNs"),
      symbols: z.array(z.string().max(20)).max(5).optional().describe("compare: only these tickers (with matrix: the row labels)"),
      percent: z.boolean().optional().describe("compare with matrix: rows are already % change from the first point (starting 0), not prices"),
      field: z.string().max(40).optional().describe("Numeric field with from_call (default: close), e.g. volume"),
      label_field: z.string().max(40).optional().describe("bar/pie: the name field, e.g. symbol"),
      path: z.string().max(80).optional().describe("Array path when the result has several arrays, e.g. data.candles"),
      from_symbol: z.string().max(20).optional().describe("Ticker to draw from a multi-ticker result"),
      symbol: z.string().optional().describe("Ticker or title"),
      bars: z.array(BarSchema).max(500).optional().describe("candlestick: OHLC(v) candles, at least 5"),
      series: z.array(z.number()).max(2000).optional().describe("line/area/spark*/bar/pie/histogram/winloss: the series; waterfall: the up/down steps"),
      dirs: z.array(z.boolean()).max(2000).optional().describe("sparkcolumn: up/down per column"),
      labels: z.array(z.string()).max(200).optional().describe("Column/step labels; with matrix: row labels, then column labels"),
      matrix: z
        .array(z.array(z.number()).max(500))
        .max(30)
        .refine((m) => m.reduce((a, r) => a + r.length, 0) <= 5000, "matrix holds at most 5000 numbers")
        .optional()
        .describe("heatmap/multiline/stacked/boxplot (and compare instead of from_calls): one series/group per row; bar/line use series"),
      points: z.array(z.object({ x: z.number(), y: z.number() })).max(500).optional().describe("scatter: (x, y) points, at least 3"),
      groups: z.array(z.number().int().nonnegative()).max(500).optional().describe("scatter: the group of each point"),
      times: z.array(z.string()).max(2000).optional().describe("X-axis labels"),
      start: z.number().optional().describe("waterfall: starting value"),
      value: z.number().optional().describe("gauge/donut: the value"),
      max: z.number().positive().optional().describe("gauge/donut: scale maximum"),
      bids: z.array(LevelSchema).max(200).optional().describe("depth: bid levels (price, volume)"),
      asks: z.array(LevelSchema).max(200).optional().describe("depth: ask levels (price, volume)"),
      levels: z.number().int().min(1).max(20).optional().describe("depth: levels per side (default 5)"),
      unit: z.string().max(10).optional().describe("Display unit, e.g. %"),
      width: z.number().int().min(20).max(MAX_CHART_WIDTH).optional(),
      height: z.number().int().min(3).max(40).optional(),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) =>
      `chart_render ${input.kind}${input.symbol ? ` ${input.symbol}` : ""}${input.from_call ? ` ← ${input.from_call}` : ""}${input.from_calls ? ` ← ${input.from_calls.join(", ")}` : ""}`,
    async execute(tool, ctx) {
      if (tool.kind === "compare") return chartCompareTool().execute(compareInput(tool), ctx)
      if (tool.kind === "depth") {
        if (!tool.bids || !tool.asks) throw new Error("kind=depth needs bids and asks (price + volume).")
        return chartDepthTool().execute({ symbol: tool.symbol, bids: tool.bids, asks: tool.asks, depth: tool.levels, unit: tool.unit }, ctx)
      }
      const raw = tool as ChartRenderInput
      const input = raw.from_call ? fromCall(raw) : raw
      checkLengths(input)
      await render(input) // validates minimum points; the text itself is not sent
      const chart = chartDataOf(input)
      return { output: summarizeChart(chart, raw.from_call ? `${raw.from_call}` : undefined), chart }
    },
  }
}

/** kind=compare in chart_render's shape → chart_compare's input (labels + matrix = manual series). */
function compareInput(tool: ChartToolInput): ChartCompareInput {
  const base = { title: tool.symbol, from_calls: tool.from_calls, symbols: tool.symbols, field: tool.field, times: tool.times, unit: tool.unit }
  if (tool.from_calls) return base
  // Without from_calls there is nothing to filter: symbols name the rows, as labels do (#331).
  const names = tool.labels ?? tool.symbols
  const rows = tool.matrix ?? []
  if (rows.length < 2 || rows.length > 5) throw new Error("kind=compare needs from_calls, or 2–5 matrix rows with labels.")
  if (rows.some((r) => r.length < 2)) throw new Error("kind=compare: each matrix row needs at least 2 points.")
  return {
    title: tool.symbol,
    times: tool.times,
    unit: tool.unit,
    ...(tool.percent ? { percent: true } : {}),
    series: rows.map((values, i) => ({ label: (names?.[i] ?? `#${i + 1}`).slice(0, 20), values })),
  }
}

/** Fill a render input from a stored tool result (refs.ts). Explicit numbers are ignored. */
export function fromCall(input: ChartRenderInput): ChartRenderInput {
  if (!FROM_CALL_KINDS.has(input.kind)) {
    throw new Error(`kind ${input.kind} does not support from_call yet; pass the numbers by hand (matrix/points/value…).`)
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
    if (!got.bars?.length) throw new Error(`${input.from_call} has no valid candles.`)
    return { ...base, bars: tail(got.bars, 500), times: tail(got.times, 500) }
  }
  // bar/pie take at most 200 labels: values and labels are cut at the same index, or a
  // 201-row result would pair each label with its neighbour's value.
  const labelled = input.kind === "bar" || input.kind === "pie"
  const series = tail(got.series, labelled ? 200 : 2000) ?? []
  const labels = labelled ? tail(got.labels, 200) : undefined
  if (labels && labels.length !== series.length) {
    throw new Error(`${input.from_call}: ${labels.length} labels but ${series.length} values, cannot pair them; choose another label_field/field or pass the numbers by hand.`)
  }
  return {
    ...base,
    series,
    times: tail(got.times, 2000),
    labels,
    dirs: input.kind === "sparkcolumn" ? tail(got.dirs, 2000) : undefined,
  }
}

/** `times` and `dirs` describe the data points one to one; a mismatch draws the wrong dates. */
function checkLengths(input: ChartRenderInput) {
  const points = input.bars?.length ?? input.series?.length ?? input.matrix?.[0]?.length
  if (points === undefined) return
  if (input.times && input.times.length !== points) {
    throw new Error(`times has ${input.times.length} labels but the data has ${points} points; they must match (or drop times).`)
  }
  if (input.dirs && input.series && input.dirs.length !== input.series.length) {
    throw new Error(`dirs has ${input.dirs.length} items but series has ${input.series.length}.`)
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
        `${input.kind} draws one series (series${input.kind === "bar" || input.kind === "pie" ? " + labels" : ""}) and takes no matrix. Several tickers over time: kind=multiline (same unit) or chart_compare (% change). Groups × parts: kind=stacked.`,
      )
    }
    if (series.length < min) throw new Error(`${input.kind} needs a series of at least ${min} ${what}.`)
  }
  const needValue = (example: string) => {
    if (input.value === undefined || input.max === undefined) throw new Error(`${input.kind} needs value + max (e.g. ${example}).`)
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
      needSeries(2, "points")
      return head(lib.sparkline(byRange(series)), `sparkline (${series.length} points)`)
    case "area":
      needSeries(2, "points")
      return head(lib.sparkArea(byRange(series), { width: W(64), height: H(10) }), `area (${series.length} points)`)
    case "line": {
      needSeries(2, "points")
      const rows = series.map((c, t) => ({ t, c }))
      const builder = lib.chart({ width: W(64), height: H(10) }).data(rows, { xKey: "t" }).line({ key: "c" }).yAxis()
      return head(lib.renderToString(builder), `line (${series.length} points)`)
    }
    case "candlestick": {
      const bars = input.bars ?? []
      if (bars.length < 5) throw new Error(`candlestick needs at least 5 candles, got ${bars.length}.`)
      const rows = bars.map((bar, t) => ({ t, ...bar }))
      const builder = lib
        .chart({ width: W(64), height: H(14) })
        .data(rows, { xKey: "t" })
        .candlestick({ open: "o", high: "h", low: "l", close: "c" })
        .yAxis()
        .xAxis()
      return head(lib.renderToString(builder), `candles (${bars.length} sessions)`)
    }
    case "bar": {
      needSeries(1, "columns")
      const maxAbs = Math.max(1e-9, ...series.map((v) => Math.abs(v)))
      const lines = series.map((v, i) => {
        const bar = (v >= 0 ? "█" : "░").repeat(Math.max(1, Math.round((Math.abs(v) / maxAbs) * 20)))
        return `${(input.labels?.[i] ?? `#${i + 1}`).padEnd(12)} ${bar} ${v}`
      })
      return head(lines.join("\n"), `bar (${series.length} columns; █ positive, ░ negative)`)
    }
    case "histogram":
      needSeries(5, "points")
      return head(lib.sparkHistogram(series, { height: H(8) }), `distribution (${series.length} points)`)
    case "heatmap": {
      const matrix = input.matrix ?? []
      if (matrix.length === 0 || !matrix[0]?.length) throw new Error("heatmap needs a 2D matrix.")
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
      const { value, max } = needValue("weight 35/100")
      return head(withUnit(lib.sparkDonut(value, max)), "donut")
    }
    case "winloss":
      needSeries(2, "sessions")
      return head(
        series.map((v) => `${v >= 0 ? "▲" : "▼"}${v >= 0 ? "+" : ""}${Number(v.toFixed(2))}`).join(" "),
        `win/loss (${series.length} sessions; ▲ up, ▼ down)`,
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
      if (points.length < 3) throw new Error(`scatter needs at least 3 (x,y) points, got ${points.length}.`)
      const rows = points.map((p) => ({ x: p.x, y: p.y }))
      const builder = lib.chart({ width: W(56), height: H(10) }).data(rows, { xKey: "x" }).scatter({ key: "y" }).xAxis().yAxis()
      return head(lib.renderToString(builder), `scatter (${points.length} points)`)
    }
    case "sparkcolumn":
      needSeries(2, "points")
      return head(lib.sparkColumn(byRange(series)), `sparkcolumn (${series.length} points)`)
    case "linebox": {
      needSeries(2, "points")
      const rows = series.map((c, t) => ({ t, c }))
      const builder = lib.chart({ width: W(56), height: H(10), charset: "box" }).data(rows, { xKey: "t" }).line({ key: "c" }).yAxis()
      return head(lib.renderToString(builder), `linebox (${series.length} points)`)
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
      "Draws the bid/ask order book as text from order-book data you already have (dnse_orderbook, vn_trades). Use for supply/demand and bid/ask questions. Do not use without order-book data.",
    input: z.object({
      symbol: z.string().optional().describe("Ticker for the title"),
      bids: z.array(LevelSchema).max(200).describe("Bid levels (price + volume)"),
      asks: z.array(LevelSchema).max(200).describe("Ask levels (price + volume)"),
      depth: z.number().int().min(1).max(20).optional().describe("Levels per side (default 5)"),
      unit: z.string().max(10).optional().describe("Display unit, e.g. kVND"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `chart_depth${input.symbol ? ` ${input.symbol}` : ""}`,
    async execute(input) {
      const depth = input.depth ?? 5
      const bids = [...input.bids].sort((a, b) => b.price - a.price).slice(0, depth)
      const asks = [...input.asks].sort((a, b) => a.price - b.price).slice(0, depth)
      if (bids.length === 0 && asks.length === 0) throw new Error("The order book is empty on both sides (normal outside trading hours); report that honestly.")
      const maxVol = Math.max(1, ...bids.map((b) => b.volume), ...asks.map((a) => a.volume))
      const bar = (vol: number) => "█".repeat(Math.max(1, Math.round((vol / maxVol) * 16)))
      const output = [
        `${input.symbol ? `${input.symbol} · ` : ""}order book (top ${depth}):`,
        ...[...asks].reverse().map((a) => `ASK ${a.price.toFixed(2).padStart(10)} ${bar(a.volume)} ${a.volume}`),
        "──────────── mid ────────────",
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
