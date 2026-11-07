import type { ModelMessage } from "ai"
import { memoryLines, type HistoryBlock } from "../notebook/history-blocks"
import { heldLesson, heldThesis, maskedLesson, maskedThesis } from "../notebook/render"
import type { RedactionCheck, StoreCheck } from "./check"

/**
 * Masking memory blocks in a list of messages. Two kinds of mask:
 * - for good ("đã bị người dùng xoá"): the store proved the item gone. It replaces the block in the history
 *   the open session keeps, and the items go into one redact line of the session file;
 * - held ("tạm che"): the store is missing or unreadable, or the block's content differs from the stored
 *   version. Only what is sent is masked; the history and the file keep the block, so it comes back as it
 *   was once the store can vouch for it.
 * Only the block's own characters change: everything else in the message is passed on byte for byte.
 */

export type RedactItem =
  | { kind: "lesson"; id: number; versions: number[] }
  | { kind: "thesis"; name: string; versions: number[] }

export interface Redaction {
  /** History with masks for good applied: what the open session keeps. */
  kept: ModelMessage[]
  /** What is sent: `kept` plus held masks (no store or unreadable: every block; checked: "mismatch" blocks). */
  sent: ModelMessage[]
  /** Items the store confirmed deleted or absent: one redact line in the session file. */
  record: RedactItem[]
  /** Present only when some block is held. */
  temporary?: { state: "missing" | "failed" | "mismatch"; reason?: string; blocks: number }
}

const masked = (b: HistoryBlock) => (b.kind === "lesson" ? maskedLesson(b.ref as number) : maskedThesis(b.ref as string))
const held = (b: HistoryBlock) =>
  b.kind === "lesson" ? heldLesson(b.ref as number, b.version) : heldThesis(b.ref as string, b.version)

type Edit = { block: HistoryBlock; text: string }

/** The text a block sits in: a reminder text part, or a memory_read result's text output. */
function textOf(part: unknown): string {
  const p = part as { type: string; text?: string; output?: { value: string } }
  return p.type === "text" ? p.text! : p.output!.value
}
function withText(part: unknown, text: string): unknown {
  const p = part as { type: string; output?: object }
  return p.type === "text" ? { ...p, text } : { ...p, output: { ...p.output, value: text } }
}

/** Applies the edits; messages and parts nothing touched are the same objects as before. */
function replace(messages: readonly ModelMessage[], edits: readonly Edit[]): ModelMessage[] {
  if (edits.length === 0) return [...messages]
  const byPart = new Map<string, Edit[]>()
  for (const e of edits) {
    const key = `${e.block.at.message}:${e.block.at.part}`
    byPart.set(key, [...(byPart.get(key) ?? []), e])
  }
  return messages.map((m, message) => {
    if (typeof m.content === "string") return m
    let content: unknown[] | undefined
    m.content.forEach((part, index) => {
      const list = byPart.get(`${message}:${index}`)
      if (!list) return
      // From the end, so earlier ranges keep their offsets.
      let text = textOf(part)
      for (const e of [...list].sort((a, b) => b.block.at.start - a.block.at.start)) {
        text = text.slice(0, e.block.at.start) + e.text + text.slice(e.block.at.end)
      }
      content ??= [...m.content]
      content[index] = withText(part, text)
    })
    return content ? ({ ...m, content } as ModelMessage) : m
  })
}

/** One entry per item, versions sorted, in order of first appearance. */
export function mergeItems(...lists: readonly RedactItem[][]): RedactItem[] {
  const items = new Map<string, RedactItem>()
  for (const i of lists.flat()) {
    const key = i.kind === "lesson" ? `lesson:${i.id}` : `thesis:${i.name}`
    const item = items.get(key) ?? { ...i, versions: [] }
    for (const v of i.versions) if (!item.versions.includes(v)) item.versions.push(v)
    items.set(key, item)
  }
  for (const item of items.values()) item.versions.sort((a, b) => a - b)
  return [...items.values()]
}

const group = (blocks: readonly HistoryBlock[]) =>
  mergeItems(
    blocks.map((b): RedactItem =>
      b.kind === "lesson"
        ? { kind: "lesson", id: b.ref as number, versions: [b.version] }
        : { kind: "thesis", name: b.ref as string, versions: [b.version] },
    ),
  )

export async function redactHistory(
  messages: readonly ModelMessage[],
  check: RedactionCheck | undefined,
): Promise<Redaction> {
  const unchanged = (): Redaction => ({ kept: [...messages], sent: [...messages], record: [] })
  if (!check) return unchanged()
  const { blocks } = memoryLines(messages)
  // No block: the store is never opened and nothing is said (a user who never used the notebook).
  if (blocks.length === 0) return unchanged()
  return applyCheck(messages, blocks, await check.check(blocks))
}

/**
 * The masks a check's answer calls for. `blocks` must be the very objects the check was asked about
 * (memoryLines of these messages): a block it was not asked about counts as live.
 */
export function applyCheck(messages: readonly ModelMessage[], blocks: readonly HistoryBlock[], result: StoreCheck): Redaction {
  if (blocks.length === 0) return { kept: [...messages], sent: [...messages], record: [] }
  if (result.state !== "checked") {
    return {
      kept: [...messages],
      sent: replace(
        messages,
        blocks.map((block) => ({ block, text: held(block) })),
      ),
      record: [],
      temporary: { state: result.state, ...(result.state === "failed" ? { reason: result.reason } : {}), blocks: blocks.length },
    }
  }
  const deleted = blocks.filter((b) => result.verdict(b) === "deleted")
  const differ = blocks.filter((b) => result.verdict(b) === "mismatch")
  const forGood = deleted.map((block) => ({ block, text: masked(block) }))
  return {
    kept: replace(messages, forGood),
    sent: replace(messages, [...forGood, ...differ.map((block) => ({ block, text: held(block) }))]),
    record: group(deleted),
    ...(differ.length > 0 ? { temporary: { state: "mismatch" as const, blocks: differ.length } } : {}),
  }
}

/**
 * A redact line of a session file applied to the messages before it: blocks of the listed items and
 * versions are masked for good. The caller applies each line where it stands in the file, so a block
 * written after the line is untouched.
 */
export function applyRedactLines(messages: readonly ModelMessage[], items: readonly RedactItem[]): ModelMessage[] {
  // A label right after the output cap's mark may be stored text: a line never masks it (the live check
  // never calls it deleted either), so a reloaded session matches what was sent.
  const hit = (b: HistoryBlock) =>
    b.labelSure &&
    items.some(
      (i) =>
        i.kind === b.kind && (i.kind === "lesson" ? i.id === b.ref : i.name === b.ref) && i.versions.includes(b.version),
    )
  const blocks = memoryLines(messages).blocks.filter(hit)
  return replace(
    messages,
    blocks.map((block) => ({ block, text: masked(block) })),
  )
}

/** What the user is told, once per state, when blocks are held. */
export function temporaryNotice(t: NonNullable<Redaction["temporary"]>): string {
  if (t.state === "missing") return "Không tìm thấy kho memory; các khối memory trong phiên này tạm được che cho tới khi có lại kho."
  if (t.state === "failed") return `Kho memory không đọc được: ${t.reason}; các khối memory trong phiên này tạm được che.`
  return "Một số khối memory trong phiên này khác bản đang có trong kho (có thể kho đã được tạo lại); các khối đó tạm được che."
}
