import { z } from "zod"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import type { ChartData } from "./data"
import { extractAllFromRef } from "./extract"
import { summarizeChart } from "./summary"

export type ChartCompareInput = {
  title?: string
  series?: { label: string; values: number[] }[]
  /** Refs (`rN`) of price results: every symbol each holds becomes a series (2–5 in all). */
  from_calls?: string[]
  /** Keep only these symbols from the from_calls results. */
  symbols?: string[]
  /** Numeric field for from_calls (default close/price). */
  field?: string
  width?: number
  ymin?: number
  ymax?: number
  times?: string[]
  unit?: string
}

const BLOCKS = "▁▂▃▄▅▆▇█"

/** Evenly spaced samples, first and last kept, so long series fit the width. */
function sample(values: number[], width: number) {
  if (values.length <= width) return values
  return Array.from({ length: width }, (_, i) => values[Math.round((i * (values.length - 1)) / (width - 1))]!)
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`

/**
 * Several series side by side (VCB vs HPG vs VNINDEX), each as % change from its first
 * point on one shared scale. The TUI draws the coloured chart; the model gets a summary.
 */
export function chartCompareTool(): ToolDef<ChartCompareInput> {
  return {
    name: "chart_compare",
    description:
      "Compares 2–5 price series (ticker vs ticker, ticker vs index) as % change from the first point, on one scale. " +
      "Use when: comparing VCB with HPG with VNINDEX, a stock with gold. " +
      "Do not use when: there is only 1 series (use chart_render kind=line). " +
      "Prefer from_calls: the rN in price results' [ref rN] — the harness takes the numbers itself, e.g. from_calls: [\"r1\",\"r3\"]. A result holding several tickers is split into one series each (filter with symbols). Series of different lengths are aligned on their last point.",
    input: z.object({
      title: z.string().optional().describe("Title, e.g. VCB vs HPG"),
      series: z
        .array(z.object({ label: z.string().min(1).max(20), values: z.array(z.number()).min(2).max(2000) }))
        .min(2)
        .max(5)
        .optional()
        .describe("2–5 series to compare (when not using from_calls)"),
      from_calls: z
        .array(z.string().regex(/^r\d+$/))
        .min(1)
        .max(5)
        .optional()
        .describe("The rN of price results; 2–5 series in total (one multi-ticker result works too)"),
      symbols: z.array(z.string().max(20)).max(5).optional().describe("Take only these tickers from the from_calls results, e.g. [\"FPT\",\"SHB\"]"),
      field: z.string().max(40).optional().describe("Numeric field with from_calls (default: close)"),
      width: z.number().int().min(10).max(80).optional().describe("Points per line (default 40)"),
      ymin: z.number().optional().describe("Custom lower y-axis (%); ignored when empty"),
      ymax: z.number().optional().describe("Custom upper y-axis (%); needs ymin"),
      times: z.array(z.string()).max(2000).optional().describe("Time labels for the X axis"),
      unit: z.string().max(10).optional().describe("Display unit, e.g. %"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `chart_compare(${input.from_calls?.join(", ") ?? input.series?.map((s) => s.label).join(" vs ") ?? ""})`,
    async execute(raw) {
      if (raw.ymin !== undefined && raw.ymax !== undefined && raw.ymin >= raw.ymax) throw new Error("ymin must be smaller than ymax.")
      if ((raw.ymin === undefined) !== (raw.ymax === undefined)) throw new Error("ymin and ymax must go together.")
      let input = raw as ChartCompareInput & { series: { label: string; values: number[] }[] }
      if (raw.from_calls) {
        // A batch result gives one series per symbol it holds. `symbols` filters the union of
        // every ref (r1 holds FPT, r2 holds HPG): a symbol is missing only if no ref has it.
        const all = raw.from_calls.flatMap((ref) => extractAllFromRef(ref, { field: raw.field }))
        const wanted = raw.symbols?.map((s) => s.trim().toUpperCase()).filter(Boolean) ?? []
        let got = all
        if (wanted.length > 0) {
          const held = all.map((g) => g.symbol?.toUpperCase())
          const missing = wanted.filter((s) => !held.includes(s))
          // A result that names no symbol may be the one asked for: kept, not reported missing.
          if (missing.length > 0 && !held.includes(undefined)) {
            const known = [...new Set(held.filter(Boolean))]
            throw new Error(`Results ${raw.from_calls.join(", ")} have no ticker ${missing.join(", ")}.${known.length ? ` Tickers present: ${known.join(", ")}.` : ""}`)
          }
          got = all.filter((g) => !g.symbol || wanted.includes(g.symbol.toUpperCase()))
        }
        if (got.length < 2) {
          throw new Error(`Only ${got.length} series (${got.map((g) => g.symbol ?? g.ref).join(", ")}); 2–5 are needed. Add another ticker's price result to from_calls, or draw one ticker with chart_render kind=line.`)
        }
        if (got.length > 5) {
          throw new Error(`${got.length} series (${got.map((g) => g.symbol ?? g.ref).join(", ")}); at most 5. Choose tickers with symbols.`)
        }
        const labels = got.map((g) => g.symbol ?? g.ref)
        const longest = got.reduce((a, b) => ((b.series?.length ?? 0) > (a.series?.length ?? 0) ? b : a))
        input = {
          ...raw,
          series: got.map((g, i) => ({ label: labels[i]!.slice(0, 20), values: (g.series ?? []).slice(-2000) })),
          times: longest.times?.slice(-2000),
        }
        const short = input.series.find((s) => s.values.length < 2)
        if (short) throw new Error(`${short.label}: not enough points to compare.`)
      } else if (!raw.series) throw new Error("series or from_calls is required.")
      const output = compareText(input)
      const chart: ChartData = {
        kind: "compare",
        ...(input.title ? { title: input.title } : {}),
        series: input.series,
        ...(input.ymin !== undefined && input.ymax !== undefined ? { domain: [input.ymin, input.ymax] as [number, number] } : {}),
        ...(input.times ? { times: input.times } : {}),
        ...(input.unit ? { unit: input.unit } : {}),
      }
      void output // built for its validation (a series starting at 0); the model reads the summary
      return { output: summarizeChart(chart, raw.from_calls?.join(", ")), chart }
    },
  }
}

/** Plain-text twin (headless debugging, tests). Throws when a series starts at 0. */
export function compareText(input: ChartCompareInput & { series: { label: string; values: number[] }[] }) {
  const width = input.width ?? 40
  const bad = input.series.find((s) => s.values[0] === 0)
  if (bad) throw new Error(`Series ${bad.label} starts at 0, so % change cannot be computed.`)
  const changes = input.series.map((s) => s.values.map((v) => ((v - s.values[0]!) / Math.abs(s.values[0]!)) * 100))
  const longest = Math.max(...changes.map((c) => c.length))
  const lo = Math.min(...changes.flat())
  const hi = Math.max(...changes.flat())
  const span = hi - lo || 1
  const cols = Math.min(width, longest)
  const labelWidth = Math.max(...input.series.map((s) => s.label.length))
  const rows = input.series.map((s, i) => {
    const points = sample(changes[i]!, Math.max(2, Math.round((cols * changes[i]!.length) / longest)))
    const spark = points.map((v) => BLOCKS[Math.min(BLOCKS.length - 1, Math.floor(((v - lo) / span) * BLOCKS.length))]).join("")
    const last = changes[i]![changes[i]!.length - 1]!
    return `${s.label.padEnd(labelWidth)} ${spark.padStart(cols)} ${pct(last)}`
  })
  const output = [
    `${input.title ? `${input.title} · ` : ""}% change from the first point, one scale ${pct(lo)} … ${pct(hi)}:`,
    ...rows,
  ].join("\n")
  return output
}
