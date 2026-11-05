/**
 * Figures of an answer and the numbers of what the harness fetched, for scoring only. The stop
 * gate has its own check, tuned to send back as little as possible; this one counts everything,
 * and keeps a separate list of what it could not read rather than guessing.
 */

export interface Figure {
  /** As written. */
  text: string
  /** Every value it can mean: "16.800" is 16800 in Vietnamese and 16.8 in JSON. */
  values: number[]
  decimals: number
  unit?: "%" | "đ" | "tỷ" | "triệu" | "nghìn" | "lần"
  /** Marked as the model's own arithmetic (prompts/citations.md). */
  derived: boolean
}

const B = String.raw`(?<![\p{L}\p{N}])`
const E = String.raw`(?![\p{L}\p{N}])`
/** "tính từ đầu năm" means "since": a period, not arithmetic. */
const DERIVED = new RegExp(String.raw`${B}(tự tính|tính từ(?!\s+(đầu|đáy|đỉnh|cuối|ngày|năm|tháng|quý|phiên|lúc|khi|thời|\d{1,2}\/)))${E}`, "iu")
const DATES = /(?<![\d.,/-])\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?![\d/-])|(?<![\d.,/])\d{1,2}\/\d{4}(?!\d)|(?<![\d.,:])\d{1,2}:\d{2}(?![\d:])/g
const PERIODS = /\b[QH]\d(?:\/\d{2,4})?\b|\b(?:quý|năm|tháng|phiên|ngày)\s+\d+/giu
const FIGURE = /(?<![\p{L}\d.,])(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+|\d+)(?:\s*(%|đồng|đ(?!\p{L})|nghìn tỷ|tỷ|triệu|nghìn|lần))?/gu
/** A whole number with no unit is usually a count or a heading, not market data. */
const isFigure = (token: string, unit: string | undefined) => unit !== undefined || /[.,]/.test(token)

function readings(token: string) {
  const groups = token.split(/[.,]/)
  const tail = groups.at(-1) ?? ""
  if (groups.length === 1) return { values: [Number(token)], decimals: 0 }
  const decimal = Number(`${groups.slice(0, -1).join("")}.${tail}`)
  const grouped = groups.slice(1).every((g) => g.length === 3)
  return grouped ? { values: [Number(groups.join("")), decimal], decimals: 0 } : { values: [decimal], decimals: tail.length }
}

const unitOf = (raw: string | undefined): Figure["unit"] => {
  if (!raw) return undefined
  if (raw === "đồng" || raw === "đ") return "đ"
  return (raw === "nghìn tỷ" ? "tỷ" : raw) as Figure["unit"]
}

export function answerFigures(text: string): Figure[] {
  const figures: Figure[] = []
  for (const line of text.normalize("NFC").split("\n")) {
    const derived = DERIVED.test(line)
    const plain = line.replace(DATES, " ").replace(PERIODS, " ")
    for (const match of plain.matchAll(FIGURE)) {
      const [whole, token, unit] = match
      if (!token || !isFigure(token, unit)) continue
      const { values, decimals } = readings(token)
      const scaled = unit === "nghìn tỷ" ? values.map((v) => v * 1000) : values
      figures.push({ text: whole.trim(), values: scaled, decimals, unit: unitOf(unit), derived })
    }
  }
  return figures
}

const REF = /^\[ref r\d+\]\s*/

function walk(value: unknown, out: Set<number>) {
  if (typeof value === "number") out.add(value)
  else if (typeof value === "string") {
    const n = Number(value)
    if (value.trim() && Number.isFinite(n)) out.add(n)
  } else if (Array.isArray(value)) for (const item of value) walk(item, out)
  else if (value && typeof value === "object") for (const item of Object.values(value)) walk(item, out)
}

/** The numbers of a tool result. JSON is read as JSON, so `[64.27,64.5]` stays two numbers. */
export function sourceNumbers(text: string): Set<number> {
  const out = new Set<number>()
  const body = text.replace(REF, "")
  const start = body.search(/[[{]/)
  // A notice line may come first, and a capped result does not parse.
  if (start >= 0) {
    try {
      walk(JSON.parse(body.slice(start)), out)
      return out
    } catch {}
  }
  for (const match of body.matchAll(/\d+(?:\.\d+)?(?:,\d{3})*(?:,\d{1,2}(?!\d))?/g)) for (const value of readings(match[0]).values) out.add(value)
  return out
}

/** A tool may give a ratio or thousands where the answer writes a percent or dong. */
const SCALES = [1, 100, 0.01, 1e3, 1e-3, 1e6, 1e-6, 1e9, 1e-9]

/** Whether `figure` is one of `numbers` at a common scale, rounded as the answer writes it. */
export function tracesTo(figure: Figure, numbers: Set<number>) {
  const near = 0.5 * 10 ** -figure.decimals + 1e-9
  for (const value of figure.values) {
    for (const number of numbers) {
      if (SCALES.some((scale) => Math.abs(number * scale - value) <= near)) return true
    }
  }
  return false
}

const UNIT_VALUE: Partial<Record<NonNullable<Figure["unit"]>, number>> = { tỷ: 1e9, triệu: 1e6, nghìn: 1e3 }

/** Every plain value a figure can mean, with its unit applied: "2,5 tỷ" is 2.5e9. */
export const plainValues = (figure: Figure) => figure.values.map((v) => v * (figure.unit ? (UNIT_VALUE[figure.unit] ?? 1) : 1))

/** The prices of a result whose `units` say they are in thousand dong. */
export function thousandDongPrices(text: string): Set<number> {
  const out = new Set<number>()
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(REF, ""))
  } catch {
    return out
  }
  const units = (parsed as { units?: Record<string, unknown> } | null)?.units
  if (!units || typeof units !== "object") return out
  const fields = new Set(
    Object.entries(units)
      .filter(([, unit]) => typeof unit === "string" && unit.startsWith("nghìn đồng"))
      .flatMap(([names]) => names.split(",").map((name) => name.trim())),
  )
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (fields.has(key) && typeof item === "number") out.add(item)
        else visit(item)
      }
    }
  }
  visit((parsed as { data?: unknown }).data)
  return out
}

/**
 * A price copied in thousand dong and written as dong: "62,2 đ" for 62,200 đ, the 1000× error
 * a scale check cannot see, because both readings match.
 */
export function wrongDong(figures: Figure[], prices: Set<number>) {
  // The first reading is how a Vietnamese answer means it: "62.200 đ" is not 62.2.
  return figures.filter((f) => f.unit === "đ" && f.values[0]! < 1000 && prices.has(f.values[0]!))
}
