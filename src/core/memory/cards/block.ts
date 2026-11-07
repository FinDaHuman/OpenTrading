/**
 * The suggestion-card block a model may end its answer with (spec 007, data-model §1):
 *
 *   <the_goi_y loai="bai_hoc">
 *   tieu_de: …
 *   tom_tat: …
 *   </the_goi_y>
 *
 * Every block is taken out of the answer, valid or not, on every turn: a block never reaches history or the
 * screen. A block with no closing tag (or longer than MAX_BLOCK_CHARS before it closes) only loses its
 * opening line, so a broken tag never swallows the answer after it (design-v5 §6). The stream filter
 * (stream.ts) applies the same rules while the answer streams.
 */

export const OPEN_TAG = "<the_goi_y"
export const CLOSE_TAG = "</the_goi_y>"
/** From the opening tag to the end of the closing one; a longer block is treated as unclosed. */
export const MAX_BLOCK_CHARS = 2_000

export interface RawCardBlock {
  /** The `loai` attribute as written, undefined when absent. */
  loai?: string
  /** `name: value` lines; undefined when a line is not one (the block is broken). */
  fields?: Record<string, string>
}

const ATTR = /loai\s*=\s*"([^"]*)"/

interface Found {
  start: number
  /** End of the closing tag; undefined for an unclosed block. */
  end?: number
}

function findBlocks(text: string): Found[] {
  const found: Found[] = []
  let from = 0
  for (;;) {
    const start = text.indexOf(OPEN_TAG, from)
    if (start < 0) return found
    const close = text.indexOf(CLOSE_TAG, start)
    const end = close < 0 ? undefined : close + CLOSE_TAG.length
    if (end !== undefined && end - start <= MAX_BLOCK_CHARS) {
      found.push({ start, end })
      from = end
    } else {
      found.push({ start })
      from = start + OPEN_TAG.length
    }
  }
}

/** The end of the line an unclosed block opens on: that line alone goes. */
const lineEnd = (text: string, start: number) => {
  const nl = text.indexOf("\n", start)
  return nl < 0 ? text.length : nl + 1
}

/** Inside an unclosed ``` fence at `at`. */
const inFence = (text: string, at: number) => (text.slice(0, at).match(/```/g)?.length ?? 0) % 2 === 1

function parse(block: string): RawCardBlock {
  const headEnd = block.indexOf(">")
  const head = block.slice(0, headEnd + 1)
  const loai = ATTR.exec(head)?.[1]
  const body = block.slice(headEnd + 1, block.length - CLOSE_TAG.length)
  const fields: Record<string, string> = {}
  for (const raw of body.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const m = /^([a-z_]+)\s*:\s*(.*)$/.exec(line)
    if (!m || m[1]! in fields) return { loai }
    fields[m[1]!] = m[2]!.trim()
  }
  return { loai, fields }
}

/**
 * The answer without any card block, and the card block when it is the only one, closed, at the very end
 * (only whitespace after it), starting a line, outside a code fence.
 */
export function stripCardBlocks(text: string): { text: string; last?: RawCardBlock } {
  if (!text.includes(OPEN_TAG)) return { text }
  const blocks = findBlocks(text)
  let out = ""
  let at = 0
  for (const b of blocks) {
    out += text.slice(at, b.start)
    at = b.end ?? lineEnd(text, b.start)
  }
  out += text.slice(at)
  const only = blocks.length === 1 ? blocks[0]! : undefined
  const last =
    only?.end !== undefined &&
    text.slice(only.end).trim() === "" &&
    (only.start === 0 || text[only.start - 1] === "\n") &&
    !inFence(text, only.start)
      ? parse(text.slice(only.start, only.end))
      : undefined
  return { text: out.replace(/\s+$/, ""), last }
}
