import type { ChartRenderInput } from "./render"

/** One distinct marker per series; series drawn in order, later ones overwrite. */
const MULTI_CHARS = ["●", "◆", "▲", "■", "★"]

const fmt = (v: number) => `${Number(v.toFixed(1))}`

/**
 * Several series on ONE axes: each series a different marker char (colour cannot
 * tell lines apart in the TUI, and the lib's multi-line uses the same braille char
 * for every series), segments filled between consecutive points, legend after.
 * Input convention: matrix rows = series, labels = series names.
 */
export function renderMultiline(input: ChartRenderInput): { subtitle: string; body: string } {
  const matrix = input.matrix ?? []
  if (matrix.length < 2) throw new Error(`multiline cần matrix ít nhất 2 dòng (mỗi dòng 1 series), đang có ${matrix.length}.`)
  if (matrix.some((s) => s.length < 2)) throw new Error("multiline cần mỗi series ít nhất 2 điểm.")
  const W = Math.min(input.width ?? 56, 120 - 14)
  const H = Math.min(input.height ?? 10, 40)
  const all = matrix.flat()
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const span = hi - lo || 1
  const grid: string[][] = Array.from({ length: H }, () => Array<string>(W).fill(" "))
  for (let s = 0; s < matrix.length; s++) {
    const ch = MULTI_CHARS[s % MULTI_CHARS.length]!
    const vals = matrix[s]!
    let prevCol = -1
    let prevRow = -1
    for (let t = 0; t < vals.length; t++) {
      const col = Math.round((t / (vals.length - 1)) * (W - 1))
      const row = Math.round((1 - (vals[t]! - lo) / span) * (H - 1))
      if (prevCol >= 0 && col > prevCol) {
        for (let c = prevCol + 1; c <= col; c++) {
          const f = (c - prevCol) / (col - prevCol)
          grid[Math.round(prevRow + f * (row - prevRow))]![c] = ch
        }
      }
      grid[row]![col] = ch
      prevCol = col
      prevRow = row
    }
  }
  const lw = Math.max(`${fmt(lo)}`.length, `${fmt(hi)}`.length) + 1
  const pad = " ".repeat(lw)
  const lines: string[] = []
  for (let r = 0; r < H; r++) {
    const edge = r === 0 ? `${fmt(hi)}┤` : r === H - 1 ? `${fmt(lo)}┤` : `${pad}│`
    lines.push(`${edge.padStart(lw + 1)}${grid[r]!.join("")}`)
  }
  lines.push(`${pad}└${"─".repeat(W)}`)
  const legend = matrix
    .map((s, i) => {
      const last = s[s.length - 1]!
      return `${MULTI_CHARS[i % MULTI_CHARS.length]} ${input.labels?.[i] ?? `#${i + 1}`} ${fmt(last)}`
    })
    .join("  ")
  lines.push(legend)
  return {
    subtitle: `multiline (${matrix.length} series, ${Math.max(...matrix.map((s) => s.length))} điểm, trục ${fmt(lo)} … ${fmt(hi)})`,
    body: lines.join("\n"),
  }
}
