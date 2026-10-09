import type { ChartRenderInput } from "./render"

/**
 * Multi-slice pie as proportional bars: one row per slice, % of the total, sorted
 * desc. A text pie drawn as fake arcs would be unreadable in the TUI; equal-width
 * proportion bars keep the slice sizes legible (same style as kind=bar).
 */
export function renderPie(input: ChartRenderInput): { subtitle: string; body: string } {
  const series = input.series ?? []
  if (series.length < 2) throw new Error(`pie cần series ít nhất 2 lát, đang có ${series.length}.`)
  const positive = series.filter((v) => v > 0)
  if (positive.length === 0) throw new Error("pie cần ít nhất một lát > 0, đang toàn số ≤ 0.")
  const total = positive.reduce((s, v) => s + v, 0)
  const barMax = Math.min(input.width ?? 24, 60)
  const rows = series
    .map((v, i) => ({ label: input.labels?.[i] ?? `#${i + 1}`, value: v }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((s) => {
      const bar = "█".repeat(Math.max(1, Math.round((s.value / total) * barMax)))
      return `${s.label.padEnd(12)} ${bar} ${((s.value / total) * 100).toFixed(1)}%`
    })
  const skipped = series.length - rows.length
  return {
    subtitle: `pie (${rows.length} lát${skipped ? `, bỏ ${skipped} lát ≤0` : ""}, tổng 100%)`,
    body: rows.join("\n"),
  }
}
