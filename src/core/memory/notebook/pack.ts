import { BUDGETS } from "../../prompt/budget"
import { MEMORY_INDEX_MAX_CHARS, MEMORY_RECALL_MAX_CHARS, MEMORY_RECALL_MAX_ITEMS } from "../types"

/**
 * Fits the reminder part of a turn under the memory budget of the smallest model tier, so the core never
 * cuts a labelled block, a note or the index on any tier (the MemoryProvider contract stays as it is).
 * Lengths are measured exactly as the core prints recalled items: "- " before each, one new line between.
 */

/** The smallest memory budget over the tiers, in characters (the core estimates 4 characters a token). */
function smallestMemoryChars() {
  const budgets = Object.values(BUDGETS.memory ?? {}).filter((b): b is number => b !== undefined)
  return budgets.length > 0 ? Math.min(...budgets) * 4 : MEMORY_RECALL_MAX_CHARS
}

export const recallCharLimit = () => Math.min(smallestMemoryChars(), MEMORY_RECALL_MAX_CHARS)
export const indexCharLimit = () => Math.min(smallestMemoryChars(), MEMORY_INDEX_MAX_CHARS)

export const recalledLength = (items: readonly string[]) =>
  items.length === 0 ? 0 : items.reduce((n, item) => n + 2 + item.length, 0) + items.length - 1

export interface PackLine {
  key: string
  text: string
}
export interface PackBlock {
  key: string
  text: string
  /** Lines to send when the block fits the cap but not this turn (case a). */
  ifRoomless: PackLine[]
  /** Lines to send when the block alone is longer than the cap (case b). */
  ifTooLong: PackLine[]
}
export interface PackResult {
  items: string[]
  /** Keys of the blocks placed, roomless, too long. */
  placed: string[]
  roomless: string[]
  tooLong: string[]
  /** Keys of the lines sent in item 1, and of those left for a later turn. */
  lines: string[]
  deferred: string[]
}

/**
 * Item 1 holds every note and pointer; each block is an item of its own. Order is priority: the notes
 * first, then blocks as given (the caller puts subjects spotted this turn before those carried over).
 */
export function packRecall(
  input: { lines: readonly PackLine[]; blocks: readonly PackBlock[] },
  limits: { chars: number; items: number } = { chars: recallCharLimit(), items: MEMORY_RECALL_MAX_ITEMS },
): PackResult {
  const fits = (lines: readonly PackLine[], blocks: readonly string[]) => {
    const items = lines.length > 0 ? [lines.map((l) => l.text).join("\n"), ...blocks] : [...blocks]
    return items.length <= limits.items && recalledLength(items) <= limits.chars
  }
  const deferred: string[] = []
  // Notes first, each only if it fits with those before it.
  let lines: PackLine[] = []
  for (const line of input.lines) {
    if (fits([...lines, line], [])) lines.push(line)
    else deferred.push(line.key)
  }
  const placed: PackBlock[] = []
  const roomless: string[] = []
  const tooLong: string[] = []
  const pointers: PackLine[] = []
  for (const block of input.blocks) {
    if (recalledLength([block.text]) > limits.chars) {
      tooLong.push(block.key)
      pointers.push(...block.ifTooLong)
    } else if (fits([...lines, ...pointers], [...placed.map((b) => b.text), block.text])) {
      placed.push(block)
    } else {
      roomless.push(block.key)
      pointers.push(...block.ifRoomless)
    }
  }
  // Pointers come last: a placed block outranks a pointer to another one.
  const texts = placed.map((b) => b.text)
  for (const line of pointers) {
    if (fits([...lines, line], texts)) lines = [...lines, line]
    else deferred.push(line.key)
  }
  return {
    items: lines.length > 0 ? [lines.map((l) => l.text).join("\n"), ...texts] : texts,
    placed: placed.map((b) => b.key),
    roomless,
    tooLong,
    lines: lines.map((l) => l.key),
    deferred,
  }
}
