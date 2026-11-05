import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

/**
 * Every MCP result of a session, in full, next to the session file. Market data fetched again
 * differs from what an answer already cited, so the numbers an answer rests on have to stay
 * readable after a restart or a compaction. Outside the session's own JSONL, which keeps the
 * capped text, and one JSON line per result, so a killed process keeps what it wrote.
 */
export interface Evidence {
  /** `rN` when the result got one; a single-row result has none. */
  ref?: string
  callId: string
  tool: string
  input: unknown
  /** When it was fetched. The envelope in `text` says how old the data is. */
  at: string
  text: string
}

/** A session past this keeps working on what it has; refs newer than the cap live in RAM only. */
const MAX_BYTES = 64 * 1024 * 1024

export const evidenceFile = (sessionDir: string) => path.join(sessionDir, "evidence", "results.jsonl")

/**
 * Synchronous, because a turn may end right after: a tool result is rare next to the network
 * call that made it. Never throws: losing a copy must not fail the tool call.
 */
export function appendEvidence(file: string, record: Evidence) {
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) return
    mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(record)}\n`)
  } catch {}
}

/** Parsed once per size: a skill reads the same refs many times, and this runs on the UI thread. */
let cached: { file: string; size: number; records: Evidence[] } | undefined

/** A line cut by a crash is skipped; the ones before it stay good. */
export function readEvidence(file: string): Evidence[] {
  let size: number
  let text: string
  try {
    // ENOTDIR on Linux when a parent is a file: this must not stop a session from opening.
    size = statSync(file).size
    if (cached?.file === file && cached.size === size) return cached.records
    text = readFileSync(file, "utf8")
  } catch {
    return []
  }
  const records = text.split("\n").flatMap((line) => {
    if (!line) return []
    try {
      return [JSON.parse(line) as Evidence]
    } catch {
      return []
    }
  })
  cached = { file, size, records }
  return records
}
