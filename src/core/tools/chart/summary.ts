import { periodChange, type ChartData } from "./data"

const fmt = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 })
const n = (v: number) => fmt.format(v)
const signed = (p: number) => `${p >= 0 ? "+" : ""}${n(p)}%`
const pct = (from: number, to: number) => {
  const p = periodChange(from, to)
  return p === undefined ? "" : ` (${signed(p)} over the period)`
}
const span = (times?: string[]) => (times && times.length > 1 ? ` ${times[0]}→${times[times.length - 1]}` : "")
const compact = (v: number) => (Math.abs(v) >= 1e9 ? `${n(v / 1e9)}B` : Math.abs(v) >= 1e6 ? `${n(v / 1e6)}M` : Math.abs(v) >= 1e3 ? `${n(v / 1e3)}K` : n(v))

function stats(series: number[]) {
  return { first: series[0]!, last: series[series.length - 1]!, min: Math.min(...series), max: Math.max(...series) }
}

/**
 * What the model reads after drawing: a few numbers it can quote, not the picture. The
 * coloured chart is shown in the TUI; ASCII art cost 1–3k tokens per chart, stayed in history,
 * and did not even match the TUI picture (different sampling and bins).
 */
export function summarizeChart(data: ChartData, from?: string): string {
  const who = "symbol" in data && data.symbol ? `${data.symbol} ` : ""
  const unit = data.unit ? ` ${data.unit}` : ""
  const src = from ? ` (numbers taken from ${from})` : ""
  const tail = " The colour chart is already shown in the TUI: comment on it, do not copy the picture."
  switch (data.kind) {
    case "candlestick": {
      const b = data.bars
      if (b.length === 0) return `No candles to draw.${src}`
      // Close to close, like chart_compare: the same data must never show two different %.
      const first = b[0]!.c
      const last = b[b.length - 1]!.c
      const hi = Math.max(...b.map((x) => x.h))
      const lo = Math.min(...b.map((x) => x.l))
      const vols = b.map((x) => x.v).filter((v): v is number => v !== undefined)
      const vol = vols.length > 0 ? `, KL TB ${compact(vols.reduce((a, c) => a + c, 0) / vols.length)}` : ""
      return `Drew candles ${who}${b.length} sessions${span(data.times)}${src}: last close ${n(last)}${unit}${pct(first, last)}, high ${n(hi)}, low ${n(lo)}${vol}.${tail}`
    }
    case "line":
    case "area":
    case "sparkline":
    case "linebox":
    case "sparkcolumn":
    case "histogram":
    case "winloss": {
      const s = data.series
      if (s.length === 0) return `No numbers to draw.${src}`
      const st = stats(s)
      const times = "times" in data ? data.times : undefined
      return `Drew ${data.kind} ${who}${s.length} points${span(times)}${src}: first ${n(st.first)}, last ${n(st.last)}${unit}${pct(st.first, st.last)}, low ${n(st.min)}, high ${n(st.max)}.${tail}`
    }
    case "bar":
    case "pie": {
      const rows = data.series.map((v, i) => ({ v, label: data.labels?.[i] ?? `#${i + 1}` }))
      const top = [...rows].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5)
      return `Drew ${data.kind} ${who}${rows.length} items${src}; largest: ${top.map((r) => `${r.label} ${n(r.v)}${unit}`).join(", ")}.${tail}`
    }
    case "compare": {
      const change = (v: number[]) => {
        const p = periodChange(v[0]!, v[v.length - 1]!)
        return p === undefined ? "?" : signed(p)
      }
      const parts = data.series.map((s) => `${s.label} ${change(s.values)}`)
      return `Drew a % change comparison${span(data.times)}${src}: ${parts.join(", ")}.${tail}`
    }
    case "depth":
      return `Drew the order book ${who}${data.bids.length} bid levels, ${data.asks.length} ask levels${src}.${tail}`
    case "gauge":
    case "donut":
      return `Drew ${data.kind} ${who}${n(data.value)}/${n(data.max)}${unit}${src}.${tail}`
    case "waterfall": {
      const end = data.series.reduce((a, c) => a + c, data.start)
      return `Drew waterfall ${who}from ${n(data.start)} to ${n(end)}${unit} over ${data.series.length} steps${src}.${tail}`
    }
    case "scatter":
      return `Drew scatter ${who}${data.points.length} points${src}.${tail}`
    default:
      return `Drew ${data.kind} ${who}${data.matrix.length}×${data.matrix[0]?.length ?? 0}${src}.${tail}`
  }
}
