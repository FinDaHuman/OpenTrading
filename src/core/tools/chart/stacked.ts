import type { ChartRenderInput } from "./render"

/** One shade per stack component, cycling: rows use █ ▓ ▒ ░ in that order. */
const SHADES = ["█", "▓", "▒", "░"]

/**
 * Stacked bars: matrix rows = groups (one row each), columns = components summed
 * into the bar; shades tell the components apart (colour cannot). Input convention
 * matches kind=heatmap: labels = row names then column names.
 */
export function renderStacked(input: ChartRenderInput): { subtitle: string; body: string } {
  const matrix = input.matrix ?? []
  const n = matrix[0]?.length ?? 0
  if (matrix.some((row) => row.length !== n)) throw new Error("stacked cần các hàng cùng số cột.")
  if (n < 2) throw new Error("stacked cần mỗi nhóm ít nhất 2 thành phần.")
  const rows = input.labels?.slice(0, matrix.length)
  const cols = input.labels?.slice(matrix.length, matrix.length + n)
  const barW = Math.min(input.width ?? 30, 60)
  const lines = matrix.map((row, i) => {
    const total = row.reduce((s, v) => s + Math.max(0, v), 0)
    if (total <= 0) throw new Error(`Nhóm ${rows?.[i] ?? `#${i + 1}`} toàn số ≤ 0, không xếp được.`)
    let bar = ""
    for (let c = 0; c < n; c++) bar += SHADES[c % SHADES.length]!.repeat(Math.round((Math.max(0, row[c]!) / total) * barW))
    return `${(rows?.[i] ?? `#${i + 1}`).padEnd(12)} ${bar} ${Number(total.toFixed(2))}`
  })
  const legend = cols?.length === n ? cols.map((l, c) => `${SHADES[c % SHADES.length]} ${l}`).join("  ") : ""
  const out = legend ? [...lines, legend] : lines
  return {
    subtitle: `stacked (${matrix.length} nhóm x ${n} thành phần)`,
    body: out.join("\n"),
  }
}
