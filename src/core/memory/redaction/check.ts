import { constraintDisk, failureOf, isPassing } from "../binding/constraints"
import { DEADLINE_MS, timedRead } from "../binding/timed-read"
import type { HistoryBlock } from "../notebook/history-blocks"
import { renderLessonBlock, renderThesisBlock } from "../notebook/render"
import type { PresenceRef, PresenceVersion } from "../store/presence"
import { openStoreReadOnly } from "../store/read-only"

/**
 * Whether a memory block in a session's history may stay, asked of memory.db opened only to read, the way
 * the constraint reader does: look at the file first (a drive that hangs hangs there, under the deadline),
 * open without creating, read, close at once. It runs whatever /config chose for memory.
 *
 * A mask written to a session file can never be taken back, so "deleted" is said only when the store proves
 * it: the item's or version's row is still there and marked deleted (deletes are logical; ids and version
 * numbers are never reused). A store with no such item or version at all (re-created empty on another
 * machine, reset, restored from an older backup) proves nothing, and a block whose item and version are
 * there but whose content differs (a store re-created with the same numbers, a later build that formats a
 * line differently) proves nothing either: both are "mismatch", masked in what is sent, never in the file. A block cut
 * short by the core is never compared, and a block whose label may be stored text (it starts right after the
 * output cap's mark) is never "deleted". The result carries verdicts only, never stored text.
 */

export type BlockVerdict = "deleted" | "mismatch" | "live"

export type StoreCheck =
  | { state: "checked"; verdict: (block: HistoryBlock) => BlockVerdict }
  | { state: "missing" }
  | { state: "failed"; reason: string }

export interface RedactionCheck {
  readonly file: string
  check(blocks: readonly HistoryBlock[]): Promise<StoreCheck>
}

export interface RedactionCheckOptions {
  deadlineMs?: number
  retryWindowMs?: number
  busyTimeoutMs?: number
}

/** Test seam (spyOn): the asynchronous look at the file before SQLite opens it. */
export const redactionDisk = {
  probe: (file: string) => constraintDisk.probe(file),
}

const BUSY_TIMEOUT_MS = 100

/**
 * The lines a version cannot change without becoming a new version. "Trạng thái:", "Liên quan:" and
 * "Áp dụng cho:" follow the subject (its state, its sector's version, its display name) and are left out.
 */
const FIXED: Record<HistoryBlock["kind"], readonly string[]> = {
  thesis: ["Luận điểm: ", "Sai nếu: ", "Hạn xem lại: ", "Chi tiết: "],
  lesson: ["Tiêu đề: ", "Tóm tắt: ", "Ngoại lệ: ", "Chi tiết: ", "Tag: "],
}
// A multi-line field continues on lines indented by two spaces (escape.ts).
const CONTINUED = "  "

function fixedLines(kind: HistoryBlock["kind"], lines: readonly string[]): string[] {
  const out: string[] = []
  let keep = false
  for (const line of lines) {
    if (!line.startsWith(CONTINUED)) keep = FIXED[kind].some((p) => line.startsWith(p))
    if (keep) out.push(line)
  }
  return out
}

const DETAIL = "Chi tiết: "

/** The block's fixed lines rebuilt from the stored version with render.ts, the code that wrote them. */
function rebuilt(p: PresenceVersion, withDetail: boolean): string[] {
  const text =
    p.kind === "lesson"
      ? renderLessonBlock({ ...p, appliesToDisplay: [], createdAt: "" })
      : // memory_read adds the thesis detail, the reminder never does: compare it only when the block has it.
        renderThesisBlock({ ...p, display: "", state: "watching", validFrom: "" }, { detail: withDetail })
  return fixedLines(p.kind, text.split("\n").slice(1))
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function refOf(b: HistoryBlock): PresenceRef {
  return b.kind === "lesson"
    ? { kind: "lesson", id: b.ref as number, version: b.version }
    : { kind: "thesis", name: b.ref as string, version: b.version }
}

const sameRef = (a: PresenceRef, b: PresenceRef) =>
  a.kind === b.kind && a.version === b.version && (a.kind === "lesson" ? a.id === (b as typeof a).id : a.name === (b as typeof a).name)

function verdictOf(block: HistoryBlock, present: readonly PresenceVersion[], tombstones: readonly PresenceRef[]): BlockVerdict {
  const versions = present.filter((p) =>
    block.kind === "lesson"
      ? p.kind === "lesson" && p.id === block.ref && p.version === block.version
      : p.kind === "thesis" && p.name === block.ref && p.version === block.version,
  )
  // An unsure label (right after the output cap's mark) may be stored text, not a block: never proof of deletion.
  // Only a recorded delete is proof: a store that never had the item may not be the store that sent it.
  if (versions.length === 0) return block.labelSure && tombstones.some((t) => sameRef(t, refOf(block))) ? "deleted" : "mismatch"
  if (!block.complete) return "live"
  const mine = fixedLines(block.kind, block.lines)
  const withDetail = block.lines.some((l) => l.startsWith(DETAIL))
  // A thesis name reused by another subject: one subject with this exact content is enough.
  return versions.some((p) => same(mine, rebuilt(p, withDetail))) ? "live" : "mismatch"
}

const UNCHECKED: StoreCheck = Object.freeze({ state: "checked", verdict: () => "live" as const })

export function createRedactionCheck(file: string, opts: RedactionCheckOptions = {}): RedactionCheck {
  const deadlineMs = opts.deadlineMs ?? DEADLINE_MS

  async function once(blocks: readonly HistoryBlock[]): Promise<StoreCheck> {
    if ((await redactionDisk.probe(file)) === "missing") return { state: "missing" }
    const store = openStoreReadOnly(file, { busyTimeoutMs: opts.busyTimeoutMs ?? BUSY_TIMEOUT_MS })
    if (store.state === "missing") return { state: "missing" }
    // A file with no schema yet proves nothing about what was deleted: hold, never mask for good.
    if (store.state === "empty") return { state: "failed", reason: "kho memory chưa có dữ liệu" }
    let present: PresenceVersion[]
    let tombstones: PresenceRef[]
    try {
      const refs = blocks.map(refOf)
      present = store.presence(refs)
      tombstones = store.tombstones(refs)
    } finally {
      store.close()
    }
    // Verdicts are decided here, so nothing read from the store outlives this call.
    const verdicts = new Map(blocks.map((b) => [b, verdictOf(b, present, tombstones)]))
    // A block that was not asked about is never masked.
    return { state: "checked", verdict: (b) => verdicts.get(b) ?? "live" }
  }

  return {
    file,
    async check(blocks) {
      if (blocks.length === 0) return UNCHECKED
      try {
        return await timedRead(() => once(blocks), { passing: isPassing, deadlineMs, retryWindowMs: opts.retryWindowMs })
      } catch (error) {
        return { state: "failed", reason: failureOf(file, error, deadlineMs).reason }
      }
    },
  }
}
