import type { Rule } from "./load"

const MANUAL = /(?<![\p{L}\p{N}])@rule:([a-z0-9-]{1,64})/gu

/** Rule names the user asked for explicitly with @rule:<name>. */
export function manualRuleNames(text: string): string[] {
  return [...new Set([...text.matchAll(MANUAL)].map((m) => m[1]!))].sort()
}

export interface MatchedRules {
  /** alwaysApply rules: stable, every turn. */
  always: Rule[]
  /** Scoped rules whose tickers or sectors are being discussed, plus manual and agent rules asked for by name. */
  scoped: Rule[]
  /** Agent-mode rules the model may fetch with load_rule: name and description only. */
  catalog: Rule[]
}

export function matchRules(
  rules: readonly Rule[],
  active: { tickers: readonly string[]; sectors: readonly string[] },
  manual: readonly string[] = [],
): MatchedRules {
  const tickers = new Set(active.tickers)
  const sectors = new Set(active.sectors)
  const asked = new Set(manual)
  const always: Rule[] = []
  const scoped: Rule[] = []
  const catalog: Rule[] = []
  for (const rule of rules) {
    if (rule.mode === "always") always.push(rule)
    else if (asked.has(rule.name)) scoped.push(rule)
    else if (
      rule.mode === "scoped" &&
      (rule.tickers.some((t) => tickers.has(t)) || rule.sectors.some((s) => sectors.has(s)))
    )
      scoped.push(rule)
    if (rule.mode === "agent") catalog.push(rule)
  }
  return { always, scoped, catalog }
}
