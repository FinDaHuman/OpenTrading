import { escapeXml } from "./render"
import type { MemoryItem } from "./schema"

/**
 * T3: when T1 and T2 leave relevant memories out, a small model picks up to five more from a manifest.
 * The manifest has id, kind, scope, title and date only: never bodies, stats, other statuses or restricted items.
 * The selector is injected (the core owns models); memory never builds a provider itself.
 */
export type T3Selector = (input: { manifest: string; question: string; signal: AbortSignal }) => Promise<string[]>

export const T3_MAX_PICKS = 5

export function renderManifest(items: readonly MemoryItem[]): string {
  return items
    .filter((i) => i.status === "active" && i.visibility === "model")
    .map((i) =>
      [i.id, i.kind, i.scope, escapeXml(i.title ?? (i.body ?? "").slice(0, 80).replace(/\s+/g, " ")), i.asOf].join(
        " | ",
      ),
    )
    .join("\n")
}

export type T3Outcome = { ids: string[] } | { ids: []; timedOut: true } | { ids: []; failed: true }

/**
 * Run the selector with a deadline. Only ids from the candidate list are accepted (an allowlist), at most five,
 * in candidate order. Slow or failing selectors are skipped: the turn goes on without T3.
 */
export async function pickWithT3(
  select: T3Selector,
  candidates: readonly MemoryItem[],
  question: string,
  timeoutMs: number,
): Promise<T3Outcome> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs)
  })
  try {
    const result = await Promise.race([
      select({ manifest: renderManifest(candidates), question, signal: controller.signal }),
      deadline,
    ])
    if (result === "timeout") {
      controller.abort()
      return { ids: [], timedOut: true }
    }
    const allowed = new Set(Array.isArray(result) ? result.filter((x): x is string => typeof x === "string") : [])
    return {
      ids: candidates
        .filter((c) => allowed.has(c.id))
        .slice(0, T3_MAX_PICKS)
        .map((c) => c.id),
    }
  } catch {
    return { ids: [], failed: true }
  } finally {
    clearTimeout(timer)
  }
}
