/**
 * Units for `calculate`: a value is a number in base units plus the dimensions it carries
 * ({đồng: 1, "cổ phiếu": -1} for a price). Adding two values of different dimensions, or
 * converting into a unit of another dimension, is an error: that is the "lệch đơn vị" mistake
 * a model makes by hand (a price in nghìn đồng next to an EPS in đồng, tỷ next to nghìn tỷ).
 *
 * Unit strings are the ones the data server publishes (`units` in the envelope, units.py):
 * "nghìn đồng/cổ phiếu (64,27 = 64.270 đ)", "đồng", "cổ phiếu", "điểm", "%". A bracketed note is
 * dropped; "A/B" divides; "A*B" or "A·B" multiplies; a leading magnitude word scales.
 */

export type Dims = Record<string, number>

export interface Unit {
  /** Base units per one of this unit: 1 tỷ đồng = 1e9 đồng. */
  factor: number
  dims: Dims
}

/** Longest first, so "nghìn tỷ" is not read as "nghìn". */
const MAGNITUDES: [string, number][] = [
  ["nghìn tỷ", 1e12],
  ["ngàn tỷ", 1e12],
  ["triệu tỷ", 1e15],
  ["nghìn", 1e3],
  ["ngàn", 1e3],
  ["triệu", 1e6],
  ["tỷ", 1e9],
  ["tỉ", 1e9],
  ["trăm", 1e2],
  ["k", 1e3],
  ["m", 1e6],
  ["bn", 1e9],
]

/** Names of one base unit, all read as the first. */
const BASES: [string, string[]][] = [
  ["đồng", ["đồng", "đ", "vnd", "vnđ", "dong"]],
  ["cổ phiếu", ["cổ phiếu", "cp", "cổ", "share", "shares"]],
  ["điểm", ["điểm", "point", "points"]],
  ["usd", ["usd", "$", "đô", "đô la"]],
  ["ngày", ["ngày", "day", "days"]],
  ["năm", ["năm", "year", "years"]],
  ["quý", ["quý", "quarter", "quarters"]],
  ["tháng", ["tháng", "month", "months"]],
]

/** Plain numbers: "lần" is a multiple (P/E 12 lần), "%" is a hundredth. */
const DIMENSIONLESS: Record<string, number> = { "": 1, lần: 1, x: 1, "%": 0.01, "điểm %": 0.01, "điểm phần trăm": 0.01, "phần trăm": 0.01, bps: 0.0001 }

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()

function baseOf(word: string): string | undefined {
  for (const [base, names] of BASES) if (names.includes(word)) return base
  return undefined
}

/** One factor of a unit: "tỷ đồng", "cổ phiếu", "%". */
function term(raw: string): Unit {
  const text = norm(raw)
  if (text in DIMENSIONLESS) return { factor: DIMENSIONLESS[text]!, dims: {} }
  for (const [word, scale] of MAGNITUDES) {
    if (text === word) return { factor: scale, dims: {} }
    if (text.startsWith(`${word} `)) {
      const rest = term(text.slice(word.length + 1))
      return { factor: rest.factor * scale, dims: rest.dims }
    }
  }
  const base = baseOf(text)
  if (base) return { factor: 1, dims: { [base]: 1 } }
  // A unit this file does not know still has to match itself: "lượt", "hợp đồng".
  return { factor: 1, dims: { [text]: 1 } }
}

const combine = (a: Dims, b: Dims, sign: 1 | -1): Dims => {
  const out: Dims = { ...a }
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + sign * v
    if (out[k] === 0) delete out[k]
  }
  return out
}

export function parseUnit(raw: string | undefined): Unit {
  if (raw === undefined) return { factor: 1, dims: {} }
  // "nghìn đồng/cổ phiếu (64,27 = 64.270 đ)": the note explains, it is not part of the unit.
  const text = raw.replace(/\([^)]*\)/g, " ").trim()
  const [top = "", ...below] = text.split("/")
  let unit: Unit = { factor: 1, dims: {} }
  for (const part of top.split(/[*·×]/)) {
    const t = term(part)
    unit = { factor: unit.factor * t.factor, dims: combine(unit.dims, t.dims, 1) }
  }
  for (const part of below) {
    const t = term(part)
    unit = { factor: unit.factor / t.factor, dims: combine(unit.dims, t.dims, -1) }
  }
  return unit
}

export const sameDims = (a: Dims, b: Dims) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  return true
}

export const mulDims = (a: Dims, b: Dims) => combine(a, b, 1)
export const divDims = (a: Dims, b: Dims) => combine(a, b, -1)
export const powDims = (a: Dims, n: number): Dims => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v * n]))

/** "đồng/cổ phiếu", "đồng·cổ phiếu", "" for a plain number. */
export function describeDims(dims: Dims): string {
  const fmt = (k: string, v: number) => (Math.abs(v) === 1 ? k : `${k}^${Math.abs(v)}`)
  const top = Object.entries(dims).filter(([, v]) => v > 0).map(([k, v]) => fmt(k, v))
  const bottom = Object.entries(dims).filter(([, v]) => v < 0).map(([k, v]) => fmt(k, v))
  if (top.length === 0 && bottom.length === 0) return ""
  return `${top.join("·") || "1"}${bottom.length ? `/${bottom.join("/")}` : ""}`
}
