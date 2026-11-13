import { REF_PREFIX } from "./refs"

/**
 * The output cap for a data result. Cutting text at a character count leaves broken JSON and
 * loses rows with no word of how many, and the model then reads a partial table as the whole.
 * This drops rows from the middle of the long arrays instead: every key stays, with the first
 * and latest rows, and a line in place of the rest says how many went and where they are.
 *
 * Each try serializes the whole result, about a dozen times per capped call. That is fine at
 * the sizes tools return (under 5 MB, refs.ts refuses more).
 */

const MIN_ROWS = 8
const KEEP_AT_LEAST = 2
const MAX_DEPTH = 6
const STEPS = 12

interface Slot {
  owner: Record<string, unknown> | unknown[]
  key: string | number
  rows: unknown[]
}

/** Every array long enough to shorten. */
function slots(value: unknown, depth = 0, out: Slot[] = []): Slot[] {
  if (depth > MAX_DEPTH || !value || typeof value !== "object") return out
  const entries: [string | number, unknown][] = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value)
  for (const [key, child] of entries) {
    if (Array.isArray(child) && child.length >= MIN_ROWS) out.push({ owner: value as Slot["owner"], key, rows: child })
    else slots(child, depth + 1, out)
  }
  return out
}

function shorten(rows: unknown[], keep: number, where: string) {
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return [...rows.slice(0, head), `[... đã lược ${rows.length - keep}/${rows.length} hàng ở giữa; ${where} ...]`, ...rows.slice(rows.length - tail)]
}

/** The result within `max` chars, or undefined when rows are not what makes it long. */
export function capTable(output: string, max: number): string | undefined {
  const ref = /^\[ref (r\d+)\] /.exec(output)
  const body = ref ? output.slice(ref[0].length) : output
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  const prefix = ref ? `${REF_PREFIX}${ref[1]}] ` : ""
  const where = ref ? `đủ ở ref ${ref[1]}: chart đọc thẳng, read_result đọc nguyên văn` : "gọi tool với phạm vi hẹp hơn nếu cần"
  const room = max - prefix.length
  const list = slots(parsed)
  if (list.length === 0) return undefined
  // One share for every array: a batch of symbols keeps an even number of rows of each, so no
  // symbol reads as having had two candles.
  const at = (share: number) => {
    for (const slot of list) {
      const keep = Math.min(slot.rows.length - 1, Math.max(KEEP_AT_LEAST, Math.floor(slot.rows.length * share)))
      ;(slot.owner as Record<string | number, unknown>)[slot.key] = shorten(slot.rows, keep, where)
    }
    return JSON.stringify(parsed)
  }
  let low = 0
  let high = 1
  for (let step = 0; step < STEPS; step++) {
    const share = (low + high) / 2
    if (at(share).length <= room) low = share
    else high = share
  }
  const text = at(low)
  return text.length <= room ? `${prefix}${text}` : undefined
}
