import type { ModelMessage } from "ai"
import { fit } from "../../prompt/budget"
import { REMINDER_CAP_MARK, REMINDER_TAG } from "../../reminder-tag"
import { truncate } from "../../tools/wrap"
import { memoryReadTool } from "./read-tool"
import { labelOf, maskedLesson, maskedThesis, reminders, renderLessonBlock, renderThesisBlock } from "./render"

/**
 * The memory blocks and one-line memory notes in a list of messages, read from the only two places the
 * notebook writes to: the `<memory_lien_quan>` section of a user message's reminder part, and memory_read
 * results. Nothing else counts, so a label the user typed, another tool returned or the model wrote never
 * becomes a block. Stored text never starts a line (escape.ts), so a line that parses as a label in those
 * two places was written by the provider.
 *
 * Every pattern is built from render.ts itself, so a wording change there cannot leave this reader behind.
 */

export type BlockKind = "thesis" | "lesson"

export interface HistoryBlock {
  kind: BlockKind
  /** Lesson number, or the thesis name exactly as in the label (escaped). */
  ref: number | string
  version: number
  channel: "reminder" | "tool"
  label: string
  /** The block's lines after the label, as sent. */
  lines: readonly string[]
  /** Message index, content part index, and the block's character range in that part's text. */
  at: { message: number; part: number; start: number; end: number }
  /** False when one of the core's cut marks ends the block early, or the block starts right after one. */
  complete: boolean
  /**
   * False for a block that starts right after the output cap's mark: the tail may begin mid-line, inside
   * stored text that looks like a label. Such a label proves nothing, so its item is never "deleted".
   */
  labelSure: boolean
}

export type HistoryLine =
  | { kind: "note"; key: string }
  | { kind: "pointer"; key: string }
  | { kind: "error"; reason: string }
  | { kind: "masked"; item: { kind: BlockKind; ref: number | string } }

/** Id of the reminder section the agent loop puts recalled memory in (prompt/assemble.ts). */
const MEMORY_SECTION = "memory_lien_quan"

// ── patterns from render.ts ────────────────────────────────────────────────

// Placeholders render.ts passes through unchanged: no entity, no line break, not a date.
const NAME = "\u0001name\u0001"
const DATE = "\u0001date\u0001"
const STATE = "\u0001state\u0001"
const REASON = "\u0001reason\u0001"
const ID = 918_273_645
const VERSION = 918_273_646
const OLD = 918_273_647

const SLOTS: [string, string][] = [
  [NAME, "(?<name>.+?)"],
  [DATE, ".+?"],
  [STATE, "(?<state>.+?)"],
  [REASON, "(?<reason>.*)"],
  [String(ID), "(?<id>\\d+)"],
  [String(VERSION), "(?<version>\\d+)"],
  [String(OLD), "(?<old>\\d+)"],
]

function pattern(sample: string): RegExp {
  let source = sample.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  for (const [slot, group] of SLOTS) {
    const [first, ...rest] = source.split(slot)
    // A slot printed twice (the lesson number in "#7 … #7") must hold the same value both times.
    const again = group.match(/^\(\?<(\w+)>/)?.[1]
    source = rest.reduce((acc, piece, i) => acc + (i === 0 || !again ? group : `\\k<${again}>`) + piece, first!)
  }
  return new RegExp(`^${source}$`, "u")
}

/** Built on first use: render.ts may still be loading when this module is evaluated. */
let compiled: ReturnType<typeof compile> | undefined
function compile() {
  const thesis = { subjectId: 0, display: NAME, version: VERSION, text: "x", conditions: [], state: "watching", validFrom: DATE }
  const lesson = { id: ID, version: VERSION, title: "x", summary: "x", appliesToDisplay: [], tags: [], createdAt: DATE }
  const labels: { kind: BlockKind; re: RegExp }[] = [
    { kind: "thesis", re: pattern(labelOf(renderThesisBlock(thesis, {}))) },
    { kind: "thesis", re: pattern(labelOf(renderThesisBlock(thesis, { replaces: OLD }))) },
    { kind: "lesson", re: pattern(labelOf(renderLessonBlock(lesson))) },
  ]
  // Key = the template's name and its slots in a fixed order, so a key never depends on the wording.
  const one = (kind: "note" | "pointer", name: string, sample: string, slots: string[]) => ({
    kind,
    name,
    re: pattern(sample),
    slots,
  })
  const singles = [
    one("note", "lessonDeleted", reminders.lessonDeleted(ID), ["id"]),
    one("note", "lessonNewVersion", reminders.lessonNewVersion(ID, VERSION, OLD), ["id", "version", "old"]),
    one("note", "thesisDeleted", reminders.thesisDeleted(NAME), ["name"]),
    one("note", "thesisNewVersion", reminders.thesisNewVersion(NAME, VERSION, OLD), ["name", "version", "old"]),
    one("note", "thesisState", reminders.thesisState(NAME, VERSION, STATE), ["name", "version", "state"]),
    one("note", "indexThesisAdded", reminders.indexThesisAdded(NAME), ["name"]),
    one("note", "indexLessonAdded", reminders.indexLessonAdded(ID), ["id"]),
    one("pointer", "roomless", reminders.roomless(NAME, VERSION), ["name", "version"]),
    one("pointer", "tooLong", reminders.tooLong(NAME, VERSION), ["name", "version"]),
  ]
  // The mark lines the core adds when it cuts: taken from the functions that write them.
  const truncated = truncate("a".repeat(40), 10).split("\n").find((l) => l.startsWith("["))!
  const budget = fit("a ".repeat(400), 10).text.split("\n").at(-1)!
  return {
    labels,
    singles,
    error: pattern(reminders.storeError(REASON)),
    maskedLesson: pattern(maskedLesson(ID)),
    maskedThesis: pattern(maskedThesis(NAME)),
    truncateMark: pattern(truncated.replace(/\d+/, String(ID))),
    budgetMark: budget,
    tool: memoryReadTool({ readSubject: () => "", readLesson: () => "", search: () => "" }).name,
  }
}
const patterns = () => (compiled ??= compile())

/** A short name for a block's label line, for the user's "Dùng N memory" notice: "HPG bản 3", "bài học #7 bản 2". */
export function labelTitle(text: string): string | undefined {
  const label = parseLabel(text.split("\n", 1)[0] ?? "")
  if (!label) return undefined
  if (label.kind === "lesson") return `bài học #${label.ref} bản ${label.version}`
  // The label prints the name escaped (escape.ts); the user reads it plain.
  const name = (label.ref as string).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  return `${name} bản ${label.version}`
}

function parseLabel(line: string): { kind: BlockKind; ref: number | string; version: number } | undefined {
  for (const { kind, re } of patterns().labels) {
    const m = re.exec(line)
    if (!m) continue
    const g = m.groups!
    return { kind, ref: kind === "lesson" ? Number(g.id) : g.name!, version: Number(g.version) }
  }
  return undefined
}

function parseSingle(line: string): HistoryLine | undefined {
  const p = patterns()
  for (const s of p.singles) {
    const m = s.re.exec(line)
    if (m) return { kind: s.kind, key: [s.name, ...s.slots.map((k) => m.groups![k])].join(":") }
  }
  const error = p.error.exec(line)
  if (error) return { kind: "error", reason: error.groups!.reason! }
  return parseMasked(line)
}

function parseMasked(line: string): HistoryLine | undefined {
  const p = patterns()
  const lesson = p.maskedLesson.exec(line)
  if (lesson) return { kind: "masked", item: { kind: "lesson", ref: Number(lesson.groups!.id) } }
  const thesis = p.maskedThesis.exec(line)
  if (thesis) return { kind: "masked", item: { kind: "thesis", ref: thesis.groups!.name! } }
  return undefined
}

type CutMark = "truncate" | "cap" | "budget"
function cutMark(line: string): CutMark | undefined {
  const p = patterns()
  if (p.truncateMark.test(line)) return "truncate"
  if (line === REMINDER_CAP_MARK) return "cap"
  if (line === p.budgetMark) return "budget"
  return undefined
}

// ── scanning ───────────────────────────────────────────────────────────────

interface Where {
  message: number
  part: number
}

/** Splits `text[from, to)` into lines with their start offsets. */
function linesOf(text: string, from: number, to: number) {
  const out: { line: string; start: number }[] = []
  let start = from
  while (start <= to) {
    const nl = text.indexOf("\n", start)
    const end = nl < 0 || nl > to ? to : nl
    out.push({ line: text.slice(start, end), start })
    start = end + 1
  }
  return out
}

class Collector {
  readonly blocks: HistoryBlock[] = []
  readonly lines: HistoryLine[] = []
  private open?: HistoryBlock

  start(where: Where, channel: HistoryBlock["channel"], label: string, start: number, sure: boolean) {
    this.close()
    const parsed = parseLabel(label)!
    const at = { ...where, start, end: start + label.length }
    this.open = { ...parsed, channel, label, lines: [], at, complete: sure, labelSure: sure }
  }
  add(line: string, start: number) {
    if (!this.open) return
    ;(this.open.lines as string[]).push(line)
    this.open.at.end = start + line.length
  }
  cut() {
    if (this.open) this.open.complete = false
    this.close()
  }
  close() {
    if (this.open) this.blocks.push(this.open)
    this.open = undefined
  }
  get inBlock() {
    return this.open !== undefined
  }
}

/** The memory section of a reminder part: one item per "- " line, a block's further lines after it. */
function scanReminder(text: string, where: Where, out: Collector) {
  const open = `<${MEMORY_SECTION}>\n`
  let from = text.indexOf(`\n${open}`)
  if (from < 0) return
  from += 1 + open.length
  const close = text.indexOf(`\n</${MEMORY_SECTION}>`, from)
  const to = close < 0 ? text.length : close
  for (const { line, start } of linesOf(text, from, to)) {
    if (cutMark(line)) {
      out.cut()
      continue
    }
    if (line.startsWith("- ")) {
      const item = line.slice(2)
      if (parseLabel(item)) out.start(where, "reminder", item, start + 2, true)
      else {
        out.close()
        const single = parseSingle(item)
        if (single) out.lines.push(single)
      }
      continue
    }
    // pack.ts puts every note in one item, one "- " for all: the lines after the first carry none.
    if (out.inBlock) out.add(line, start)
    else {
      const single = parseSingle(line)
      if (single) out.lines.push(single)
    }
  }
  out.close()
}

/**
 * A memory_read result: blocks start at a label line and end at a blank line. The output cap keeps the
 * head and the tail with a mark between; the tail starts anywhere in the text, so whatever follows the
 * mark is never trusted as whole.
 */
function scanTool(text: string, where: Where, out: Collector) {
  let afterMark = false
  // A blank line ends the open block, but the output cap writes "\n\n<mark>": whole only if no mark follows.
  let ended = false
  for (const { line, start } of linesOf(text, 0, text.length)) {
    const mark = cutMark(line)
    if (mark) {
      out.cut()
      ended = false
      if (mark === "truncate") afterMark = true
      continue
    }
    if (line === "") {
      ended = out.inBlock
      continue
    }
    if (ended) {
      out.close()
      ended = false
    }
    if (parseLabel(line)) {
      out.start(where, "tool", line, start, !afterMark)
      afterMark = false
      continue
    }
    // The tail's first line is a fragment of something cut: never part of a block.
    if (afterMark) {
      afterMark = false
      continue
    }
    if (out.inBlock) out.add(line, start)
    else {
      const masked = parseMasked(line)
      if (masked) out.lines.push(masked)
    }
  }
  out.close()
}

export function memoryLines(messages: readonly ModelMessage[]): { blocks: HistoryBlock[]; lines: HistoryLine[] } {
  const out = new Collector()
  const reminderOpen = `<${REMINDER_TAG}>`
  const tool = patterns().tool
  messages.forEach((m, message) => {
    if (m.role === "user" && typeof m.content !== "string") {
      // The agent loop puts the reminder first (agent.ts userMessage); a later part is what the user typed or attached.
      const first = m.content[0]
      if (first?.type === "text" && first.text.startsWith(reminderOpen)) scanReminder(first.text, { message, part: 0 }, out)
    } else if (m.role === "tool") {
      m.content.forEach((p, part) => {
        if (p.type !== "tool-result" || p.toolName !== tool) return
        const output = p.output as { type?: string; value?: unknown }
        if (output?.type === "text" && typeof output.value === "string") scanTool(output.value, { message, part }, out)
      })
    }
  })
  return { blocks: out.blocks, lines: out.lines }
}
