/**
 * Size limits of the v5.1 memory, in one table. Every number says why it is what it is; change one
 * only with a reason. Lengths are counted in user-perceived characters (grapheme clusters, after NFC),
 * so "Hòa Phát" is 8 whatever keyboard typed it. Over a limit, a save is refused; nothing is ever cut.
 */
export const MEMORY_LIMITS = {
  constraintItem: { max: 200, why: "Constraints go into every request, sub-agents included, and are never cut" },
  constraintTotal: { max: 1_500, why: "Total of active constraints, reserved in every request's budget" },
  styleTotal: { max: 1_000, why: "Presentation style shares the system prompt with constraints" },
  thesisText: { max: 350, why: "The thesis line is injected as a labelled block when its subject is in focus" },
  thesisDetail: { max: 4_000, why: "Detail is read on demand through memory_read, never injected" },
  thesisConditions: { max: 8, why: "Each 'wrong if' condition is checked one by one in an answer" },
  thesisCondition: { max: 160, why: "One checkable condition per line" },
  lessonTitle: { max: 120, why: "Titles are listed in the index on every request" },
  lessonSummary: { max: 320, why: "The summary must carry the rule and its exceptions when read quickly" },
  lessonExceptions: { max: 320, why: "Read with the summary, so the same size" },
  lessonDetail: { max: 4_000, why: "Read on demand through memory_read" },
  lessonTags: { max: 10, why: "Tags only filter the /memory list" },
  lessonTag: { max: 40, why: "A tag is a word or two" },
  lessonAppliesTo: { max: 20, why: "A lesson for a whole sector names the sector subject, not each of its tickers" },
  decisionAction: { max: 120, why: "One line: what was done" },
  decisionReason: { max: 2_000, why: "The user's own reasoning, kept on this machine only" },
  decisionExpectation: { max: 2_000, why: "Same room as the reason" },
  decisionChangeMind: { max: 2_000, why: "Same room as the reason" },
  alias: { max: 40, why: "Long enough for a sector name such as 'Bất động sản khu công nghiệp'" },
} as const satisfies Record<string, { max: number; why: string }>

export type LimitKey = keyof typeof MEMORY_LIMITS

const graphemes = new Intl.Segmenter("vi", { granularity: "grapheme" })

/** Characters as a reader counts them: an emoji with a skin tone is 1, a decomposed "à" is 1. */
export function countChars(text: string): number {
  let n = 0
  for (const _ of graphemes.segment(text.normalize("NFC"))) n++
  return n
}
