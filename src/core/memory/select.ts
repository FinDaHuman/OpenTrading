import type { MemoryConfig } from "./config"
import type { ContextBudget } from "./port"
import { renderBlock, renderItem, WRAPPER_BYTES } from "./render"
import type { MemoryItemV0 } from "./schema"
import { utf8Bytes } from "./schema"

/** Code-unit order. localeCompare depends on ICU and locale, which would make prompt bytes differ between machines. */
export const compareId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** min(config.t1MaxBytes, budget.maxBytes). A malformed budget counts as zero so the overflow is visible. */
export function effectiveMaxBytes(config: Pick<MemoryConfig, "t1MaxBytes">, budget?: ContextBudget): number {
  const requested = budget?.maxBytes
  if (requested === undefined) return config.t1MaxBytes
  const safe = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0
  return Math.min(config.t1MaxBytes, safe)
}

export interface T1Selection {
  block: string | null
  /** Ids actually inside the block, in block order. */
  used: string[]
  /** Active items left out because the next one would exceed the cap. */
  overflow: number
}

/**
 * T1 for V0: every active global profile, sorted by id, taken in order while the whole rendered block stays within
 * maxBytes. Items are never cut. Selection stops at the first item that does not fit, so what is included depends
 * only on id order and the cap, not on the size of later items.
 */
export function selectT1(items: readonly MemoryItemV0[], maxBytes: number): T1Selection {
  const sorted = [...items].sort(compareId)
  const rendered: string[] = []
  const used: string[] = []
  let bytes = WRAPPER_BYTES
  for (const item of sorted) {
    const text = renderItem(item)
    const size = utf8Bytes(text)
    if (bytes + size > maxBytes) break
    bytes += size
    rendered.push(text)
    used.push(item.id)
  }
  return { block: renderBlock(rendered), used, overflow: sorted.length - used.length }
}
