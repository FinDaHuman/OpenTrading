import type { MemoryItemV0 } from "./schema"
import { utf8Bytes } from "./schema"

/** Memory text is data, never markup: escape before it goes inside a tag or an attribute. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export const BLOCK_OPEN = "<memory_context>\n"
export const BLOCK_CLOSE = "</memory_context>"

/** One item, ending in a newline. No clock, age or stats: the bytes depend only on the stored item. */
export function renderItem(item: Pick<MemoryItemV0, "id" | "kind" | "scope" | "body">): string {
  return (
    `  <memory id="${escapeXml(item.id)}" kind="${escapeXml(item.kind)}" scope="${escapeXml(item.scope)}">\n` +
    `    <content>${escapeXml(item.body)}</content>\n` +
    `  </memory>\n`
  )
}

/** Block bytes are exactly open + items + close, so selection can add them up without rendering twice. */
export const WRAPPER_BYTES = utf8Bytes(BLOCK_OPEN) + utf8Bytes(BLOCK_CLOSE)

/** Empty input gives no block at all rather than an empty wrapper. */
export function renderBlock(rendered: string[]): string | null {
  return rendered.length === 0 ? null : BLOCK_OPEN + rendered.join("") + BLOCK_CLOSE
}

/**
 * Whether an item could ever appear in T1 on its own, after escaping. Escaping can grow a body up to six times
 * ('"' → '&quot;'), so an item within maxItemBytes may still never fit; such items are refused when written.
 */
export function fitsAlone(item: Pick<MemoryItemV0, "id" | "kind" | "scope" | "body">, t1MaxBytes: number): boolean {
  return WRAPPER_BYTES + utf8Bytes(renderItem(item)) <= t1MaxBytes
}
