/**
 * Markup a model writes into its answer that is not for the user. It shows up in three forms:
 * - The harness's own tags, which the model copies. Seen 13/11 with gemini-3.1-flash-lite: after
 *   two empty answers, the whole answer was a self-made `<nhac_nho>` todo list. Also 05/11 (34i).
 * - A tool call written as text: `<todo_write>{…}</todo_write>` (08/11, 40a),
 *   `<tool_call>name<param_key>…`, `<function=…><parameter=…>`. These are never run.
 * - Its own working notes: `<thought>`, `<phan_tich_tool>`.
 *
 * Removing it is deterministic, so the user, `ot -p`, evals and the history never see it. A step
 * that held nothing else is then empty, and the stop gate runs its usual recovery.
 *
 * Code is left alone: inside ``` fences or `inline code` a tag is something being shown. So is a
 * tag named in the middle of a sentence that never closes ("theo <bat_bien>"). One scanner does
 * both the streamed answer and the stored text, so the screen and the history always agree.
 */

/**
 * Tags the harness sends the model (reminders, notices, prompt sections). Kept as literals so
 * this file imports nothing; test/markup.test.ts checks them against the constants that emit them.
 */
export const HARNESS_TAGS = [
  "nhac_nho",
  "thong_bao_subagent",
  "thong_bao_desk",
  "ket_qua",
  "subagent_meta",
  "tom_tat_hoi_thoai",
  "viec_can_lam_luu",
  "memory_lien_quan",
  "tep_dinh_kem",
  "quyen_tep",
  "tool_hoan",
  "ultradesk",
  "bat_bien",
  "thu_tu_uu_tien",
  "vi_du",
  "subagent",
  "bang_chung",
] as const

/** Tool-call wrappers other harnesses and model families use (Hermes, Qwen, Claude XML, GLM). */
export const CALL_TAGS = [
  "tool_call",
  "tool_calls",
  "tool_use",
  "tool_code",
  "function_call",
  "function_calls",
  "function",
  "parameter",
  "invoke",
  "param_key",
  "param_value",
  "arg_key",
  "arg_value",
] as const

/** Working notes, never an answer. */
export const NOTE_TAGS = ["thought", "thinking", "think", "analysis", "reasoning", "scratchpad", "phan_tich_tool", "chi_dan_agent"] as const

const KNOWN = new Set<string>([...HARNESS_TAGS, ...CALL_TAGS, ...NOTE_TAGS])

/** The memory card is an answer part (memory/cards): its own filter takes it out, never this one. */
const CARD_TAG = "the_goi_y"

/** A tag name a tool could have: snake case or an MCP name. Known only when a JSON body follows. */
const TOOL_LIKE = /^[a-z][a-z0-9]*(?:__?[a-z0-9]+)+$/

/** An unclosed block opened mid-sentence goes back to being text past this many characters. */
const MAX_INLINE_BLOCK = 4000
/** Longest opening tag read ("<function=mcp__opentrading__vn_quote_history>"). */
const MAX_TOKEN = 200

interface Opening {
  name: string
  /** Length of the whole `<name …>` token. */
  length: number
  closing: boolean
}

/** The tag at the start of `text`: a token, "need more text", or not a tag at all. */
function readTag(text: string): Opening | "more" | undefined {
  const m = /^<(\/?)([a-z][a-z0-9_]*)/.exec(text)
  if (!m) {
    // "<", "</", "<f…" at the end of what has arrived: wait.
    return /^<\/?[a-z0-9_]*$/.test(text) && text.length <= MAX_TOKEN ? "more" : undefined
  }
  const rest = text.slice(m[0].length)
  if (rest === "") return text.length <= MAX_TOKEN ? "more" : undefined
  // `<function=name>`, `<parameter name="x">`, `<invoke name="x">`.
  const attrs = /^(?:[\s=][^<>\n]*)?(>|$)/.exec(rest.slice(0, MAX_TOKEN))
  if (!attrs) return undefined
  if (attrs[1] === "") return text.length <= MAX_TOKEN ? "more" : undefined
  return { name: m[2]!, length: m[0].length + attrs[0].length, closing: m[1] === "/" }
}

export interface MarkupFilter {
  /** Text of the next chunk that can be shown now. */
  push(chunk: string): string
  /** The rest, at the end of the step. */
  end(): string
  /** Tag names removed so far. */
  readonly tags: ReadonlySet<string>
}

/** One per streamed step (or per stored text). */
export function markupStreamFilter(): MarkupFilter {
  let buf = ""
  const tags = new Set<string>()
  // Scan state of the text already let through.
  let lineStart = true
  let fence = false
  let inline = false
  // Inside a block: its tag, where it opened, and whether it opened its line.
  let block: { name: string; token: string; ownLine: boolean } | undefined

  function run(final: boolean): string {
    let out = ""
    const emit = (text: string) => {
      for (const ch of text) {
        if (ch === "\n") {
          lineStart = true
          inline = false
        } else if (!/\s/.test(ch)) lineStart = false
      }
      out += text
    }
    for (;;) {
      if (block) {
        const close = buf.indexOf(`</${block.name}>`)
        if (close >= 0) {
          let after = close + block.name.length + 3
          // A block on its own line takes its line break with it: wait to see whether one follows.
          if (block.ownLine && after === buf.length && !final) return out
          tags.add(block.name)
          if (block.ownLine && buf[after] === "\n") after++
          buf = buf.slice(after)
          block = undefined
          continue
        }
        if (!block.ownLine && (buf.length > MAX_INLINE_BLOCK || final)) {
          // Never closed, opened mid-sentence: it was text after all.
          const token = block.token
          block = undefined
          buf = buf.slice(token.length)
          emit(token)
          continue
        }
        if (final) {
          // Opened its own line and never closed: the rest of the step is that block.
          tags.add(block.name)
          block = undefined
          buf = ""
        }
        return out
      }
      if (buf === "") return out
      // Fences open and close at the start of a line.
      if (lineStart) {
        const lead = /^[ \t]*/.exec(buf)![0]
        const after = buf.slice(lead.length)
        if (!final && after.length < 3 && "```".startsWith(after) && !after.includes("\n")) return out
        if (after.startsWith("```") || after.startsWith("~~~")) {
          const nl = buf.indexOf("\n")
          if (nl < 0 && !final) return out
          fence = !fence
          emit(nl < 0 ? buf : buf.slice(0, nl + 1))
          buf = nl < 0 ? "" : buf.slice(nl + 1)
          continue
        }
      }
      if (fence) {
        const nl = buf.indexOf("\n")
        if (nl < 0) {
          if (!final) {
            // Hold a line that may still close the fence; anything else goes.
            if (lineStart && /^[ \t]*$/.test(buf)) return out
            emit(buf)
            buf = ""
            return out
          }
          emit(buf)
          buf = ""
          return out
        }
        emit(buf.slice(0, nl + 1))
        buf = buf.slice(nl + 1)
        continue
      }
      // Plain text up to the next tag, backtick or line break.
      const next = buf.search(/[<`\n]/)
      if (next < 0) {
        emit(buf)
        buf = ""
        return out
      }
      if (next > 0) {
        emit(buf.slice(0, next))
        buf = buf.slice(next)
        continue
      }
      const ch = buf[0]!
      if (ch === "\n") {
        emit("\n")
        buf = buf.slice(1)
        continue
      }
      if (ch === "`") {
        // A run of backticks opens or closes inline code (a fence at line start is handled above).
        const run = /^`+/.exec(buf)![0]
        if (!final && run.length === buf.length && lineStart) return out
        inline = !inline
        emit(run)
        buf = buf.slice(run.length)
        continue
      }
      // "<"
      if (inline) {
        emit("<")
        buf = buf.slice(1)
        continue
      }
      const tag = readTag(buf)
      if (tag === "more") {
        if (!final) return out
        emit(buf)
        buf = ""
        return out
      }
      if (!tag) {
        emit("<")
        buf = buf.slice(1)
        continue
      }
      const token = buf.slice(0, tag.length)
      if (tag.closing) {
        // A stray closing tag of a call or note: what is left of a fake call ("</parameter>").
        if (KNOWN.has(tag.name)) {
          let after = tag.length
          if (lineStart && after === buf.length && !final) return out
          tags.add(tag.name)
          if (lineStart && buf[after] === "\n") after++
          buf = buf.slice(after)
          continue
        }
        emit(token)
        buf = buf.slice(tag.length)
        continue
      }
      if (tag.name === CARD_TAG) {
        emit(token)
        buf = buf.slice(tag.length)
        continue
      }
      if (!KNOWN.has(tag.name)) {
        // An unknown tag is a tool call written as text only when JSON follows it.
        const body = buf.slice(tag.length).trimStart()
        if (!TOOL_LIKE.test(tag.name) || (body === "" && final) || (body !== "" && !/^[{[]/.test(body))) {
          emit(token)
          buf = buf.slice(tag.length)
          continue
        }
        if (body === "") return out
      }
      block = { name: tag.name, token, ownLine: lineStart }
    }
  }

  return {
    push(chunk) {
      buf += chunk
      return run(false)
    },
    end() {
      const out = run(true)
      lineStart = true
      fence = false
      inline = false
      return out
    },
    tags,
  }
}

/** The text without markup, and the tags taken out. */
export function stripMarkup(text: string): { text: string; tags: string[] } {
  if (!text.includes("<")) return { text, tags: [] }
  const filter = markupStreamFilter()
  const out = filter.push(text) + filter.end()
  if (filter.tags.size === 0) return { text, tags: [] }
  return { text: out.replace(/\n{3,}/g, "\n\n").trim(), tags: [...filter.tags] }
}
