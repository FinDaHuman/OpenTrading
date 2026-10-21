import { createHash } from "node:crypto"
import { samePathKey } from "./path-safety"

/**
 * What the agent has read this session, per file: the edit tools require a full read before
 * overwriting or editing, and refuse when the file changed since (Claude Code's Edit tool,
 * deepseek fs-observation-policy). Kept in memory only: a resumed session reads again.
 */

export interface Observation {
  mtimeMs: number
  size: number
  /** sha1 of the bytes as read. */
  hash: string
  /** The whole file was shown: in one read, or in pages that together cover line 1 to the end. */
  full: boolean
  /** Line ranges shown so far for these bytes (1-based, inclusive, merged), and the line count. */
  ranges?: [number, number][]
  lines?: number
  at: number
}

/** A page read: lines `first`–`last` of `lines`, every line shown whole. */
export interface ReadRange {
  first: number
  last: number
  lines: number
}

export const hashBytes = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex")

/** Sorted, with touching or overlapping ranges joined. */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1)
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

export class FileState {
  private seen = new Map<string, Observation>()

  /**
   * `range`: the lines this read showed whole. Pages of the same bytes add up: once they
   * cover 1 to EOF with no gap, the file counts as fully read. A page with a cut line passes
   * no range, so it never counts.
   */
  record(abs: string, obs: Omit<Observation, "at" | "ranges" | "lines">, range?: ReadRange) {
    const key = samePathKey(abs)
    const prev = this.seen.get(key)
    const same = prev?.hash === obs.hash
    const lines = range?.lines ?? (same ? prev?.lines : undefined)
    const ranges = mergeRanges([...(same ? (prev?.ranges ?? []) : []), ...(range ? [[range.first, range.last] as [number, number]] : [])])
    const covered = lines !== undefined && ranges.length === 1 && ranges[0]![0] <= 1 && ranges[0]![1] >= lines
    // A partial read after a full one of the same bytes keeps the full flag.
    const full = obs.full || (same && prev?.full === true) || covered
    this.seen.set(key, { ...obs, full, ...(ranges.length ? { ranges } : {}), ...(lines !== undefined ? { lines } : {}), at: Date.now() })
  }

  get(abs: string): Observation | undefined {
    return this.seen.get(samePathKey(abs))
  }

  forget(abs: string) {
    this.seen.delete(samePathKey(abs))
  }

  clear() {
    this.seen.clear()
  }
}
