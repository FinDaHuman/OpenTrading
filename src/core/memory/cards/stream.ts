import { CLOSE_TAG, MAX_BLOCK_CHARS, OPEN_TAG } from "./block"

/**
 * Hides card blocks while an answer streams (spec 007 YC-017), with the rules of stripCardBlocks: a closed
 * block goes whole; an unclosed one (end of stream, or longer than MAX_BLOCK_CHARS) only loses its opening
 * line. Text that may be the start of an opening tag is held back until it is clearly not one, so no chunk
 * boundary ever shows part of a block. One filter per streamed assistant line; end() when the line closes.
 */
export function cardStreamFilter(): { push(chunk: string): string; end(): string } {
  let held = ""
  let inBlock = false

  /** Longest tail of `text` that is a proper start of OPEN_TAG. */
  const partialOpen = (text: string) => {
    for (let n = Math.min(OPEN_TAG.length - 1, text.length); n > 0; n--) {
      if (OPEN_TAG.startsWith(text.slice(-n))) return n
    }
    return 0
  }
  /** An unclosed block lets its text go, minus the opening line. */
  const release = (block: string) => {
    const nl = block.indexOf("\n")
    return nl < 0 ? "" : block.slice(nl + 1)
  }

  function run(): string {
    let out = ""
    for (;;) {
      if (inBlock) {
        const close = held.indexOf(CLOSE_TAG)
        if (close >= 0 && close + CLOSE_TAG.length <= MAX_BLOCK_CHARS) {
          held = held.slice(close + CLOSE_TAG.length)
          inBlock = false
          continue
        }
        if (held.length > MAX_BLOCK_CHARS) {
          // Too long to be a card: it goes on as text, without the opening line, read again from there.
          inBlock = false
          held = release(held)
          continue
        }
        return out
      }
      const open = held.indexOf(OPEN_TAG)
      if (open >= 0) {
        out += held.slice(0, open)
        held = held.slice(open)
        inBlock = true
        continue
      }
      const keep = partialOpen(held)
      out += held.slice(0, held.length - keep)
      held = held.slice(held.length - keep)
      return out
    }
  }

  return {
    push(chunk) {
      held += chunk
      return run()
    },
    end() {
      const rest = inBlock ? release(held) : held
      held = ""
      inBlock = false
      // What an unclosed block let go may hold another block: the same rules apply to it.
      if (rest.includes(OPEN_TAG)) {
        const again = cardStreamFilter()
        return again.push(rest) + again.end()
      }
      return rest
    },
  }
}
