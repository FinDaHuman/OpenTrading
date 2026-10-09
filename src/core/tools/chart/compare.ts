import { z } from "zod"
import { LOCAL_SOURCE, type ToolDef } from "../types"
import type { ChartData } from "./data"

export type ChartCompareInput = {
  title?: string
  series: { label: string; values: number[] }[]
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
 * point on one shared scale, one row per series. Plain text: lines overlaid on one axis
 * cannot be told apart without colour, and colour breaks the TUI (see render.ts).
 */
export function chartCompareTool(): ToolDef<ChartCompareInput> {
  return {
    name: "chart_compare",
    description:
      "So sánh 2–5 chuỗi giá (mã với mã, mã với chỉ số, tài sản với tài sản) theo % thay đổi từ điểm đầu, cùng một thang, mỗi chuỗi một dòng. Chuỗi có thể dài ngắn khác nhau (căn theo điểm cuối). Dùng sau khi đã có dữ liệu giá; một chuỗi thì dùng chart_render kind=line.",
    input: z.object({
      title: z.string().optional().describe("Tiêu đề, ví dụ VCB vs HPG"),
      series: z
        .array(z.object({ label: z.string().min(1).max(20), values: z.array(z.number()).min(2).max(2000) }))
        .min(2)
        .max(5)
        .describe("2–5 chuỗi cần so"),
      width: z.number().int().min(10).max(80).optional().describe("Số điểm mỗi dòng (mặc định 40)"),
      ymin: z.number().optional().describe("Trục y dưới tùy biến (%); bỏ qua nếu để trống"),
      ymax: z.number().optional().describe("Trục y trên tùy biến (%); cần kèm ymin"),
      times: z.array(z.string()).max(2000).optional().describe("Nhãn trục X theo thời gian"),
      unit: z.string().max(10).optional().describe("Đơn vị hiển thị, ví dụ %"),
    }),
    readOnly: true,
    deferrable: true,
    source: LOCAL_SOURCE,
    summarize: (input) => `chart_compare(${input.series.map((s) => s.label).join(" vs ")})`,
    async execute(input) {
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
      const chart: ChartData = {
        kind: "compare",
        ...(input.title ? { title: input.title } : {}),
        series: input.series,
        ...(input.ymin !== undefined && input.ymax !== undefined ? { domain: [input.ymin, input.ymax] as [number, number] } : {}),
        ...(input.times ? { times: input.times } : {}),
        ...(input.unit ? { unit: input.unit } : {}),
      }
      return { output, chart }
    },
  }
}
