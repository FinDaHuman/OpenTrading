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
      "So sánh 2–5 chuỗi giá (mã với mã, mã với chỉ số) theo % thay đổi từ điểm đầu, cùng một thang. Ưu tiên from_calls: các mã rN trong [ref rN] của kết quả giá — harness tự lấy số; một kết quả gọi gộp nhiều mã tự tách thành từng chuỗi (lọc bằng symbols). Chuỗi dài ngắn khác nhau được căn theo điểm cuối. Một chuỗi thì dùng chart_render kind=line.",
    input: z.object({
      title: z.string().optional().describe("Tiêu đề, ví dụ VCB vs HPG"),
      series: z
        .array(z.object({ label: z.string().min(1).max(20), values: z.array(z.number()).min(2).max(2000) }))
        .min(2)
        .max(5)
        .optional()
        .describe("2–5 chuỗi cần so (khi không dùng from_calls)"),
      from_calls: z
        .array(z.string().regex(/^r\d+$/))
        .min(1)
        .max(5)
        .optional()
        .describe("Mã rN của kết quả giá; tổng cộng 2–5 chuỗi (một kết quả gộp nhiều mã cũng được)"),
      symbols: z.array(z.string().max(20)).max(5).optional().describe("Chỉ lấy các mã này từ kết quả from_calls, ví dụ [\"FPT\",\"SHB\"]"),
      field: z.string().max(40).optional().describe("Trường số khi dùng from_calls (mặc định giá đóng cửa)"),
      width: z.number().int().min(10).max(80).optional().describe("Số điểm mỗi dòng (mặc định 40)"),
      ymin: z.number().optional().describe("Trục y dưới tùy biến (%); bỏ qua nếu để trống"),
      ymax: z.number().optional().describe("Trục y trên tùy biến (%); cần kèm ymin"),
      times: z.array(z.string()).max(2000).optional().describe("Nhãn trục X theo thời gian"),
      unit: z.string().max(10).optional().describe("Đơn vị hiển thị, ví dụ %"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `chart_compare(${input.from_calls?.join(", ") ?? input.series?.map((s) => s.label).join(" vs ") ?? ""})`,
    async execute(raw) {
      if (raw.ymin !== undefined && raw.ymax !== undefined && raw.ymin >= raw.ymax) throw new Error("ymin phải nhỏ hơn ymax.")
      if ((raw.ymin === undefined) !== (raw.ymax === undefined)) throw new Error("ymin và ymax phải đi cùng nhau.")
      let input = raw as ChartCompareInput & { series: { label: string; values: number[] }[] }
      if (raw.from_calls) {
        // A batch result gives one series per symbol it holds.
        const got = raw.from_calls.flatMap((ref) => extractAllFromRef(ref, { field: raw.field, symbols: raw.symbols }))
        if (got.length < 2) {
          throw new Error(`Chỉ có ${got.length} chuỗi (${got.map((g) => g.symbol ?? g.ref).join(", ")}); cần 2–5. Thêm kết quả giá của mã khác vào from_calls, hoặc vẽ một mã bằng chart_render kind=line.`)
        }
        if (got.length > 5) {
          throw new Error(`Có ${got.length} chuỗi (${got.map((g) => g.symbol ?? g.ref).join(", ")}); tối đa 5. Chọn mã bằng symbols.`)
        }
        const labels = got.map((g) => g.symbol ?? g.ref)
        const longest = got.reduce((a, b) => ((b.series?.length ?? 0) > (a.series?.length ?? 0) ? b : a))
        input = {
          ...raw,
          series: got.map((g, i) => ({ label: labels[i]!.slice(0, 20), values: (g.series ?? []).slice(-2000) })),
          times: longest.times?.slice(-2000),
        }
        const short = input.series.find((s) => s.values.length < 2)
        if (short) throw new Error(`${short.label}: không đủ điểm để so sánh.`)
      } else if (!raw.series) throw new Error("Cần series hoặc from_calls.")
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
  if (bad) throw new Error(`Chuỗi ${bad.label} bắt đầu bằng 0, không tính được % thay đổi.`)
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
    `${input.title ? `${input.title} · ` : ""}% thay đổi từ điểm đầu, cùng thang ${pct(lo)} … ${pct(hi)}:`,
    ...rows,
  ].join("\n")
  return output
}
