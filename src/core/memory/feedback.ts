/**
 * Learning rules, kept pure so they can be tested without a database.
 * Usage statistics come only from memory_usage; nothing is cached on the item.
 */

/** A lesson is switched off when at least `harmful` of its last `window` applications were rated harmful. */
export function shouldAutoDisable(
  recent: readonly { harmful: boolean }[],
  rule: { window: number; harmful: number },
): boolean {
  return recent.slice(0, rule.window).filter((a) => a.harmful).length >= rule.harmful
}

/** A lesson that has been helpful several times and never harmful is a candidate for a human-written rule. */
export function isPromotionCandidate(counts: { applied: number; helpful: number; harmful: number }): boolean {
  return counts.helpful >= 3 && counts.harmful === 0 && counts.applied >= 5
}
