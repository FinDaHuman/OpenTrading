/**
 * What part of a streaming answer to hand the markdown renderer.
 *
 * OpenTUI shows a synchronous preview of the last block and replaces it with the tree-sitter
 * result a moment later; feeding it half-typed block syntax (`## Kế`, `| a |`, an unclosed
 * `**`) makes each frame flip between raw markers and the formatted text. So, like Claude Code
 * and Codex, lines are shown once they end, with two softenings for slow single-line paragraphs
 * and for tables:
 * - the unfinished last line is shown (with a cursor) when it is plain prose or a list/quote
 *   item with text, up to its first inline marker still open;
 * - a pipe table at the end is held back until a line that is not part of it arrives (Codex's
 *   table holdback), so the grid is laid out once instead of re-balancing on every row.
 */

export interface StreamView {
  /** Markdown to render. */
  markdown: string
  /** Rows of a table held back below the markdown (0 when none). */
  heldTableRows: number
}

export const STREAM_CURSOR = " ▍"

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const TABLE_ROW = /^\s*\|/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}/
/** A list or quote item that already has text: its block type can no longer change. */
const ITEM_WITH_TEXT = /^\s*([-*+]|\d{1,9}[.)]|>)\s+\S/
/** Anything else that opens with block syntax, or could still turn into it. */
const BLOCK_START = /^\s*(#|\||>|[-*+](\s|$)|\d{1,9}[.)]?(\s|$)|`{1,3}|~{1,3}|[-*_=]+\s*$)/

/**
 * The line up to its first inline marker still open (`**`, `` ` ``, `*`, a link), which the preview
 * would show raw until it closes. Cutting there instead of hiding the line keeps text already
 * on screen from vanishing when a marker opens.
 */
function settled(line: string) {
  const open = (re: RegExp) => {
    const at = [...line.matchAll(re)].map((m) => m.index)
    return at.length % 2 === 1 ? at[at.length - 1]! : Infinity
  }
  // A lone `*` (not part of `**`, not the item marker) is emphasis.
  const lone = /(?<!\*)\*(?!\*)/g
  const marker = /^\s*[*]\s/.exec(line)?.[0].length ?? 0
  const singles = [...line.slice(marker).matchAll(lone)].map((m) => m.index + marker)
  // A link still being typed: `[nhãn`, `[nhãn]`, `[nhãn](https://…`.
  const link = /\[[^\]]*(\](\([^)]*)?)?$/.exec(line)?.index ?? Infinity
  const cut = Math.min(open(/\*\*/g), open(/`/g), singles.length % 2 === 1 ? singles[singles.length - 1]! : Infinity, link)
  return cut === Infinity ? line : line.slice(0, cut).trimEnd()
}

/** The part of the unfinished last line that can be shown, or "" for none of it. */
function partialLine(line: string) {
  if (!line.trim() || (BLOCK_START.test(line) && !ITEM_WITH_TEXT.test(line))) return ""
  const shown = settled(line)
  // An item cut back to its bare marker would turn into another block.
  return ITEM_WITH_TEXT.test(shown) || (shown.trim() && !BLOCK_START.test(shown)) ? shown : ""
}

export function streamView(text: string, done: boolean): StreamView {
  if (done) return { markdown: text.trimEnd(), heldTableRows: 0 }
  const cut = text.lastIndexOf("\n")
  const lines = cut < 0 ? [] : text.slice(0, cut).split("\n")
  const partial = text.slice(cut + 1)

  let fence: string | undefined
  for (const line of lines) {
    const m = FENCE.exec(line)
    if (!m) continue
    if (!fence) fence = m[1]![0]!
    else if (m[1]![0] === fence) fence = undefined
  }

  // A table still growing: its trailing rows wait until the line after them shows it ended.
  let held = 0
  if (!fence && (partial === "" || TABLE_ROW.test(partial))) {
    let start = lines.length
    while (start > 0 && TABLE_ROW.test(lines[start - 1]!)) start--
    if (start < lines.length) {
      held = lines.slice(start).filter((l) => !TABLE_RULE.test(l)).length + (partial.trim() ? 1 : 0)
      lines.length = start
    }
  }

  let body = lines.join("\n")
  if (held === 0 && partial) {
    if (fence) {
      // Code: the line is plain text, except a closing fence still being typed.
      if (!/^\s*(`+|~+)\s*$/.test(partial)) body += (body ? "\n" : "") + partial
    } else {
      const shown = partialLine(partial)
      if (shown) body += (body ? "\n" : "") + shown + STREAM_CURSOR
    }
  }
  return { markdown: body.trimEnd(), heldTableRows: held }
}
