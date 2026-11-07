import type { ModelMessage } from "ai"
import type { Tier } from "../../prompt/budget"
import { REMINDER_TAG } from "../../reminder-tag"

/**
 * The one thing the notebook provider keeps per session in RAM: which subjects are in focus (the typed
 * turns' window). What was sent, noted or pointed to is read from the history each turn
 * (history-blocks.ts), so a restart, a resumed session or a dropped turn never makes it wrong. The window
 * itself is rebuilt from the history too: a ledger that has seen no turn yet (after a restart, a resumed
 * session) is first seeded from the user's typed words in the history, so a follow-up question keeps the
 * subjects of the turns before it.
 */

/** Typed turns kept for focus: this one and the two before. */
const WINDOW = 3

/**
 * The index as this session's requests carry it. It sits in front of the first user message, so any change
 * to it re-sends the whole conversation uncached: it is rendered once and kept while its entries all still
 * exist. An entry added later is announced by a note in that turn's reminder (append-only); only a delete
 * (ADR 0002 accepts the cache cost there) or another model tier renders it again.
 */
export interface PinnedIndex {
  tier?: Tier
  theses: ReadonlySet<number>
  lessons: ReadonlySet<number>
  text?: string
}

export class SessionLedger {
  pinnedIndex?: PinnedIndex
  private window: number[][] = []
  private lastText?: string
  private lastLength = -1
  /** The current turn has no typed words: it picks no subject. */
  private noticeTurn = false

  private seeded = false

  constructor(readonly id: string) {}

  /** True until the first turn: the window has not been rebuilt from the history yet. */
  fresh(): boolean {
    return !this.seeded
  }

  /**
   * Fills the window from earlier typed turns, oldest first (their subjects as `detect` finds them), keeping
   * the turns before the current one. Called once, before the first beginTurn.
   */
  seed(pastTyped: readonly string[], detect: (text: string) => number[]): void {
    this.seeded = true
    this.window = pastTyped.slice(-(WINDOW - 1)).map(detect)
  }

  /**
   * Starts a turn with the subjects spotted in what the user typed. `historyLength` is the length of the
   * history the turn is sent with: the same words with no turn added since are the previous turn sent
   * again (dropped for context), not a new one.
   */
  beginTurn(typed: { text: string; noticeOnly: boolean }, detected: readonly number[], historyLength: number): void {
    this.seeded = true
    this.noticeTurn = typed.noticeOnly
    if (typed.noticeOnly) return
    const resent = typed.text === this.lastText && historyLength <= this.lastLength
    if (resent && this.window.length > 0) this.window[this.window.length - 1] = [...detected]
    else this.window = [...this.window, [...detected]].slice(-WINDOW)
    this.lastText = typed.text
    this.lastLength = historyLength
  }

  /**
   * Subjects in focus, highest priority first: spotted this turn (in order of appearance), then those
   * spotted in the previous typed turn, then the one before. Carried subjects are not carried again.
   */
  focus(): { subjectId: number; detected: boolean }[] {
    if (this.noticeTurn) return []
    const out: { subjectId: number; detected: boolean }[] = []
    const seen = new Set<number>()
    const turns = [...this.window].reverse()
    turns.forEach((ids, age) => {
      for (const subjectId of ids) {
        if (seen.has(subjectId)) continue
        seen.add(subjectId)
        out.push({ subjectId, detected: age === 0 })
      }
    })
    return out
  }
}

// Attached files (mentions.ts) are not the user's words; kept as a literal to keep this module light.
const ATTACHMENT = "<tep_dinh_kem "

/**
 * The user's typed words of each user message in `history`, oldest first: reminder blocks (memory, the
 * compaction marker) and attached files left out, messages with nothing typed skipped. Notifications are
 * still in; the caller strips them (typedText).
 */
export function typedTurns(history: readonly ModelMessage[]): string[] {
  const out: string[] = []
  for (const m of history) {
    if (m.role !== "user") continue
    const parts = typeof m.content === "string" ? [m.content] : m.content.flatMap((p) => (p.type === "text" ? [p.text] : []))
    const text = parts
      .filter((t) => !t.startsWith(`<${REMINDER_TAG}>`) && !t.startsWith(ATTACHMENT))
      .join("\n")
      .trim()
    if (text) out.push(text)
  }
  return out
}

/** One window per session for the life of the app. */
export class Ledgers {
  private sessions = new Map<string, SessionLedger>()

  session(id: string): SessionLedger {
    let ledger = this.sessions.get(id)
    if (!ledger) {
      ledger = new SessionLedger(id)
      this.sessions.set(id, ledger)
    }
    return ledger
  }
}
