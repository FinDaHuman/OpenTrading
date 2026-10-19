import { createHash } from "node:crypto"
import { samePathKey } from "./path-safety"

/**
 * What the agent has read this session, per file: the edit tools require a full read before
 * overwriting or editing, and refuse when the file changed since (Claude Code readFileState,
 * deepseek fs-observation-policy). Kept in memory only: a resumed session reads again.
 */

export interface Observation {
  mtimeMs: number
  size: number
  /** sha1 of the bytes as read. */
  hash: string
  /** The whole file was shown (no offset/limit cut, no page range). */
  full: boolean
  at: number
}

export const hashBytes = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex")

export class FileState {
  private seen = new Map<string, Observation>()

  record(abs: string, obs: Omit<Observation, "at">) {
    const key = samePathKey(abs)
    const prev = this.seen.get(key)
    // A partial read after a full one of the same bytes keeps the full flag.
    const full = obs.full || (prev?.full === true && prev.hash === obs.hash)
    this.seen.set(key, { ...obs, full, at: Date.now() })
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
