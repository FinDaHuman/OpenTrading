/**
 * Terminal width helpers. Widths come from Bun.stringWidth, which counts what the
 * terminal draws: Vietnamese in NFD form (base letter + combining marks) is one cell per
 * letter, CJK/emoji two.
 */

export const width = (text: string) => Bun.stringWidth(text)

/** Cut to `max` cells, ending with "…" when something was dropped. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return ""
  const flat = text.replace(/\s+/g, " ")
  if (width(flat) <= max) return flat
  let out = ""
  let used = 0
  // Iterate by grapheme so a letter never loses its combining accent.
  for (const { segment } of new Intl.Segmenter().segment(flat)) {
    const w = width(segment)
    if (used + w > max - 1) break
    out += segment
    used += w
  }
  return out.trimEnd() + "…"
}

/** Pad with spaces to exactly `cells` (after truncating if longer). */
export function pad(text: string, cells: number): string {
  const cut = truncate(text, cells)
  return cut + " ".repeat(Math.max(0, cells - width(cut)))
}

/**
 * Rank items for a typed query (Claude Code / Codex order): exact name, prefix (shorter
 * first), substring, in-order characters, then words of the description. Accent-
 * insensitive. Returns only matches; an empty query keeps the original order.
 */
export function rank<T>(items: T[], query: string, name: (t: T) => string, description: (t: T) => string = () => ""): T[] {
  const q = fold(query.trim())
  if (!q) return items
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const n = fold(name(item))
    const d = fold(description(item))
    let score = -1
    if (n === q) score = 1000
    else if (n.startsWith(q)) score = 800 - n.length
    else if (n.includes(q)) score = 600 - n.indexOf(q)
    else if (subsequence(n, q)) score = 400 - n.length
    else if (d.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) score = 200
    else if (d.includes(q)) score = 100
    if (score >= 0) scored.push({ item, score, index })
  })
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.item)
}

/** Lowercase without Vietnamese accents (đ → d), so "phan tich" finds "phân tích". */
export function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
}

function subsequence(text: string, query: string) {
  let i = 0
  for (const ch of text) if (ch === query[i]) i++
  return i === query.length
}
