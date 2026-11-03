/**
 * What the notebook provider has sent in each session, kept in RAM only: nothing here is saved, and after
 * a restart, a resumed session or a compaction it no longer matches the history (a known limit of this
 * minimal version; the core will hand memory the labels in history later).
 *
 * A turn's blocks, notes and pointers are pending until the turn-end hook shows their label in the turn's
 * messages: only then do they count as sent. A turn that never ends normally (cut for context and resent,
 * stopped, failed) leaves them pending, and the next turn drops them, so a block is sent again rather than
 * missing.
 */

export interface SentMark {
  version: number
  /** Thesis state as sent, so a later change can be noted. */
  state?: string
  /** Display name as sent, for a note after the thesis is gone. */
  name?: string
}

export interface Pending {
  /** Text whose presence in the turn's messages proves this reached the history. */
  label: string
  sent?: [key: string, mark: SentMark]
  notified?: string
  pointer?: string
  /** Reason of a store error line. */
  error?: string
}

/** Typed turns kept for focus: this one and the two before. */
const WINDOW = 3

export class SessionLedger {
  /** Items whose content is in the history, by key ("thesis:<subjectId>", "lesson:<id>"). */
  readonly sent = new Map<string, SentMark>()
  /** Changes already noted (key + what changed), so each is noted once. */
  readonly notified = new Set<string>()
  /** Pointers already sent (key + version + case). */
  readonly pointers = new Set<string>()
  /** Reason of the store error line already sent in this session. */
  errorSent?: string

  private pending: Pending[] = []
  private confirmed = true
  /** A turn of notifications only: no turn-end will come, so what it adds counts at once. */
  private autoConfirm = false
  /** The current turn has no typed words: it picks no subject. */
  private noticeTurn = false
  private window: number[][] = []
  private lastText?: string

  constructor(readonly id: string) {}

  /** Starts a turn with the subjects spotted in what the user typed. */
  beginTurn(typed: { text: string; noticeOnly: boolean }, detected: readonly number[]): void {
    const resent = !this.confirmed && !typed.noticeOnly && typed.text === this.lastText
    this.pending = []
    this.confirmed = false
    this.autoConfirm = false
    this.noticeTurn = typed.noticeOnly
    if (typed.noticeOnly) return
    // The same words again after a turn that never ended: the same turn resent (after compaction), not a new one.
    if (resent && this.window.length > 0) this.window[this.window.length - 1] = [...detected]
    else this.window = [...this.window, [...detected]].slice(-WINDOW)
    this.lastText = typed.text
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

  /** Records something sent this turn; it counts once confirmed. */
  add(p: Pending): void {
    if (this.autoConfirm) this.apply(p)
    else this.pending.push(p)
  }

  /** turn-end: what this turn's messages carry counts as sent; the rest is dropped. */
  confirm(messages: readonly unknown[]): void {
    const strings: string[] = []
    collectText(messages, strings)
    const text = strings.join("\n")
    for (const p of this.pending) if (text.includes(p.label)) this.apply(p)
    this.pending = []
    this.confirmed = true
  }

  /** A turn the core runs without hooks: no other signal will come. */
  confirmAll(): void {
    for (const p of this.pending) this.apply(p)
    this.pending = []
    this.confirmed = true
    this.autoConfirm = true
  }

  private apply(p: Pending) {
    if (p.sent) this.sent.set(p.sent[0], p.sent[1])
    if (p.notified) this.notified.add(p.notified)
    if (p.pointer) this.pointers.add(p.pointer)
    if (p.error !== undefined) this.errorSent = p.error
  }
}

/** Every string inside the messages: text parts, tool outputs. Image data is skipped. */
function collectText(value: unknown, out: string[]) {
  if (typeof value === "string") out.push(value)
  else if (Array.isArray(value)) for (const v of value) collectText(v, out)
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) if (key !== "image" && key !== "data") collectText(v, out)
  }
}

/** One ledger per session for the life of the app; the session of the latest call is current. */
export class Ledgers {
  private sessions = new Map<string, SessionLedger>()
  current?: SessionLedger

  session(id: string): SessionLedger {
    let ledger = this.sessions.get(id)
    if (!ledger) {
      ledger = new SessionLedger(id)
      this.sessions.set(id, ledger)
    }
    this.current = ledger
    return ledger
  }

  confirm(sessionId: string, messages: readonly unknown[]): void {
    this.sessions.get(sessionId)?.confirm(messages)
  }
}
