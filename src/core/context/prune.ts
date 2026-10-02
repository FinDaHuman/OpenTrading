/**
 * Prune old tool results after a turn: keep the most recent few verbatim and replace older ones with a placeholder
 * that points at the stored artifact. Only worth it when enough is freed, because every prune invalidates the
 * provider's prompt cache from the edited point onward.
 */

export interface ToolResultRef {
  id: string
  /** Position in history; larger is newer. */
  position: number
  tokens: number
  artifactId?: string
  /** Already replaced by a placeholder. */
  pruned?: boolean
}

export interface PrunePlan {
  ids: string[]
  freedTokens: number
}

export const prunePlaceholder = (artifactId?: string) =>
  artifactId ? `[đã dọn: artifact ${artifactId}]` : "[đã dọn: kết quả tool cũ]"

const PLACEHOLDER_TOKENS = 12

export function planPrune(
  results: readonly ToolResultRef[],
  opts: { keepRecent: number; minFreedTokens: number } = { keepRecent: 3, minFreedTokens: 20_000 },
): PrunePlan | null {
  const live = results.filter((r) => !r.pruned).sort((a, b) => b.position - a.position)
  const old = live.slice(opts.keepRecent).filter((r) => r.tokens > PLACEHOLDER_TOKENS)
  const freed = old.reduce((sum, r) => sum + r.tokens - PLACEHOLDER_TOKENS, 0)
  if (freed < opts.minFreedTokens) return null
  return { ids: old.sort((a, b) => a.position - b.position).map((r) => r.id), freedTokens: freed }
}
