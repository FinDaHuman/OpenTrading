/**
 * Figures of an answer and the numbers of what the harness fetched: the eval scorer, the stop
 * gate and the per-turn measure all read them the same way.
 */

export interface Figure {
  /** As written. */
  text: string
  /** Every value it can mean: "16.800" is 16800 in Vietnamese and 16.8 in JSON. */
  values: number[]
  /** Decimals of each reading, in `values` order: "57.000" read as 57 was written to 3 places. */
  decimals: number[]
  /** What the written number was multiplied by to get `values` ("nghìn tỷ" is read in tỷ: 1000). */
  scale?: number
  unit?: "%" | "đ" | "tỷ" | "triệu" | "nghìn" | "lần"
  /** Marked as the model's own arithmetic (prompts/citations.md). */
  derived: boolean
  /** The line it stands on: a label can ask for the figure of one row. */
  line: string
}

const B = String.raw`(?<![\p{L}\p{N}])`
const E = String.raw`(?![\p{L}\p{N}])`
/** "tính từ đầu năm" means "since": a period, not arithmetic. */
export const DERIVED = new RegExp(String.raw`${B}(tự tính|tính từ(?!\s+(đầu|đáy|đỉnh|cuối|ngày|năm|tháng|quý|phiên|lúc|khi|thời|\d{1,2}\/)))${E}`, "iu")
const DATES = /(?<![\d.,/-])\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?![\d/-])|(?<![\d.,/])\d{1,2}\/\d{4}(?!\d)|(?<![\d.,:])\d{1,2}:\d{2}(?![\d:])/g
const PERIODS = /\b[QH]\d(?:\/\d{2,4})?\b|\b(?:quý|năm|tháng|phiên|ngày)\s+\d+/giu
/**
 * A number and its unit. "2,49T" is a trillion dong ("nghìn tỷ") as finance writers shorten it:
 * only right after a decimal number and before no letter, digit or "+" ("T+2", "T3" are not).
 */
const FIGURE = /(?<![\p{L}\d.,])(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+|\d+)(?:\s*(%|đồng|đ(?!\p{L})|nghìn tỷ|tỷ|triệu|nghìn|lần)|(?<=[.,]\d+)(T)(?![\p{L}\p{N}+]))?/gu
/** A whole number with no unit is usually a count or a heading, not market data. */
const isFigure = (token: string, unit: string | undefined) => unit !== undefined || /[.,]/.test(token)

function readings(token: string) {
  const groups = token.split(/[.,]/)
  const tail = groups.at(-1) ?? ""
  if (groups.length === 1) return { values: [Number(token)], decimals: [0] }
  const decimal = Number(`${groups.slice(0, -1).join("")}.${tail}`)
  const grouped = groups.slice(1).every((g) => g.length === 3)
  return grouped ? { values: [Number(groups.join("")), decimal], decimals: [0, tail.length] } : { values: [decimal], decimals: [tail.length] }
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
      const [whole, token, written, trillion] = match
      const unit = trillion ? "nghìn tỷ" : written
      if (!token || !isFigure(token, unit)) continue
      const { values, decimals } = readings(token)
      // Read in tỷ, so the rounding the answer wrote ("95,8") is 1000 times wider too.
      const scale = unit === "nghìn tỷ" ? 1000 : 1
      figures.push({ text: whole.trim(), values: values.map((v) => v * scale), decimals, scale, unit: unitOf(unit), derived, line })
    }
  }
  return figures
}

const REF = /^\[ref r\d+\]\s*/
/** Notice lines the harness puts before a result: `[Dữ liệu một phần] …`. */
const NOTICES = /^(?:\[[^\]\n]*\p{L}[^\n]*\n)+(?=\[ref |[[{])/u
/** The source line after a web or MCP result (`provenanceOf`): with it, the JSON does not parse. */
const SOURCE_LINE = /\n\[Nguồn: [^\n]*\]\s*$/u
/** The numbers of JSON too long to parse whole, or of plain text. */
const JSON_NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
/**
 * Numbers as a Vietnamese web page writes them: 1.234,5 and 24,1. A subagent's report also
 * groups with commas ("90,300đ", "53,442 tỷ"): both readings are kept, as for an answer.
 */
const VIETNAMESE_NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+,\d{1,2}(?!\d)/g

/** A JSON string literal's content, the last one possibly cut before its closing quote. */
const JSON_STRING = /"((?:[^"\\]|\\.)*)(?:"|$)/g

function scan(text: string, out: Set<number>) {
  for (const match of text.matchAll(JSON_NUMBER)) out.add(Number(match[0]))
  for (const match of text.matchAll(VIETNAMESE_NUMBER)) for (const value of readings(match[0]).values) out.add(value)
}

function walk(value: unknown, out: Set<number>) {
  if (typeof value === "number") out.add(value)
  // A number in words counts too: a message's text, a note in a result.
  else if (typeof value === "string") scan(value, out)
  else if (Array.isArray(value)) for (const item of value) walk(item, out)
  else if (value && typeof value === "object") for (const item of Object.values(value)) walk(item, out)
}

/** The numbers of a tool result. JSON is read as JSON, so `[64.27,64.5]` stays two numbers. */
export function sourceNumbers(text: string): Set<number> {
  const out = new Set<number>()
  // The source line goes first: before it, a one-line "[ref r2] {…}" reads as a notice line too.
  const body = text.replace(SOURCE_LINE, "").replace(NOTICES, "").replace(REF, "")
  try {
    walk(JSON.parse(body), out)
    return out
  } catch {}
  // A capped result does not parse. It is still JSON text, where "64.27,64.5" is two numbers
  // and must not also read as the Vietnamese 6.427,64.
  if (/^\s*[[{]/.test(body)) {
    for (const match of body.matchAll(JSON_NUMBER)) out.add(Number(match[0]))
    // Its string values are still text, though: a capped web_search result holds "23,1%" in a
    // string, and reading only JSON numbers made it 23 and 1 (08/11, real run). The last string
    // may be cut before its closing quote.
    for (const match of body.matchAll(JSON_STRING)) scan(match[1]!, out)
  } else scan(body, out)
  return out
}

/** Stated figures found in none of `numbers`: what a turn could not have read anywhere. */
export const ungroundedFigures = (text: string, numbers: Set<number>) =>
  answerFigures(text)
    .filter((f) => !f.derived && !tracesTo(f, numbers))
    .map((f) => f.text)

/** A tool may give a ratio or thousands where the answer writes a percent or dong. */
const SCALES = [1, 100, 0.01, 1e3, 1e-3, 1e6, 1e-6, 1e9, 1e-9]

/** Whether `value` is one of `numbers` at a common scale, within `near`. */
export function valueTracesTo(value: number, near: number, numbers: Set<number>) {
  for (const number of numbers) {
    // "giảm 3,2%" writes the sign in words.
    if (SCALES.some((scale) => Math.abs(Math.abs(number) * scale - value) <= near)) return true
  }
  return false
}

/** Whether `figure` is one of `numbers` at a common scale, rounded as the answer writes it. */
export function tracesTo(figure: Figure, numbers: Set<number>) {
  return figure.values.some((value, i) => valueTracesTo(value, 0.5 * 10 ** -(figure.decimals[i] ?? 0) * (figure.scale ?? 1) + 1e-9, numbers))
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
