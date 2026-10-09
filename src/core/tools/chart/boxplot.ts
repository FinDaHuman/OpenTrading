import type { ChartRenderInput } from "./render"

/** Type-7 quantiles (linear interpolation), same default as numpy. */
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1]
  return next === undefined ? sorted[base]! : sorted[base]! + rest * (next - sorted[base]!)
}

const fmt = (v: number) => `${Number(v.toFixed(2))}`

/**
 * Boxplots of several groups on one shared value axis: whiskers ─, box █ with a
 * ◆ median, then min ─ Q1 ─ median ─ Q3 ─ max. Input convention: matrix rows =
 * groups, labels = group names.
 */
export function renderBoxplot(input: ChartRenderInput): { subtitle: string; body: string } {
  const matrix = input.matrix ?? []
  if (matrix.length < 1) throw new Error("boxplot cần matrix (mỗi dòng 1 nhóm).")
  const short = matrix.findIndex((s) => s.length < 4)
  if (short >= 0) throw new Error(`boxplot cần mỗi nhóm ít nhất 4 điểm, nhóm ${input.labels?.[short] ?? `#${short + 1}`} đang có ${matrix[short]!.length}.`)
  const W = Math.min(input.width ?? 26, 60)
  const lo = Math.min(...matrix.flat())
  const hi = Math.max(...matrix.flat())
  const span = hi - lo || 1
  const at = (v: number) => Math.round(((v - lo) / span) * (W - 1))
  const labelWidth = Math.max(...(input.labels ?? [""]).map((l) => l.length), 4)
  const lines = matrix.map((group, i) => {
    const sorted = [...group].sort((a, b) => a - b)
    const s = { min: sorted[0]!, q1: quantile(sorted, 0.25), med: quantile(sorted, 0.5), q3: quantile(sorted, 0.75), max: sorted[sorted.length - 1]! }
    const w0 = at(s.min)
    const b0 = at(s.q1)
    const m = at(s.med)
    const b1 = at(s.q3)
    const w1 = at(s.max)
    let bar = ""
    for (let c = 0; c < W; c++) bar += c === m ? "◆" : c >= b0 && c <= b1 ? "█" : c >= w0 && c <= w1 ? "─" : " "
    return `${(input.labels?.[i] ?? `#${i + 1}`).padEnd(labelWidth)} [${bar}] ${fmt(s.min)} ─ ${fmt(s.q1)} ─ ${fmt(s.med)} ─ ${fmt(s.q3)} ─ ${fmt(s.max)}`
  })
  return {
    subtitle: `boxplot min ─ Q1 ─ median ─ Q3 ─ max (${matrix.length} nhóm)`,
    body: lines.join("\n"),
  }
}
