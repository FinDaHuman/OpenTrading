import { createHash } from "node:crypto"
import { produce } from "solid-js/store"
import type { Card, CardDraft, CardKind, CardOutcome, CardState } from "../core/memory/cards/types"
import type { MemoryProvider } from "../core/memory/types"
import { openNotebookRequest } from "./dialogs/notebook-form/open"
import { say } from "./notify"
import { currentSession } from "./session"
import { setState, state, type NotebookFormRequest } from "./state"

/**
 * The session's suggestion cards (spec 007). The core checks a card's content and emits it; here it gets an
 * id named after its turn, is kept out when it repeats one still pending or dismissed, is written to the
 * session file with its turn, and changes state when the user saves it through the form or dismisses it.
 * The cards are lines of the transcript, so a resumed session rebuilds them from the file.
 */

type CardLine = Extract<(typeof state.lines)[number], { kind: "card" }>
const cardLines = () => state.lines.filter((l): l is CardLine => l.kind === "card")

/** Where each card stands, for the notebook's notes to the model (MemoryContext.cards). */
export function cardOutcomes(): CardOutcome[] {
  return cardLines().map((l) => ({ id: l.card.id, kind: l.card.kind, state: l.state, ...(l.saved ? { saved: l.saved } : {}) }))
}

const fold = (s?: string) => (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi")
const contentKey = (c: CardDraft) => [c.kind === "lesson" ? "lesson" : "rule", fold(c.text), fold(c.title), fold(c.summary)].join("|")

/**
 * The card a turn's answer ended with, named after the turn about to be recorded and noted to be written
 * with it. Undefined when it repeats a card still pending or dismissed in this session (YC-021).
 */
export function takeCard(draft: CardDraft): Card | undefined {
  const key = contentKey(draft)
  if (cardLines().some((l) => l.state !== "saved" && contentKey(l.card) === key)) return undefined
  const session = currentSession()
  const turn = session.nextTurn
  // The content's hash in the id: a dropped turn sent again with another card never shares an id.
  const id = `the-${turn}-${createHash("sha1").update(key).digest("hex").slice(0, 4)}`
  const card: Card = { ...draft, id, turn }
  session.noteCard(card)
  return card
}

function setCardState(id: string, next: CardState, saved?: CardOutcome["saved"]) {
  const index = state.lines.findIndex((l) => l.kind === "card" && l.card.id === id)
  if (index < 0) return
  setState(
    produce((s) => {
      const line = s.lines[index] as CardLine
      line.state = next
      if (saved) line.saved = saved
      if (s.cardFocus === id) s.cardFocus = undefined
    }),
  )
  void currentSession().appendCardState(id, next, saved)
}

/** The form opened from this card saved it. */
export function cardSaved(id: string, saved: { group: CardKind; id: number }) {
  setCardState(id, "saved", saved)
}

export function dismissCard(id: string) {
  setCardState(id, "dismissed")
}

/** Enter on a card: its form, filled in. A notebook that is off says so; the card stays pending. */
export function openCard(memory: MemoryProvider, id: string) {
  const line = cardLines().find((l) => l.card.id === id)
  if (!line || line.state !== "pending") return
  const c = line.card
  const request: NotebookFormRequest =
    c.kind === "lesson"
      ? { group: "lesson", title: c.title, summary: c.summary, card: { id: c.id } }
      : // The user picks the box (constraint or style), as with /nho: never chosen for them (spec 003).
        { group: "constraint", text: c.text, card: { id: c.id, quote: c.quote } }
  const why = openNotebookRequest(memory, request)
  if (why) say(why, "error", 10000)
  else setState("cardFocus", undefined)
}

/** /goiy: the newest pending card takes the keys again. */
export function focusLatestCard(): boolean {
  const pending = cardLines().filter((l) => l.state === "pending")
  const last = pending.at(-1)
  if (!last) return false
  setState("cardFocus", last.card.id)
  return true
}
