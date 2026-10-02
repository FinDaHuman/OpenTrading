import type { MemoryConfig } from "./config"
import type { ContextBudget } from "./port"
import { renderBlock, renderItem, WRAPPER_BYTES } from "./render"
import type { MemoryItem } from "./schema"
import { utf8Bytes } from "./schema"

/** Code-unit order. localeCompare depends on ICU and locale, which would make prompt bytes differ between machines. */
export const compareId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const compareStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** min(config.t1MaxBytes, budget.maxBytes). A malformed budget counts as zero so the overflow is visible. */
export function effectiveMaxBytes(config: Pick<MemoryConfig, "t1MaxBytes">, budget?: ContextBudget): number {
  const requested = budget?.maxBytes
  if (requested === undefined) return config.t1MaxBytes
  const safe = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0
  return Math.min(config.t1MaxBytes, safe)
}

/** T1 order: profiles by id, then lessons newest first (asOf), then id. */
export function t1Order(a: MemoryItem, b: MemoryItem): number {
  if (a.kind !== b.kind) return a.kind === "profile" ? -1 : 1
  if (a.kind === "lesson" && a.asOf !== b.asOf) return compareStr(b.asOf, a.asOf)
  return compareId(a, b)
}

/** Per-turn order: by scope, then id. */
export const scopedOrder = (a: MemoryItem, b: MemoryItem) => compareStr(a.scope, b.scope) || compareId(a, b)

export interface Packed<T> {
  /** Rendered pieces that fit, in order. */
  pieces: string[]
  taken: T[]
  /** Items left out because the next one would exceed the cap. */
  overflow: number
  bytes: number
}

/**
 * Take pieces in order while open + pieces + close stays within maxBytes. Never cuts a piece; stops at the first
 * one that does not fit, so what is included depends only on order and the cap, not on later sizes.
 */
export function pack<T>(items: readonly T[], render: (item: T) => string, maxBytes: number, wrapperBytes: number) {
  const pieces: string[] = []
  const taken: T[] = []
  let bytes = wrapperBytes
  for (const item of items) {
    const text = render(item)
    const size = utf8Bytes(text)
    if (bytes + size > maxBytes) break
    bytes += size
    pieces.push(text)
    taken.push(item)
  }
  return { pieces, taken, overflow: items.length - taken.length, bytes: taken.length ? bytes : 0 } satisfies Packed<T>
}

export interface T1Selection {
  block: string | null
  /** Ids actually inside the block, in block order. */
  used: string[]
  overflow: number
}

/** Stable block with memories only (no rules); kept for callers that only need T1. */
export function selectT1(items: readonly MemoryItem[], maxBytes: number): T1Selection {
  const packed = pack([...items].sort(t1Order), (i) => renderItem(i), maxBytes, WRAPPER_BYTES)
  return { block: renderBlock(packed.pieces), used: packed.taken.map((i) => i.id), overflow: packed.overflow }
}
