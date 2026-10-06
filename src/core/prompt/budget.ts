/**
 * Token budgets per model tier (HarnessPlan §4.4). Counts are estimates: chars / 4 is
 * rough for Vietnamese (diacritics tokenise worse), so the budgets keep ~20% headroom.
 */

export type Tier = "A" | "B" | "C"

/** A ≥ 200k context, B 64k–200k, C < 64k. Unknown context → B. */
export function tierOf(contextTokens?: number): Tier {
  if (!contextTokens) return "B"
  if (contextTokens >= 200_000) return "A"
  if (contextTokens >= 64_000) return "B"
  return "C"
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

/** Per-layer token budgets. `undefined` = never cut. 0 = dropped on that tier. */
export const BUDGETS: Record<string, Record<Tier, number | undefined>> = {
  identity: { A: undefined, B: undefined, C: undefined },
  market_clock: { A: undefined, B: undefined, C: undefined },
  investor_profile: { A: 1_400, B: 1_000, C: 600 },
  memory: { A: 1_000, B: 700, C: 300 },
  memory_policy: { A: undefined, B: undefined, C: undefined },
  hook_context: { A: 2_500, B: 2_500, C: 1_000 },
  skills_always: { A: 1_800, B: 1_200, C: 600 },
  skills_sticky: { A: 2_500, B: 1_600, C: 800 },
  skill_catalog: { A: 1_400, B: 700, C: 280 },
  deferred_tools: { A: 2_000, B: 1_200, C: 600 },
  mcp_instructions: { A: 2_000, B: 1_200, C: 500 },
  tools: { A: undefined, B: undefined, C: undefined },
  citations: { A: undefined, B: undefined, C: undefined },
  style: { A: 400, B: 250, C: 0 },
  todos: { A: 600, B: 400, C: 300 },
}

export interface Fitted {
  text: string
  tokens: number
  truncated: boolean
  dropped: boolean
}

/** Cut `text` to `budget` tokens (keeping the start) and say so, or drop it when budget is 0. */
export function fit(text: string, budget: number | undefined): Fitted {
  const tokens = estimateTokens(text)
  if (budget === undefined || tokens <= budget) return { text, tokens, truncated: false, dropped: false }
  if (budget <= 0) return { text: "", tokens: 0, truncated: false, dropped: true }
  const note = "\n[… phần còn lại đã được cắt bớt để vừa ngân sách ngữ cảnh]"
  const cut = text.slice(0, Math.max(0, budget * 4 - note.length)).trimEnd() + note
  return { text: cut, tokens: estimateTokens(cut), truncated: true, dropped: false }
}
