/**
 * Structured chart payload the TUI renders as a coloured chart box.
 *
 * Core never imports UI code: this is plain JSON, consumed by
 * src/tui/ui/chart-box.tsx. The model only ever sees the text `output`
 * (see modelOutput in registry.ts), so carrying this costs zero tokens.
 */
export type ChartBar = { o: number; h: number; l: number; c: number; v?: number }
export type ChartPoint = { x: number; y: number }
export type ChartLevel = { price: number; volume: number }

export type ChartData =
  | { kind: "candlestick"; symbol?: string; bars: ChartBar[]; times?: string[]; unit?: string }
  | { kind: "line" | "area" | "sparkline" | "linebox"; symbol?: string; series: number[]; times?: string[]; unit?: string }
  | { kind: "sparkcolumn"; symbol?: string; series: number[]; dirs?: boolean[]; unit?: string }
  | { kind: "bar" | "pie" | "winloss" | "histogram"; symbol?: string; series: number[]; labels?: string[]; unit?: string }
  | { kind: "heatmap" | "multiline" | "stacked" | "boxplot"; symbol?: string; matrix: number[][]; labels?: string[]; times?: string[]; unit?: string }
  | { kind: "waterfall"; symbol?: string; start: number; series: number[]; labels?: string[]; unit?: string }
  | { kind: "scatter"; symbol?: string; points: ChartPoint[]; groups?: number[]; labels?: string[]; unit?: string }
  | { kind: "gauge" | "donut"; symbol?: string; value: number; max: number; unit?: string }
  | { kind: "compare"; title?: string; series: { label: string; values: number[] }[]; domain?: [number, number]; times?: string[]; unit?: string }
  | { kind: "depth"; symbol?: string; bids: ChartLevel[]; asks: ChartLevel[]; depth?: number; unit?: string }
