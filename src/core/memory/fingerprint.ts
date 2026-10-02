import { createHash } from "node:crypto"
import { foldVietnamese } from "./schema"

/**
 * Identity of a memory's meaning-bearing text, used to avoid proposing again what the user already rejected or
 * deleted. Salted with a per-installation secret kept outside the database, so a leaked database does not let
 * anyone confirm guesses about deleted content by hashing candidates.
 */
export function fingerprint(salt: string, kind: string, scope: string, text: string): string {
  const normal = foldVietnamese(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
  return createHash("sha256").update(`${salt}\n${kind}\n${scope}\n${normal}`).digest("hex")
}

/** Folded word set, to tell whether a proposal only repeats a rule. */
export function words(text: string): Set<string> {
  return new Set(
    foldVietnamese(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2),
  )
}

/** True when nearly every word of `candidate` already appears in `rule`. */
export function coveredBy(candidate: string, rule: string, threshold = 0.85): boolean {
  const c = words(candidate)
  if (c.size === 0) return false
  const r = words(rule)
  let hit = 0
  for (const w of c) if (r.has(w)) hit++
  return hit / c.size >= threshold
}
