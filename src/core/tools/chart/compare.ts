import { z } from "zod"
import { FIN_COLORS } from "./render"
import type { ToolDef } from "../types"

type AnsiColor = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray"

export type ChartCompareInput = {
  title?: string
  series: { label: string; values: number[] }[]
  width?: number
  height?: number
  color?: "auto" | "always" | "never"
}

/**
 * So sánh nhiều chuỗi giá trên cùng 1 trục (VCB vs HPG vs VNINDEX...).
 * Data do MCP tools cung cấp — tool này chỉ render overlay + legend.
 */
export function chartCompareTool(): ToolDef<ChartCompareInput> {
  return {
    name: "chart_compare",
    description:
      "Vẽ nhiều đường giá chồng nhau để so sánh (tối đa 5 chuỗi, mỗi chuỗi ≥2 điểm, độ dài có thể khác nhau — chuỗi ngắn được căn phải). Dùng khi so VCB vs HPG, mã vs index, tài sản vs tài sản (compare_assets/compare_equities). Không dùng cho 1 chuỗi duy nhất (dùng chart_render kind=line).",
    input: z.object({
      title: z.string().optional().describe("Tiêu đề, ví dụ VCB vs HPG"),
      series: z
        .array(z.object({ label: z.string(), values: z.array(z.number()).min(2) }))
        .min(2)
        .max(5)
        .describe("2-5 chuỗi cần so"),
      width: z.number().int().min(20).max(200).optional(),
      height: z.number().int().min(5).max(40).optional(),
      color: z.enum(["auto", "always", "never"]).optional(),
    }),
    readOnly: true,
    summarize: (input) =>
      `chart_compare(${(input as ChartCompareInput).series.map((s) => s.label).join(" vs ")})`,
    async execute(input) {
      if (input.series.length < 2) throw new Error("chart_compare cần 2-5 chuỗi; 1 chuỗi dùng chart_render kind=line.")
      if (input.series.length > 5) throw new Error("chart_compare tối đa 5 chuỗi.")
      const lib = await import("@crafter/charts")
      const useColor = (input.color ?? "auto") !== "never"
      const width = Math.min(Math.max(input.width ?? 64, 20), 200)
      const height = Math.min(Math.max(input.height ?? 10, 5), 40)
      const palette = FIN_COLORS.compare as readonly string[]
      const maxLen = Math.max(...input.series.map((s) => s.values.length))
      // Chuẩn hóa % thay đổi từ điểm đầu để so được các thang giá khác nhau.
      const rows = Array.from({ length: maxLen }, (_, t) => {
        const row: Record<string, number> = { t }
        for (const s of input.series) {
          const pad = maxLen - s.values.length
          const v = s.values[t - pad]
          const base = s.values[0]!
          if (v !== undefined && base !== 0) row[s.label] = ((v - base) / Math.abs(base)) * 100
        }
        return row
      })
      let builder = lib.chart({ width, height }).data(rows, { xKey: "t" })
      input.series.forEach((s, i) => {
        builder = builder.line({
          key: s.label,
          label: s.label,
          ...(useColor ? { color: palette[i % palette.length] as AnsiColor } : {}),
        })
      })
      const chart = useColor ? lib.renderToAnsi(builder.yAxis()) : lib.renderToString(builder.yAxis())
      return `${input.title ? input.title + " · " : ""}so sánh % thay đổi từ điểm đầu (${input.series.length} chuỗi):\n${chart}`
    },
  }
}
