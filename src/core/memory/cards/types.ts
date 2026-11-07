/**
 * Suggestion cards (spec 007): the model proposes saving a constraint, a presentation style or a lesson in a
 * block at the end of its answer; the harness strips the block before history and shows a card. Nothing is
 * stored until the user confirms the spec-003 form the card opens.
 */

export type CardKind = "constraint" | "style" | "lesson"

/** A card's content, checked by the core; the TUI gives it an id and the turn it belongs to. */
export interface CardDraft {
  kind: CardKind
  /** constraint, style: the rule as the model proposes it. */
  text?: string
  /** constraint, style: the user's own words this turn, shown next to the proposal. */
  quote?: string
  /** lesson. */
  title?: string
  summary?: string
}

export interface Card extends CardDraft {
  id: string
  turn: number
}

export type CardState = "pending" | "saved" | "dismissed"

/** Where a card stands, for the notebook's notes to the model. */
export interface CardOutcome {
  id: string
  kind: CardKind
  state: CardState
  /** What the user saved it as (the form may turn a constraint into a style). */
  saved?: { group: CardKind; id: number }
}
