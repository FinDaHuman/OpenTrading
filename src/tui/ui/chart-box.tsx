import { createMemo, For } from "solid-js"
import { chart, renderToString } from "@crafter/charts"
import type { RGBA } from "@opentui/core"
import type { ChartBar, ChartData, ChartPoint } from "../../core/tools/chart/data"
import { color, mix } from "../theme"

/**
 * A chart the TUI paints itself in theme colours (never ANSI, which would break
 * the markdown transcript): up candles/bars are bảng-giá green (tăng), down ones
 * red (giảm) — the Vietnamese price-board convention.
 */
type Cell = { ch: string; fg: string; bg?: string | RGBA }
type TitleRun = { text: string; fg?: string }
type Grid = Cell[][]

const AXIS = color.tx3
const UP = color.tang
const DOWN = color.giam
/**
 * Categorical colours for series, cycled. Not the price-board green/red: two tickers drawn
 * in tăng/giảm colours read as "one up, one down".
 */
const SERIES_COLORS = [color.san, color.tham, color.tran, "#6FA8FF", "#F59E5B", "#9AE6B4", color.tx2]

/** Labels from other sources may be NFD (decomposed accents): one glyph must be one cell. */
const nfc = (text: string | undefined) => text?.normalize("NFC")

/** At most this many legend / list rows per chart; the rest is summed into one row. */
const MAX_ROWS_LIST = 12

/**
 * Chuẩn khớp trục X giữa mọi chart time-series (antvis skill: line/area format
 * {time, value} — trục X time luôn có): cột ┤/│ CỐ ĐỊNH ở AXIS_COL, plot rộng
 * PLOT_W cố định, nên ngày/giờ thẳng hàng khi so sánh các chart.
 */
export const AXIS_COL = 7
export const plotW = (width: number) => Math.min(64, Math.max(24, width - 12))

/** Evenly spaced samples, first and last kept, so long data fits the width. */
function sample<T>(values: T[], width: number): T[] {
  if (values.length <= width) return values
  return Array.from({ length: width }, (_, i) => values[Math.round((i * (values.length - 1)) / (width - 1))]!)
}

const fmt1 = (v: number) => `${Number(v.toFixed(1))}`
const fmt2 = (v: number) => `${Number(v.toFixed(2))}`
const fmt = fmt2

/** Trục Y cố định: ┤/│ luôn ở cột AXIS_COL để mọi chart thẳng hàng. */
function fixedAxis(grid: Grid, hi: string, lo: string): Grid {
  return grid.map((cells, r) => {
    const edge = r === 0 ? `${hi}┤` : r === grid.length - 1 ? `${lo}┤` : "│"
    const label = edge.length > AXIS_COL + 1 ? edge.slice(-(AXIS_COL + 1)) : edge.padStart(AXIS_COL + 1)
    return [...[...label].map((ch) => ({ ch, fg: AXIS })), ...cells]
  })
}

/** Hàng trục X: ngày đầu trái, ngày cuối phải, cùng độ rộng plot. */
/**
 * Trục X: đường ngang + chấm từng điểm thời gian + nhãn ngày.
 * pointCols = cột plot (0-based) của từng điểm. Ngày đầu/dưới điểm đầu,
 * ngày cuối canh phải; chật thì quay dọc.
 */
function xAxis(first: string, last: string, plotCols: number, pointCols: number[]): Cell[][] {
  const right = AXIS_COL + 1 + plotCols
  const blank = () => Array.from({ length: right }, () => ({ ch: " ", fg: color.tx }) as Cell)
  const axis: Cell[] = blank()
  axis[AXIS_COL] = { ch: "└", fg: AXIS }
  for (let c = 0; c < plotCols; c++) axis[AXIS_COL + 1 + c] = { ch: "─", fg: AXIS }
  const seen = new Set<number>()
  for (const p of pointCols) {
    const c = AXIS_COL + 1 + Math.max(0, Math.min(plotCols - 1, p))
    if (!seen.has(c)) {
      seen.add(c)
      axis[c] = { ch: "●", fg: AXIS }
    }
  }
  const rows: Cell[][] = [axis]
  const c0 = AXIS_COL + 1 + (pointCols[0] ?? 0)
  const cl = AXIS_COL + 1 + (pointCols[pointCols.length - 1] ?? plotCols - 1)
  let lastStart = cl
  if (cl + last.length > right) lastStart = right - last.length
  if (c0 + first.length + 1 >= lastStart) {
    const H = Math.max(first.length, last.length)
    for (let r = 0; r < H; r++) {
      const row = blank()
      if (r < first.length) row[c0] = { ch: first[r]!, fg: AXIS }
      if (r < last.length) row[cl] = { ch: last[r]!, fg: AXIS }
      rows.push(row)
    }
    return rows
  }
  const row = blank()
  ;[...first].forEach((ch, i) => (row[c0 + i] = { ch, fg: AXIS }))
  ;[...last].forEach((ch, i) => (row[lastStart + i] = { ch, fg: AXIS }))
  rows.push(row)
  return rows
}

function xAxisRow(first: string, last: string, plotCols: number, n: number): Cell[][] {
  const cols = n <= 1 ? [0] : Array.from({ length: n }, (_, i) => Math.round((i * (plotCols - 1)) / (n - 1)))
  return xAxis(first, last, plotCols, cols)
}

/** Dời grid lib (marker ┤/│ ở markerCol) sao cho marker về AXIS_COL, pad đủ rộng. */
function alignGrid(cells: Cell[][], markerCol: number, totalCols: number): Grid {
  const shift = AXIS_COL - markerCol
  return cells.map((row) => {
    let r = shift >= 0 ? [...Array<Cell>(shift).fill({ ch: " ", fg: color.tx }), ...row] : row.slice(-shift)
    while (r.length < totalCols) r = [...r, { ch: " ", fg: color.tx }]
    return r.slice(0, totalCols)
  })
}

type Dataset = { rows: Record<string, number>[]; xKey: string; key: string; mark: "line" | "scatter" }

/**
 * Plotext-class smoothness without Python: render each dataset alone on one shared
 * domain (the library draws smooth braille), then merge cells — last non-space wins,
 * each dataset in its own colour, the shared axis stays gray.
 * W = plot columns (không tính gutter); grid ra luôn rộng AXIS_COL+1+W, marker ở AXIS_COL.
 */
function smoothMarks(datasets: Dataset[], colors: string[], plotCols: number, H: number, domain: [number, number]): Grid {
  const W = AXIS_COL + 1 + plotCols
  const renders = datasets.map((d) => {
    const b = chart({ width: W, height: H }).data(d.rows, { xKey: d.xKey }).yDomain(domain)
    return renderToString(d.mark === "line" ? b.line({ key: d.key }) : b.scatter({ key: d.key })).split("\n")
  })
  const R = Math.max(...renders.map((r) => r.length))
  const C = Math.max(0, ...renders.map((r) => Math.max(0, ...r.map((l) => l.length))))
  const at = (rr: string[], r: number, c: number) => rr[r]?.[c] ?? " "
  // Plot area starts right of the y-axis marker (┤ on labelled rows, │ elsewhere).
  const markerCol = markerColOf(renders[0] ?? [])
  const grid: Grid = []
  for (let r = 0; r < R; r++) {
    const row: Cell[] = []
    for (let c = 0; c < C; c++) {
      if (c <= markerCol) {
        row.push({ ch: at(renders[0]!, r, c), fg: AXIS })
        continue
      }
      let ch = " "
      let owner = -1
      for (let s = 0; s < renders.length; s++) {
        const x = at(renders[s]!, r, c)
        if (x !== " ") {
          ch = x
          owner = s
        }
      }
      row.push({ ch, fg: owner < 0 ? color.tx : (colors[owner % colors.length] ?? color.tx) })
    }
    grid.push(row)
  }
  return alignGrid(grid, markerCol, W)
}

type Built = { title: TitleRun[]; grid: Grid }

const fmtCompact = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : `${v}`

/** Hàng X dưới chart nến: nhãn tại CỘT NẾN tương ứng (khớp). */
function xLabels(dates: (string | undefined)[], cols: number[], plotCols: number): Cell[][] {
  return xAxis(dates[0] ?? "1", dates[dates.length - 1] ?? `${dates.length}`, plotCols, cols)
}

/**
 * Fit `bars` into `slots` columns by merging neighbours like a longer timeframe would
 * (open of the first, highest high, lowest low, close of the last, summed volume).
 * Picking every n-th bar instead dropped the highs and lows of the skipped ones.
 */
export function resampleBars(bars: ChartBar[], times: (string | undefined)[], slots: number) {
  if (bars.length <= slots) return bars.map((b, i) => ({ b, t: times[i] }))
  return Array.from({ length: slots }, (_, k) => {
    const from = Math.floor((k * bars.length) / slots)
    const to = Math.floor(((k + 1) * bars.length) / slots)
    const group = bars.slice(from, Math.max(to, from + 1))
    const vols = group.map((g) => g.v).filter((v): v is number => v !== undefined)
    const b: ChartBar = {
      o: group[0]!.o,
      h: Math.max(...group.map((g) => g.h)),
      l: Math.min(...group.map((g) => g.l)),
      c: group[group.length - 1]!.c,
      ...(vols.length > 0 ? { v: vols.reduce((a, v) => a + v, 0) } : {}),
    }
    return { b, t: times[Math.max(to, from + 1) - 1] }
  })
}

function candles(bars: ChartBar[], symbol: string | undefined, width: number, times?: string[]): Built {
  const H = 12
  const all = bars.flatMap((b) => [b.o, b.h, b.l, b.c])
  const dlo = Math.min(...all)
  const dhi = Math.max(...all)
  const dspan = dhi - dlo || 1
  // Chuẩn TradingView (lightweight-charts scaleMargins mặc định): top 0.2, bottom 0.1.
  const lo = dlo - 0.1 * dspan
  const hi = dhi + 0.2 * dspan
  const span = hi - lo || 1
  const PW = plotW(width)
  const zipped = resampleBars(bars, times ?? [], Math.max(2, Math.floor(PW / 2)))
  const cs = zipped.map((z) => z.b)
  const n = cs.length
  // Nến compact dính liền: mỗi nến 2 cột (thân + khoảng) — trục X khớp theo cột nến.
  const colOf = (i: number) => 2 * i
  const rowOf = (v: number) => Math.round((1 - (v - lo) / span) * (H - 1))
  const grid: Grid = Array.from({ length: H }, () => Array.from({ length: PW }, () => ({ ch: " ", fg: color.tx }) as Cell))
  cs.forEach((b, i) => {
    const fg = b.c >= b.o ? UP : DOWN
    const c = colOf(i)
    const top = Math.min(rowOf(b.o), rowOf(b.c))
    const bot = Math.max(rowOf(b.o), rowOf(b.c))
    const wTop = rowOf(b.h)
    const wBot = rowOf(b.l)
    for (let r = 0; r < H; r++) {
      const ch = r >= top && r <= bot ? "█" : r >= wTop && r <= wBot ? "│" : " "
      if (ch !== " ") grid[r]![c] = { ch, fg }
    }
  })
  const first = bars[0]!
  const last = bars[bars.length - 1]!
  const pct = ((last.c - first.o) / Math.abs(first.o || 1)) * 100
  const dir = last.c >= first.o ? UP : DOWN
  // Row 0 is `hi` and the last row `lo` (the padded range), so those are the labels.
  const axised = fixedAxis(grid, fmt1(hi), fmt1(lo))
  // Volume pane riêng dưới giá (chuẩn TV): nhỏ, cùng cột nến, màu theo hướng nến.
  const vols = cs.map((b) => b.v ?? 0)
  const hasVol = vols.some((v) => v > 0)
  if (hasVol) {
    const VH = 4
    const maxV = Math.max(...vols)
    for (let r = 0; r < VH; r++) {
      const row: Cell[] = Array.from({ length: AXIS_COL + 1 }, () => ({ ch: " ", fg: color.tx }))
      const cells: Cell[] = Array.from({ length: PW }, () => ({ ch: " ", fg: color.tx }))
      cs.forEach((b, i) => {
        const level = ((b.v ?? 0) / (maxV || 1)) * VH
        const full = Math.floor(level)
        const fromBottom = VH - 1 - r
        const ch = fromBottom < full ? "█" : fromBottom === full && level - full >= 0.5 ? "▄" : " "
        if (ch !== " ") cells[colOf(i)] = { ch, fg: b.c >= b.o ? UP : DOWN }
      })
      axised.push([...row, ...cells])
    }
  }
  // Trục X khớp cột nến: ngày đầu dưới nến đầu, ngày cuối dưới nến cuối; dài thì quay dọc.
  axised.push(...xLabels(zipped.map((z) => z.t), cs.map((_, i) => colOf(i)), PW))
  const title: TitleRun[] = [
    { text: `${symbol ? `${symbol} · ` : ""}nến ${bars.length} phiên${n < bars.length ? ` (gộp ${n} cột)` : ""} · ${fmt2(last.c)} ` },
    { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, fg: dir },
  ]
  if (hasVol) title.push({ text: ` · Vol ${fmtCompact(bars.reduce((s, b) => s + (b.v ?? 0), 0))}` })
  return { title, grid: axised }
}

function area(series: number[], symbol: string | undefined, width: number, times?: string[]): Built {
  // Đường bo góc (ký tự box ╭╮╰╯) + fill mờ dưới đường.
  const PW = plotW(width)
  const H = 10
  const trend = series[series.length - 1]! >= series[0]! ? UP : DOWN
  const rows = series.map((c, t) => ({ t, c }))
  const text = renderToString(chart({ width: AXIS_COL + 1 + PW, height: H, charset: "box" }).data(rows, { xKey: "t" }).line({ key: "c" }).yAxis())
  const lines = text.split("\n")
  const markerCol = markerColOf(lines)
  const fill = mix(trend, color.bg, 0.8)
  const raw: Grid = lines.map((l) => [...l].map((ch, c) => ({ ch, fg: c <= markerCol || ch === " " ? AXIS : trend })))
  const grid = alignGrid(raw, markerCol, AXIS_COL + 1 + PW)
  // Fill đủ: cột không có nét thì nội suy từ lân cận (tránh lỗ hổng).
  const tops: number[] = []
  for (let c = AXIS_COL + 1; c < grid[0]!.length; c++) {
    let top = -1
    for (let r = 0; r < grid.length; r++) {
      if (grid[r]![c]!.fg === trend) {
        top = r
        break
      }
    }
    tops[c] = top
  }
  const cols = grid[0]!.length
  for (let c = AXIS_COL + 1; c < cols; c++) {
    if (tops[c]! < 0) {
      let l = c - 1
      while (l > AXIS_COL && tops[l]! < 0) l--
      let r = c + 1
      while (r < cols && tops[r]! < 0) r++
      const tl = l > AXIS_COL ? tops[l]! : -1
      const tr = r < cols ? tops[r]! : -1
      tops[c] = tl < 0 ? tr : tr < 0 ? tl : Math.min(tl, tr)
    }
  }
  for (let c = AXIS_COL + 1; c < cols; c++) {
    const top = tops[c]!
    if (top < 0) continue
    for (let r = top + 1; r < grid.length; r++) {
      const cell = grid[r]![c]!
      if (cell.ch === " ") cell.bg = fill
    }
  }
  grid.push(...xAxisRow(times?.[0] ?? "1", times?.[times.length - 1] ?? `${series.length}`, PW, series.length))
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}area (${series.length} điểm)` }],
    grid,
  }
}

function line(series: number[], symbol: string | undefined, width: number, label: string, times?: string[]): Built {
  const PW = plotW(width)
  const H = 10
  const dlo = Math.min(...series)
  const dhi = Math.max(...series)
  const dspan = dhi - dlo || 1
  // Padding kiểu TradingView: top 0.2, bottom 0.1.
  const lo = dlo - 0.1 * dspan
  const hi = dhi + 0.2 * dspan
  const trend = series[series.length - 1]! >= series[0]! ? UP : DOWN
  const rows = series.map((c, t) => ({ t, c }))
  const grid = smoothMarks([{ rows, xKey: "t", key: "c", mark: "line" }], [trend], PW, H, [lo, hi])
  grid.push(...xAxisRow(times?.[0] ?? "1", times?.[times.length - 1] ?? `${series.length}`, PW, series.length))
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}${label} (${series.length} điểm)` }],
    grid,
  }
}

function multi(matrix: number[][], labels: string[] | undefined, symbol: string | undefined, width: number, times?: string[]): Built {
  const PW = plotW(width)
  const H = 10
  const all = matrix.flat()
  const dlo = Math.min(...all)
  const dhi = Math.max(...all)
  const dspan = dhi - dlo || 1
  const lo = dlo - 0.1 * dspan
  const hi = dhi + 0.2 * dspan
  const datasets = matrix.map((vals) => ({ rows: vals.map((c, t) => ({ t, c })), xKey: "t", key: "c", mark: "line" as const }))
  const grid = smoothMarks(datasets, SERIES_COLORS, PW, H, [lo, hi])
  const n = Math.max(...matrix.map((s) => s.length))
  grid.push(...xAxisRow(times?.[0] ?? "1", times?.[times.length - 1] ?? `${n}`, PW, n))
  const legend: Cell[] = []
  matrix.forEach((s, i) => {
    const fg = SERIES_COLORS[i % SERIES_COLORS.length]!
    const run = `● ${labels?.[i] ?? `#${i + 1}`} ${fmt1(s[s.length - 1]!)}  `
    for (const ch of run) legend.push({ ch, fg })
  })
  grid.push(legend)
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}multiline (${matrix.length} series, trục ${fmt1(dlo)} … ${fmt1(dhi)})` }],
    grid,
  }
}

/** Braille dots: dy 0..3 (top-down) → hàng bit [01/08, 02/10, 04/20, 40/80] cho dx 0/1. */
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

/**
 * Scatter vẽ tay trên canvas braille (lib không có xDomain nên overlay lệch):
 * domain X+Y chung toàn bộ groups, mỗi group 1 màu + legend (antvis skill: group field).
 */
function scatterPlot(points: ChartPoint[], groups: number[] | undefined, labels: string[] | undefined, symbol: string | undefined, width: number): Built {
  const PW = plotW(width)
  const H = 10
  const Wpx = PW * 2
  const Hpx = H * 4
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xlo = Math.min(...xs)
  const xhi = Math.max(...xs)
  const ylo = Math.min(...ys)
  const yhi = Math.max(...ys)
  const xspan = xhi - xlo || 1
  const yspan = yhi - ylo || 1
  const gcount = Math.max(1, ...points.map((_, i) => (groups?.[i] ?? 0) + 1))
  const bits: number[][] = Array.from({ length: H }, () => Array<number>(PW).fill(0))
  const owner: number[][] = Array.from({ length: H }, () => Array<number>(PW).fill(-1))
  points.forEach((p, i) => {
    const g = groups?.[i] ?? 0
    const px = Math.min(Wpx - 1, Math.max(0, Math.round(((p.x - xlo) / xspan) * (Wpx - 1))))
    const py = Math.min(Hpx - 1, Math.max(0, Math.round((1 - (p.y - ylo) / yspan) * (Hpx - 1))))
    const cx = Math.floor(px / 2)
    const cy = Math.floor(py / 4)
    bits[cy]![cx]! |= BRAILLE_BITS[py % 4]![px % 2]!
    owner[cy]![cx] = g
  })
  const grid: Grid = bits.map((row, r) =>
    row.map((b, c) => {
      const g = owner[r]![c]!
      return b === 0 ? { ch: " ", fg: color.tx } : { ch: String.fromCharCode(0x2800 + b), fg: SERIES_COLORS[g % SERIES_COLORS.length]! }
    }),
  )
  const axised = fixedAxis(grid, fmt1(yhi), fmt1(ylo))
  axised.push(...xAxis(fmtCompact(xlo), fmtCompact(xhi), PW, points.map((p) => Math.round(((p.x - xlo) / xspan) * (PW - 1)))))
  for (let g = 0; g < gcount; g++) {
    const fg = SERIES_COLORS[g % SERIES_COLORS.length]!
    const row: Cell[] = [{ ch: "●", fg }, { ch: " ", fg: color.tx }]
    for (const ch of `${labels?.[g] ?? `#${g + 1}`} (${points.filter((_, i) => (groups?.[i] ?? 0) === g).length} điểm)  `) row.push({ ch, fg })
    axised.push(row)
  }
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}scatter (${points.length} điểm, ${gcount} nhóm)` }],
    grid: axised,
  }
}

function bars(series: number[], labels: string[] | undefined, symbol: string | undefined, width: number, label: string): Built {
  const MAX_ROWS = 30
  const cut = series.length > MAX_ROWS
  const idx = sample(series.map((_, i) => i), MAX_ROWS)
  // Diverging: âm TRÁI, dương PHẢI, vạch 0 ở giữa.
  const maxPos = Math.max(1e-9, ...series.map((v) => Math.max(0, v)))
  const maxNeg = Math.max(1e-9, ...series.map((v) => Math.max(0, -v)))
  const half = Math.max(4, Math.floor(Math.min(30, width - 30) / 2))
  const maxAbs = Math.max(maxPos, maxNeg)
  const barCells = (v: number): Cell[] => {
    const fg = v >= 0 ? UP : DOWN
    // Bar bị cap để chừa chỗ cho số sát thanh — gốc 0 không bao giờ lệch.
    const numLen = fmt2(v).length
    const leftLen = v < 0 ? Math.max(1, Math.min(Math.round((-v / maxAbs) * half), half - numLen - 1)) : 0
    const rightLen = v >= 0 ? Math.max(1, Math.round((v / maxAbs) * half)) : 0
    const num = fmt2(v)
    const cells: Cell[] = []
    if (v < 0) {
      // Chung gốc 0 (│ cùng cột mọi dòng) + số ngay sát thanh (như bên dương):
      // [pad][số][bar][│] — nửa trái đúng `half` ký tự.
      const padLen = Math.max(0, half - leftLen - num.length - 1)
      for (let k = 0; k < padLen; k++) cells.push({ ch: " ", fg: color.tx })
      for (const ch of num) cells.push({ ch, fg })
      cells.push({ ch: " ", fg: color.tx })
      for (let k = 0; k < leftLen; k++) cells.push({ ch: "█", fg })
      cells.push({ ch: "│", fg: AXIS })
      for (let k = 0; k < half; k++) cells.push({ ch: " ", fg: color.tx })
    } else {
      for (let k = 0; k < half; k++) cells.push({ ch: " ", fg: color.tx })
      cells.push({ ch: "│", fg: AXIS })
      for (let k = 0; k < rightLen; k++) cells.push({ ch: "█", fg })
      cells.push({ ch: " ", fg: color.tx })
      for (const ch of num) cells.push({ ch, fg: color.tx })
    }
    return cells
  }
  const { grid, breaks } = labeledBlocks(
    idx.map((i) => ({ label: labels?.[i] ?? `#${i + 1}`, content: () => barCells(series[i]!) })),
    16,
  )
  if (cut) grid.push([{ ch: `… +${series.length - MAX_ROWS} dòng (thu gọn)`, fg: AXIS }].flatMap((c) => [...c.ch].map((ch) => ({ ch, fg: c.fg }))))
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}${label} (${series.length} dòng${cut ? `, hiện ${MAX_ROWS}` : ""}; ` }, { text: "◀ âm", fg: DOWN }, { text: " │ ", fg: AXIS }, { text: "dương ▶", fg: UP }, { text: ")" }],
    grid: borderedRuled(grid, breaks),
  }
}

/** Viền đen (rule) quanh một khối dòng. */
function bordered(grid: Grid): Grid {
  const W = Math.max(1, ...grid.map((r) => r.length))
  const frame = color.rule
  const out: Grid = [[{ ch: "┌", fg: frame }, ...Array.from({ length: W }, () => ({ ch: "─", fg: frame })), { ch: "┐", fg: frame }]]
  for (const row of grid) {
    const pad = W - row.length
    out.push([{ ch: "│", fg: frame }, ...row, ...Array.from({ length: pad }, () => ({ ch: " ", fg: color.tx })), { ch: "│", fg: frame }])
  }
  out.push([{ ch: "└", fg: frame }, ...Array.from({ length: W }, () => ({ ch: "─", fg: frame })), { ch: "┘", fg: frame }])
  return out
}

/** Ngắt nhãn dài thành nhiều dòng (ưu tiên khoảng trắng) để hiện FULL tên. */
function wrapLabel(name: string, w: number): string[] {
  const words = name.replace(/\s+/g, " ").trim().split(" ")
  const lines: string[] = []
  let cur = ""
  const pushChunks = (s: string) => {
    for (let i = 0; i < s.length; i += w) lines.push(s.slice(i, i + w))
  }
  for (const wd of words) {
    if (!wd) continue
    if (!cur) {
      if (wd.length <= w) cur = wd
      else pushChunks(wd)
    } else if ((cur + " " + wd).length <= w) {
      cur += " " + wd
    } else {
      lines.push(cur)
      if (wd.length <= w) cur = wd
      else {
        pushChunks(wd)
        cur = ""
      }
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [""]
}

/** Viền đen + vạch ngăn giữa các khối dòng (breaks = chỉ số dòng đặt vạch TRƯỚC nó). */
function borderedRuled(grid: Grid, breaks: Set<number>): Grid {
  const W = Math.max(1, ...grid.map((r) => r.length))
  const frame = color.rule
  const div = (): Cell[] => [{ ch: "├", fg: frame }, ...Array.from({ length: W }, () => ({ ch: "─", fg: frame })), { ch: "┤", fg: frame }]
  const out: Grid = [[{ ch: "┌", fg: frame }, ...Array.from({ length: W }, () => ({ ch: "─", fg: frame })), { ch: "┐", fg: frame }]]
  grid.forEach((row, i) => {
    if (breaks.has(i)) out.push(div())
    const pad = W - row.length
    out.push([{ ch: "│", fg: frame }, ...row, ...Array.from({ length: pad }, () => ({ ch: " ", fg: color.tx })), { ch: "│", fg: frame }])
  })
  out.push([{ ch: "└", fg: frame }, ...Array.from({ length: W }, () => ({ ch: "─", fg: frame })), { ch: "┘", fg: frame }])
  return out
}

/**
 * Các khối dòng có nhãn: nhãn wrap nhiều dòng, TẤT CẢ khối cao bằng nhau
 * (= khối cao nhất), nội dung canh giữa dọc. Trả grid + vị trí vạch ngăn.
 */
function labeledBlocks(items: { label: string; content: () => Cell[] }[], labelW: number): { grid: Grid; breaks: Set<number> } {
  const wrapped = items.map((it) => wrapLabel(it.label, labelW))
  const rowH = Math.max(1, ...wrapped.map((w) => w.length))
  const mid = Math.floor(rowH / 2)
  const grid: Grid = []
  const breaks = new Set<number>()
  items.forEach((it, k) => {
    if (grid.length > 0) breaks.add(grid.length)
    const lines = wrapped[k]!
    for (let r = 0; r < rowH; r++) {
      const row: Cell[] = [...(lines[r] ?? "").padEnd(labelW), " "].map((ch) => ({ ch, fg: color.tx }))
      if (r === mid) row.push(...it.content())
      grid.push(row)
    }
  })
  return { grid, breaks }
}

function fallback(kind: string): Built {
  return { title: [{ text: `Loại chart "${kind}" chưa có bản màu — đang dùng bản text.` }], grid: [] }
}

function markerColOf(lines: string[]): number {
  for (const l of lines) {
    const i = l.indexOf("┤")
    if (i >= 0) return i
  }
  for (const l of lines) {
    const i = l.indexOf("│")
    if (i >= 0) return i
  }
  return -1
}

/** Paint a library text render: axis gray, plot cells in one colour, aligned FIXED. */
function paintLib(text: string, plotFg: string, plotCols: number): Grid {
  const lines = text.split("\n")
  const markerCol = markerColOf(lines)
  const raw = lines.map((l) => [...l].map((ch, c) => ({ ch, fg: c <= markerCol || ch === " " ? AXIS : plotFg })))
  return alignGrid(raw, markerCol, AXIS_COL + 1 + plotCols)
}

function linebox(series: number[], symbol: string | undefined, width: number, times?: string[]): Built {
  const PW = plotW(width)
  const rows = series.map((c, t) => ({ t, c }))
  const text = renderToString(chart({ width: AXIS_COL + 1 + PW, height: 10, charset: "box" }).data(rows, { xKey: "t" }).line({ key: "c" }).yAxis())
  const trend = series[series.length - 1]! >= series[0]! ? UP : DOWN
  const grid = paintLib(text, trend, PW)
  grid.push(...xAxisRow(times?.[0] ?? "1", times?.[times.length - 1] ?? `${series.length}`, PW, series.length))
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}linebox (${series.length} điểm)` }],
    grid,
  }
}

function spark(series: number[], symbol: string | undefined, label: string, width: number, times?: string[]): Built {
  // Sparkline là ĐƯỜNG mini mượt (braille), không phải dải khối.
  const PW = Math.min(60, plotW(width))
  const H = 4
  const lo = Math.min(...series)
  const hi = Math.max(...series)
  const trend = series[series.length - 1]! >= series[0]! ? UP : DOWN
  const rows = series.map((c, t) => ({ t, c }))
  const grid = smoothMarks([{ rows, xKey: "t", key: "c", mark: "line" }], [trend], PW, H, [lo, hi])
  grid.push(...xAxisRow(times?.[0] ?? "1", times?.[times.length - 1] ?? `${series.length}`, PW, series.length))
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}${label} (${series.length} điểm)` }],
    grid,
  }
}

function sparkColumn(series: number[], symbol: string | undefined, dirs?: boolean[]): Built {
  // Cột cao 6 dòng: đầy █, đỉnh lẻ dùng ▄. Màu theo hướng giá (dirs) nếu có,
  // không thì theo dấu — volume luôn dương nên cần dirs mới có đỏ.
  const H = 6
  const maxAbs = Math.max(1e-9, ...series.map((v) => Math.abs(v)))
  const grid: Grid = Array.from({ length: H }, () => [])
  series.forEach((v, i) => {
    const level = (Math.abs(v) / maxAbs) * H
    const full = Math.floor(level)
    const fg = dirs ? (dirs[i] ? UP : DOWN) : v >= 0 ? UP : DOWN
    for (let r = 0; r < H; r++) {
      const fromBottom = H - 1 - r
      const ch = fromBottom < full ? "█" : fromBottom === full && level - full >= 0.5 ? "▄" : " "
      grid[r]!.push({ ch, fg: ch === " " ? color.tx : fg })
    }
  })
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}sparkcolumn (${series.length} điểm)` }],
    grid,
  }
}

/** Bo góc/viền bằng mật độ phủ: ô đặc █, viền mờ dần ▓▒░. */

/**
 * Pie TRÒN thật: rasterize hình tròn, mỗi cell tính góc → lát nào, màu lát đó.
 * Cell terminal cao gấp đôi rộng nên rx ≈ 2×ry để tròn.
 */
/**
 * Tỷ trọng dạng THANH 100% (thay pie tròn khó đọc): một thanh ngang chia
 * segment theo %, mỗi lát 1 màu + legend đầy đủ.
 */
function pieBar(series: number[], labels: string[] | undefined, symbol: string | undefined, width: number, sortDesc = true, grayFrom = -1): Built {
  let rows = series
    .map((v, i) => ({ label: nfc(labels?.[i]) ?? `#${i + 1}`, value: v, fg: i >= grayFrom && grayFrom >= 0 ? AXIS : SERIES_COLORS[i % SERIES_COLORS.length]! }))
    .filter((s) => s.value > 0)
  if (sortDesc) rows.sort((a, b) => b.value - a.value)
  if (rows.length > MAX_ROWS_LIST) {
    const rest = rows.slice(MAX_ROWS_LIST - 1)
    rows = [...rows.slice(0, MAX_ROWS_LIST - 1), { label: `${rest.length} mục khác`, value: rest.reduce((a, r) => a + r.value, 0), fg: AXIS }]
  }
  const total = rows.reduce((s, r) => s + r.value, 0)
  const barW = Math.min(48, Math.max(20, width - 12))
  const lens = rows.map((s) => Math.max(1, Math.round((s.value / total) * barW)))
  lens[0] = Math.max(1, lens[0]! + (barW - lens.reduce((a, b) => a + b, 0)))
  const bar: Cell[] = []
  rows.forEach((s, i) => {
    for (let k = 0; k < lens[i]!; k++) bar.push({ ch: "█", fg: s.fg })
  })
  // Dòng trống ngăn cách thanh chart với legend.
  const grid: Grid = [bar, []]
  const { grid: legGrid } = labeledBlocks(
    rows.map((s) => ({
      label: `${s.label} ${((s.value / total) * 100).toFixed(1)}%`,
      content: () => [{ ch: "█", fg: s.fg }],
    })),
    24,
  )
  // Hộp màu lên đầu dòng (đọc legend từ trái như cũ).
  for (const row of legGrid) {
    const box = row.pop()
    if (box) row.unshift(box, { ch: " ", fg: color.tx })
  }
  grid.push(...legGrid)
  void width
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}pie (${rows.length} lát, tổng 100%)` }],
    grid,
  }
}

/** Donut kiểu thanh tỷ lệ (giống pie): phần đạt xanh + phần còn lại xám + legend. */
function donutBar(value: number, max: number, symbol: string | undefined, width: number): Built {
  const rest = Math.max(0, max - value)
  // Giữ thứ tự [đạt, còn lại], lát "còn lại" tô xám.
  const built = pieBar([value, rest], [symbol ?? "đạt", "còn lại"], symbol, width, false, 1)
  built.title = [{ text: `${symbol ? `${symbol} · ` : ""}donut ${fmt(value)}/${fmt(max)}` }]
  return built
}

function waterfall(start: number, deltas: number[], labels: string[] | undefined, symbol: string | undefined): Built {
  const cum = [start]
  for (const d of deltas) cum.push(cum[cum.length - 1]! + d)
  const lo = Math.min(...cum)
  const hi = Math.max(...cum)
  const span = hi - lo || 1
  const names = ["Bắt đầu", ...deltas.map((_, i) => labels?.[i] ?? `Bước ${i + 1}`), "Kết thúc"]
  const W = 28
  const at = (v: number) => Math.round(((v - lo) / span) * (W - 1))
  const pad = (n: number) => " ".repeat(Math.max(0, n))
  const barOf = (idx: number): Cell[] => {
    // idx 0 = Bắt đầu, 1..deltas.length = bước, cuối = Kết thúc.
    const cells: Cell[] = []
    if (idx === 0 || idx === deltas.length + 1) {
      const v = idx === 0 ? cum[0]! : cum[cum.length - 1]!
      for (const ch of `${pad(at(v))}│${pad(W - at(v))} ${fmt(v)}`) cells.push({ ch, fg: color.tx })
    } else {
      const i = idx - 1
      const prev = cum[i]!
      const next = cum[i + 1]!
      const a = at(Math.min(prev, next))
      const b = at(Math.max(prev, next))
      const fg = next >= prev ? UP : DOWN
      for (const ch of pad(a)) cells.push({ ch, fg: color.tx })
      cells.push({ ch: "├", fg })
      for (let k = 0; k < Math.max(1, b - a); k++) cells.push({ ch: "█", fg })
      cells.push({ ch: "┤", fg })
      for (const ch of pad(W - b)) cells.push({ ch, fg: color.tx })
      cells.push({ ch: " ", fg: color.tx })
      for (const ch of `${deltas[i]! >= 0 ? "+" : ""}${fmt(deltas[i]!)} → ${fmt(next)}`) cells.push({ ch, fg: color.tx })
    }
    return cells
  }
  const { grid } = labeledBlocks(
    names.map((name, idx) => ({ label: name, content: () => barOf(idx) })),
    14,
  )
  // Giữ dòng trống giãn cách giữa các bước (đã duyệt).
  const spaced: Grid = []
  const blockH = Math.max(1, Math.ceil(grid.length / names.length))
  names.forEach((_, k) => {
    spaced.push(...grid.slice(k * blockH, (k + 1) * blockH))
    if (k < names.length - 1) spaced.push([])
  })
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}waterfall (${deltas.length} bước, ${fmt(start)} → ${fmt(cum[cum.length - 1]!)})` }],
    grid: spaced,
  }
}

function stacked(matrix: number[][], labels: string[] | undefined, symbol: string | undefined, width: number): Built {
  const n = matrix[0]!.length
  const rows = labels?.slice(0, matrix.length)
  const cols = labels?.slice(matrix.length, matrix.length + n)
  const barW = Math.min(30, Math.max(10, width - 30))
  const { grid } = labeledBlocks(
    matrix.map((row, i) => ({
      label: rows?.[i] ?? `#${i + 1}`,
      content: () => {
        const total = row.reduce((s, v) => s + Math.max(0, v), 0)
        const cells: Cell[] = []
        for (let c = 0; c < n; c++) {
          const fg = SERIES_COLORS[c % SERIES_COLORS.length]!
          const len = Math.round((Math.max(0, row[c]!) / (total || 1)) * barW)
          for (let k = 0; k < len; k++) cells.push({ ch: "█", fg })
        }
        cells.push({ ch: " ", fg: color.tx })
        for (const ch of `${fmt(total)}`) cells.push({ ch, fg: color.tx })
        return cells
      },
    })),
    14,
  )
  if (cols?.length === n) {
    const legend: Cell[] = []
    cols.forEach((l, c) => {
      const fg = SERIES_COLORS[c % SERIES_COLORS.length]!
      legend.push({ ch: "█", fg }, { ch: " ", fg: color.tx })
      for (const ch of `${l}  `) legend.push({ ch, fg })
    })
    grid.push(legend)
  }
  void width
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}stacked (${matrix.length} nhóm x ${n} thành phần)` }],
    grid,
  }
}

function boxplot(matrix: number[][], labels: string[] | undefined, symbol: string | undefined, width: number): Built {
  const W = 26
  const lo = Math.min(...matrix.flat())
  const hi = Math.max(...matrix.flat())
  const span = hi - lo || 1
  const at = (v: number) => Math.round(((v - lo) / span) * (W - 1))
  const q = (sorted: number[], p: number) => {
    const pos = (sorted.length - 1) * p
    const base = Math.floor(pos)
    const rest = pos - base
    const next = sorted[base + 1]
    return next === undefined ? sorted[base]! : sorted[base]! + rest * (next - sorted[base]!)
  }
  const lw = Math.max(...(labels ?? [""]).map((l) => l.length), 4)
  const grid: Grid = []
  matrix.forEach((group, i) => {
    const sorted = [...group].sort((a, b) => a - b)
    const s = { min: sorted[0]!, q1: q(sorted, 0.25), med: q(sorted, 0.5), q3: q(sorted, 0.75), max: sorted[sorted.length - 1]! }
    const fg = SERIES_COLORS[i % SERIES_COLORS.length]!
    const w0 = at(s.min)
    const b0 = at(s.q1)
    const m = at(s.med)
    const b1 = at(s.q3)
    const w1 = at(s.max)
    const name = (labels?.[i] ?? `#${i + 1}`).padEnd(lw)
    const cellAt = (c: number, mid: boolean): Cell => {
      // Median là đường dọc xuyên box (chuẩn boxplot) + legend giải thích dưới.
      if (c === m) return { ch: "┃", fg: color.tx }
      if (c >= b0 && c <= b1) return { ch: "█", fg }
      if (mid && c >= w0 && c <= w1) return { ch: "─", fg: AXIS }
      return { ch: " ", fg: color.tx }
    }
    // Box cao 3 dòng cho rõ: râu chỉ ở dòng giữa (có mũ │ hai đầu), box đầy cả 3 dòng.
    for (let r = 0; r < 3; r++) {
      const mid = r === 1
      const prefix = mid ? `${name} ` : " ".repeat(name.length + 1)
      const row: Cell[] = [...prefix].map((ch) => ({ ch, fg: color.tx }))
      for (let c = 0; c < W; c++) row.push(cellAt(c, mid))
      if (mid) {
        const off = prefix.length
        row[off + w0] = { ch: "│", fg: AXIS }
        row[off + w1] = { ch: "│", fg: AXIS }
        row.push({ ch: " ", fg: color.tx })
        for (const ch of `${fmt(s.min)} ─ ${fmt(s.q1)} ─ ${fmt(s.med)} ─ ${fmt(s.q3)} ─ ${fmt(s.max)}`) row.push({ ch, fg: color.tx })
      }
      grid.push(row)
    }
    grid.push([])
  })
  void width
  const legend: Cell[] = [{ ch: "┃", fg: color.tx }, { ch: " ", fg: color.tx }]
  for (const ch of "median (trung vị)  ") legend.push({ ch, fg: color.tx })
  legend.push({ ch: "█", fg: SERIES_COLORS[0]! }, { ch: " ", fg: color.tx })
  for (const ch of "box Q1–Q3") legend.push({ ch, fg: color.tx })
  grid.push(legend)
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}boxplot min ─ Q1 ─ median ─ Q3 ─ max (${matrix.length} nhóm)` }],
    grid,
  }
}

function heatmap(matrix: number[][], labels: string[] | undefined, symbol: string | undefined): Built {
  const n = matrix[0]!.length
  const rows = labels?.slice(0, matrix.length)
  const cols = labels?.slice(matrix.length, matrix.length + n)
  const all = matrix.flat()
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const span = hi - lo || 1
  const diverging = lo < 0 && hi > 0
  const maxAbs = Math.max(Math.abs(lo), Math.abs(hi)) || 1
  const cellW = Math.max(6, ...all.map((v) => fmt(v).length)) + 2
  const grid: Grid = []
  const rowLabelW = Math.max(4, ...(rows ?? []).map((l) => l.length))
  if (cols?.length === n) {
    const head: Cell[] = [...`${" ".repeat(rowLabelW)} `].map((ch) => ({ ch, fg: color.tx }))
    for (const l of cols) {
      const name = l.length > cellW ? `${l.slice(0, cellW - 1)}…` : l.padStart(cellW)
      for (const ch of name) head.push({ ch, fg: AXIS })
    }
    grid.push(head)
  }
  matrix.forEach((row, i) => {
    const cells: Cell[] = [...(rows?.[i] ?? `#${i + 1}`).padEnd(rowLabelW)].map((ch) => ({ ch, fg: color.tx }))
    cells.push({ ch: " ", fg: color.tx })
    for (const v of row) {
      // Values on both sides of 0 (a correlation matrix): neutral at 0, red below, green
      // above. One-signed data keeps the low→high ramp.
      const t = diverging ? Math.abs(v) / maxAbs : (v - lo) / span
      const bg = diverging ? mix(color.panel2, v < 0 ? color.giam : color.tang, t) : mix(color.san, color.giam, t)
      const fg = t > 0.55 ? color.bg : color.tx
      const text = fmt(v).padStart(cellW)
      for (const ch of text) cells.push({ ch, fg, bg })
    }
    grid.push(cells)
  })
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}heatmap (${matrix.length}x${n})` }],
    grid,
  }
}

function gauge(value: number, max: number, unit: string | undefined, symbol: string | undefined, label: string, width: number): Built {
  const ratio = Math.max(0, Math.min(1, value / max))
  const fg = ratio < 0.3 ? DOWN : ratio < 0.7 ? color.tham : UP
  const barW = Math.min(30, Math.max(10, width - 24))
  const filled = Math.round(ratio * barW)
  const cells: Cell[] = []
  for (let i = 0; i < filled; i++) cells.push({ ch: "█", fg })
  for (let i = filled; i < barW; i++) cells.push({ ch: "░", fg: AXIS })
  cells.push({ ch: " ", fg: color.tx })
  for (const ch of `${fmt(value)}${unit ?? ""}`) cells.push({ ch, fg })
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}${label}` }],
    grid: [cells],
  }
}

function winloss(series: number[], symbol: string | undefined, width = 80): Built {
  const up = series.filter((v) => v >= 0).length
  if (series.length > MAX_ROWS_LIST) {
    // Long runs: one ▲/▼ per session, wrapped to the width, instead of one row each.
    const per = Math.max(10, width - 4)
    const grid: Grid = []
    for (let i = 0; i < series.length; i += per) {
      grid.push(series.slice(i, i + per).map((v) => ({ ch: v >= 0 ? "▲" : "▼", fg: v >= 0 ? UP : DOWN })))
    }
    return { title: [{ text: `${symbol ? `${symbol} · ` : ""}thắng/thua (${up} thắng, ${series.length - up} thua)` }], grid }
  }
  const grid: Grid = series.map((v, i) => {
    const win = v >= 0
    const cells: Cell[] = [...`Phiên ${i + 1}  `].map((ch) => ({ ch, fg: color.tx }))
    cells.push({ ch: win ? "▲" : "▼", fg: win ? UP : DOWN }, { ch: " ", fg: color.tx })
    for (const ch of win ? "thắng" : "thua") cells.push({ ch, fg: win ? UP : DOWN })
    cells.push({ ch: " ", fg: color.tx })
    for (const ch of `${win ? "+" : ""}${fmt2(v)}`) cells.push({ ch, fg: win ? UP : DOWN })
    return cells
  })
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}thắng/thua (${up} thắng, ${series.length - up} thua)` }],
    grid,
  }
}

function histogram(series: number[], symbol: string | undefined, width: number): Built {
  // Số bins tự động (Sturges, 4–12): ít bins trống, dễ đọc.
  const BINS = Math.min(12, Math.max(4, Math.ceil(Math.log2(series.length)) + 1))
  const lo = Math.min(...series)
  const hi = Math.max(...series)
  const span = hi - lo || 1
  const bins = Array<number>(BINS).fill(0)
  for (const v of series) bins[Math.min(BINS - 1, Math.floor(((v - lo) / span) * BINS))]!++
  const max = Math.max(...bins)
  const barW = Math.min(24, Math.max(8, width - 30))
  const { grid, breaks } = labeledBlocks(
    bins.map((count, i) => {
      const a = lo + (span * i) / BINS
      return {
        label: `${fmt(a)}–${fmt(lo + (span * (i + 1)) / BINS)}`,
        content: () => {
          const cells: Cell[] = []
          for (let k = 0; k < Math.max(count > 0 ? 1 : 0, Math.round((count / (max || 1)) * barW)); k++) cells.push({ ch: "█", fg: color.san })
          cells.push({ ch: " ", fg: color.tx })
          for (const ch of `${count}`) cells.push({ ch, fg: color.tx })
          return cells
        },
      }
    }),
    16,
  )
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}phân phối (${series.length} điểm, ${BINS} khoảng)` }],
    grid: borderedRuled(grid, breaks),
  }
}

function compare(series: { label: string; values: number[] }[], title: string | undefined, width: number, domain?: [number, number], times?: string[]): Built {
  const changes = series.map((s) => s.values.map((v) => ((v - s.values[0]!) / Math.abs(s.values[0]!)) * 100))
  const longest = Math.max(...changes.map((c) => c.length))
  const lo = domain?.[0] ?? Math.min(...changes.flat())
  const hi = domain?.[1] ?? Math.max(...changes.flat())
  // Dải rộng hơn cho đỡ xẹp + dòng trống giữa các mã.
  const cols = Math.min(56, Math.max(20, width - 30))
  const lw = Math.max(...series.map((s) => s.label.length))
  // Gutter trái thống nhất = max(label, trục Y) để plot và trục X thẳng hàng.
  const gut = Math.max(lw + 1, AXIS_COL + 1)
  const padL = (n: number): Cell[] => Array.from({ length: n }, () => ({ ch: " ", fg: color.tx }))
  const grid: Grid = []
  series.forEach((s, i) => {
    const fg = SERIES_COLORS[i % SERIES_COLORS.length]!
    const vals = changes[i]!
    // Mỗi mã cao 9 dòng braille (trục y gấp 3) + GIỮ trục Y riêng của từng chart.
    const SH = 9
    // A shorter series covers only the right part of the plot, so the last points line up
    // (as the tool description and the text twin promise).
    const own = Math.max(2, Math.round((cols * vals.length) / longest))
    const raw = smoothMarks(
      [{ rows: vals.map((c, t) => ({ t, c })), xKey: "t", key: "c", mark: "line" }],
      [fg],
      own,
      SH,
      [lo, hi],
    )
    const mini = raw.map((row) => [...row.slice(0, AXIS_COL + 1), ...padL(cols - own), ...row.slice(AXIS_COL + 1)])
    const last = vals[vals.length - 1]!
    const head: Cell[] = [{ ch: "●", fg }, { ch: " ", fg: color.tx }]
    for (const ch of `${s.label} ${last >= 0 ? "+" : ""}${last.toFixed(1)}%`) head.push({ ch, fg })
    grid.push([...head, ...padL(Math.max(0, gut + cols - head.length))])
    for (let r = 0; r < SH; r++) {
      // mini đã align marker ở AXIS_COL; pad trái nếu label dài hơn gutter.
      grid.push([...padL(gut - (AXIS_COL + 1)), ...mini[r]!])
    }
    if (i < series.length - 1) grid.push([])
  })
  const m = Math.max(...series.map((s) => s.values.length))
  const t0 = times?.[0] ?? "1"
  const t1 = times?.[times.length - 1] ?? `${m}`
  const pts = m <= 1 ? [0] : Array.from({ length: m }, (_, k) => Math.round((k * (cols - 1)) / (m - 1)))
  const ax: Cell[] = [...padL(gut), { ch: "└", fg: AXIS }]
  for (let c = 0; c < cols; c++) ax.push({ ch: "─", fg: AXIS })
  {
    const seen = new Set<number>()
    for (const p of pts) {
      const c = gut + 1 + Math.max(0, Math.min(cols - 1, p))
      if (!seen.has(c)) {
        seen.add(c)
        ax[c] = { ch: "●", fg: AXIS }
      }
    }
  }
  grid.push(ax)
  {
    const row: Cell[] = [...padL(gut + 1 + cols)]
    const right = gut + 1 + cols
    const s0 = gut + 1 + (pts[0] ?? 0)
    let s1 = gut + 1 + (pts[pts.length - 1] ?? cols - 1)
    if (s1 + t1.length > right) s1 = right - t1.length
    ;[...t0].forEach((ch, k) => (row[s0 + k] = { ch, fg: AXIS }))
    ;[...t1].forEach((ch, k) => (row[s1 + k] = { ch, fg: AXIS }))
    grid.push(row)
  }
  void width
  const dom = `thang ${lo.toFixed(1)} … ${hi.toFixed(1)}%${domain ? " (tùy biến)" : ""}`
  return {
    title: [{ text: `${title ? `${title} · ` : ""}% thay đổi từ điểm đầu, ${dom}` }],
    grid,
  }
}

function depth(bids: { price: number; volume: number }[], asks: { price: number; volume: number }[], symbol: string | undefined, levels: number): Built {
  const top = Math.max(1, levels)
  const bs = [...bids].sort((a, b) => b.price - a.price).slice(0, top)
  const as = [...asks].sort((a, b) => a.price - b.price).slice(0, top)
  const maxVol = Math.max(1, ...bs.map((b) => b.volume), ...as.map((a) => a.volume))
  const barW = 16
  const grid: Grid = []
  const row = (side: string, price: number, vol: number, fg: string): Cell[] => {
    const cells: Cell[] = [...`${side} ${price.toFixed(2).padStart(10)} `].map((ch) => ({ ch, fg: color.tx }))
    for (let k = 0; k < Math.max(1, Math.round((vol / maxVol) * barW)); k++) cells.push({ ch: "█", fg })
    cells.push({ ch: " ", fg: color.tx })
    for (const ch of `${vol}`) cells.push({ ch, fg: color.tx })
    return cells
  }
  for (const a of [...as].reverse()) grid.push(row("ASK", a.price, a.volume, DOWN))
  grid.push([...`──────────── giữa ────────────`].map((ch) => ({ ch, fg: AXIS })))
  for (const b of bs) grid.push(row("BID", b.price, b.volume, UP))
  return {
    title: [{ text: `${symbol ? `${symbol} · ` : ""}sổ lệnh (top ${top})` }],
    grid,
  }
}

/** Build coloured title + grid rows for one ChartData. */
export function buildChart(data: ChartData, width: number): Built {
  const built = buildChartInner(data, width)
  // Đơn vị hiển thị ở mọi chart (trừ gauge/donut đã nhúng unit trong số).
  const unit = (data as { unit?: string }).unit
  if (unit && data.kind !== "gauge" && data.kind !== "donut") {
    built.title = [...built.title, { text: ` [${unit}]` }]
  }
  return built
}

function buildChartInner(data: ChartData, width: number): Built {
  switch (data.kind) {
    case "candlestick":
      return candles(data.bars, data.symbol, width, data.times)
    case "line":
      return line(data.series, data.symbol, width, "line", data.times)
    case "area":
      return area(data.series, data.symbol, width, data.times)
    case "multiline":
      return multi(data.matrix, data.labels, data.symbol, width, data.times)
    case "scatter":
      return scatterPlot(data.points, data.groups, data.labels, data.symbol, width)
    case "bar": {
      const b = bars(data.series, data.labels, data.symbol, width - 4, "bar")
      return { title: b.title, grid: b.grid }
    }
    case "pie":
      return pieBar(data.series, data.labels, data.symbol, width)
    case "waterfall":
      return waterfall(data.start, data.series, data.labels, data.symbol)
    case "stacked":
      return stacked(data.matrix, data.labels, data.symbol, width)
    case "boxplot":
      return boxplot(data.matrix, data.labels, data.symbol, width)
    case "heatmap":
      return heatmap(data.matrix, data.labels, data.symbol)
    case "gauge":
      return gauge(data.value, data.max, data.unit, data.symbol, "gauge", width)
    case "donut":
      return donutBar(data.value, data.max, data.symbol, width)
    case "winloss":
      return winloss(data.series, data.symbol, width)
    case "histogram": {
      const h = histogram(data.series, data.symbol, width)
      return { title: h.title, grid: h.grid }
    }
    case "sparkline":
      return spark(data.series, data.symbol, "sparkline", width, data.times)
    case "sparkcolumn":
      return sparkColumn(data.series, data.symbol, data.dirs)
    case "linebox":
      return linebox(data.series, data.symbol, width, data.times)
    case "compare":
      return compare(data.series, data.title, width, data.domain, data.times)
    case "depth": {
      const d = depth(data.bids, data.asks, data.symbol, data.depth ?? 5)
      return { title: d.title, grid: bordered(d.grid) }
    }
    default:
      return fallback((data as { kind: string }).kind)
  }
}

export function ChartBox(props: { data: ChartData; width: number }) {
  // Built once per data/width change (it was rebuilt twice per render, for every chart on resize).
  const built = createMemo(() => buildChart(props.data, props.width))
  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <text wrapMode="none">
        <For each={built().title}>{(run) => <span style={run.fg ? { fg: run.fg } : {}}>{run.text}</span>}</For>
      </text>
      <For each={built().grid}>
        {(cells) => (
          <text wrapMode="none">
            <For each={cells}>{(c) => <span style={{ fg: c.fg, ...(c.bg !== undefined ? { bg: c.bg } : {}) }}>{c.ch}</span>}</For>
          </text>
        )}
      </For>
    </box>
  )
}
