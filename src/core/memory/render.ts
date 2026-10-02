import type { MemoryItem } from "./schema"
import { utf8Bytes } from "./schema"

/** Memory and rule text is data, never markup: escape before it goes inside a tag or an attribute. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Stable block: always-on rules, global profiles and lessons. Bytes depend only on stored data. */
export const BLOCK_OPEN = "<memory_context>\n"
export const BLOCK_CLOSE = "</memory_context>"
/** Per-turn block: rules, notes and lessons for the instruments being discussed now. */
export const SCOPED_OPEN = "<memory_scoped>\n"
export const SCOPED_CLOSE = "</memory_scoped>"

export const WRAPPER_BYTES = utf8Bytes(BLOCK_OPEN) + utf8Bytes(BLOCK_CLOSE)
export const SCOPED_WRAPPER_BYTES = utf8Bytes(SCOPED_OPEN) + utf8Bytes(SCOPED_CLOSE)

export type RenderableItem = Pick<MemoryItem, "id" | "kind" | "scope" | "body"> &
  Partial<Pick<MemoryItem, "title" | "asOf" | "expiresAt">>

/**
 * One memory, ending in a newline. Absolute dates only in the stable block; the relative age (`age_days`) appears
 * only in the per-turn block, so the stable bytes do not change overnight.
 */
export function renderItem(item: RenderableItem, opts: { ageDays?: number } = {}): string {
  const attrs = [`id="${escapeXml(item.id)}"`, `kind="${escapeXml(item.kind)}"`, `scope="${escapeXml(item.scope)}"`]
  if (item.asOf) attrs.push(`as_of="${escapeXml(item.asOf)}"`)
  if (item.expiresAt) attrs.push(`expires="${escapeXml(item.expiresAt)}"`)
  if (opts.ageDays !== undefined) attrs.push(`age_days="${opts.ageDays}"`)
  return (
    `  <memory ${attrs.join(" ")}>\n` +
    (item.title ? `    <title>${escapeXml(item.title)}</title>\n` : "") +
    `    <content>${escapeXml(item.body ?? "")}</content>\n` +
    `  </memory>\n`
  )
}

export function renderRule(rule: { name: string; body: string }): string {
  return `  <rule name="${escapeXml(rule.name)}">\n    ${escapeXml(rule.body)}\n  </rule>\n`
}

/** Agent-mode rules: name and description only; the body is fetched with load_rule. */
export function renderRuleCatalog(rules: readonly { name: string; description: string }[]): string {
  if (rules.length === 0) return ""
  const lines = rules.map((r) => `    - ${escapeXml(r.name)}: ${escapeXml(r.description)}`).join("\n")
  return `  <rule_catalog hint="load_rule(name) để đọc">\n${lines}\n  </rule_catalog>\n`
}

/** Empty input gives no block at all rather than an empty wrapper. */
export function renderBlock(rendered: readonly string[], open = BLOCK_OPEN, close = BLOCK_CLOSE): string | null {
  return rendered.length === 0 ? null : open + rendered.join("") + close
}

/**
 * Whether an item could ever appear in the stable block on its own, after escaping. Escaping can grow a body up to
 * six times ('"' → '&quot;'), so an item within maxItemBytes may still never fit; such items are refused when written.
 */
export function fitsAlone(item: RenderableItem, maxBytes: number, wrapperBytes = WRAPPER_BYTES): boolean {
  return wrapperBytes + utf8Bytes(renderItem(item, { ageDays: 99_999 })) <= maxBytes
}
