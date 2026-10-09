import type { ChartRenderInput } from "./render"

/**
 * Waterfall as cumulative bars on one shared value axis: each step a bar from the
 * previous running total to the next, █ for a positive delta and ░ for a negative
 * one, with the delta and running total after. Start and end rows are │ markers.
 */
export function renderWaterfall(input: ChartRenderInput): { subtitle: string; body: string } {
  const start = input.start
  const deltas = input.series ?? []
  if (start === undefined || Number.isNaN(start)) throw new Error("waterfall cần start (giá trị đầu, ví dụ 57.3).")
  if (deltas.length < 1) throw new Error(`waterfall cần series ít nhất 1 bước (deltas), đang có ${deltas.length}.`)
  const cum = [start]
  for (const d of deltas) cum.push(cum[cum.length - 1]! + d)
  const lo = Math.min(...cum)
  const hi = Math.max(...cum)
  const span = hi - lo || 1
  const fmt = (v: number) => `${Number(v.toFixed(2))}`
  const names = ["Bắt đầu", ...deltas.map((_, i) => input.labels?.[i] ?? `Bước ${i + 1}`), "Kết thúc"]
  const labelWidth = Math.max(...names.map((n) => n.length))
  const W = Math.min(input.width ?? 28, 60)
  const at = (v: number) => Math.round(((v - lo) / span) * (W - 1))
  const pad = (n: number) => " ".repeat(Math.max(0, n))
  const rows: string[] = []
  rows.push(`${names[0]!.padEnd(labelWidth)} ${pad(at(cum[0]!))}│${pad(W - at(cum[0]!))} ${fmt(cum[0]!)}`)
  for (let i = 0; i < deltas.length; i++) {
    const prev = cum[i]!
    const next = cum[i + 1]!
    const a = at(Math.min(prev, next))
    const b = at(Math.max(prev, next))
    const bar = (next >= prev ? "█" : "░").repeat(Math.max(1, b - a))
    const delta = `${deltas[i]! >= 0 ? "+" : ""}${fmt(deltas[i]!)}`
    rows.push(`${names[i + 1]!.padEnd(labelWidth)} ${pad(a)}├${bar}┤${pad(W - b)} ${delta} → ${fmt(next)}`)
  }
  const last = cum[cum.length - 1]!
  rows.push(`${names[names.length - 1]!.padEnd(labelWidth)} ${pad(at(last))}│${pad(W - at(last))} ${fmt(last)}`)
  return {
    subtitle: `waterfall (${deltas.length} bước, ${fmt(start)} → ${fmt(last)})`,
    body: rows.join("\n"),
  }
}
