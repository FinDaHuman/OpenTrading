/**
 * The one thing the notebook provider still keeps per session in RAM: which subjects are in focus (the
 * typed turns' window). What was sent, noted or pointed to is read from the history each turn
 * (history-blocks.ts), so a restart, a resumed session or a dropped turn never makes it wrong. After a
 * restart the window starts empty: only the subjects named from then on are in focus.
 */

/** Typed turns kept for focus: this one and the two before. */
const WINDOW = 3

export class SessionLedger {
  private window: number[][] = []
  private lastText?: string
  private lastLength = -1
  /** The current turn has no typed words: it picks no subject. */
  private noticeTurn = false

  constructor(readonly id: string) {}

  /**
   * Starts a turn with the subjects spotted in what the user typed. `historyLength` is the length of the
   * history the turn is sent with: the same words with no turn added since are the previous turn sent
   * again (dropped for context), not a new one.
   */
  beginTurn(typed: { text: string; noticeOnly: boolean }, detected: readonly number[], historyLength: number): void {
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
