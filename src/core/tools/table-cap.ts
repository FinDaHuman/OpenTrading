import { REF_PREFIX } from "./refs"

/**
 * The output cap for a data result. Cutting text at a character count leaves broken JSON and
 * loses rows with no word of how many, and the model then reads a partial table as the whole.
 * This drops rows from the middle of the longest arrays instead: every key stays, with the first
 * and latest rows, and a line in place of the rest says how many went and where they are.
 */

const MIN_ROWS = 8
const MAX_ARRAYS = 6
const MAX_DEPTH = 6

interface Slot {
  owner: Record<string, unknown> | unknown[]
  key: string | number
  rows: unknown[]
}

/** Every array long enough to shorten, longest text first. */
function slots(value: unknown, depth = 0, out: Slot[] = []): Slot[] {
  if (depth > MAX_DEPTH || !value || typeof value !== "object") return out
  const entries: [string | number, unknown][] = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value)
  for (const [key, child] of entries) {
    if (Array.isArray(child) && child.length >= MIN_ROWS) out.push({ owner: value as Slot["owner"], key, rows: child })
    else slots(child, depth + 1, out)
  }
  return out
}

const put = (slot: Slot, rows: unknown[]) => {
  ;(slot.owner as Record<string | number, unknown>)[slot.key] = rows
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
  const where = ref ? `đủ ở ref ${ref[1]}: compute và chart đọc thẳng, read_result đọc nguyên văn` : "gọi tool với phạm vi hẹp hơn nếu cần"
  const room = max - prefix.length
  const list = slots(parsed)
    .sort((a, b) => JSON.stringify(b.rows).length - JSON.stringify(a.rows).length)
    .slice(0, MAX_ARRAYS)
  if (list.length === 0) return undefined
  for (const slot of list) {
    // The most rows that fit, with every other array as it stands now.
    let low = 2
    let high = slot.rows.length - 1
    let best = 2
    while (low <= high) {
      const keep = Math.floor((low + high) / 2)
      put(slot, shorten(slot.rows, keep, where))
      if (JSON.stringify(parsed).length <= room) {
        best = keep
        low = keep + 1
      } else high = keep - 1
    }
    put(slot, shorten(slot.rows, best, where))
    const text = JSON.stringify(parsed)
    if (text.length <= room) return `${prefix}${text}`
  }
  return undefined
}
