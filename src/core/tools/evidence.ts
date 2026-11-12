import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs"
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
  sourceInput?: unknown
  rawText?: string
  rawSha256?: string
  visibleSha256?: string
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

/**
 * What has been parsed of the file so far: `end` is the byte just past its last complete line.
 * The file only grows by appends, so a later read parses only the bytes after `end` instead of
 * the whole file (up to 64 MB) on the UI thread after every new result.
 */
let cached: { file: string; end: number; records: Evidence[] } | undefined

const parseLines = (text: string): Evidence[] =>
  text.split("\n").flatMap((line) => {
    if (!line) return []
    try {
      return [JSON.parse(line) as Evidence]
    } catch {
      return []
    }
  })

/** A line cut by a crash is skipped; the ones before it stay good. */
export function readEvidence(file: string): Evidence[] {
  let size: number
  let fd: number | undefined
  try {
    // ENOTDIR on Linux when a parent is a file: this must not stop a session from opening.
    size = statSync(file).size
    // Another file, or one that got shorter (not an append): parse it from the start.
    if (cached?.file !== file || size < cached.end) cached = { file, end: 0, records: [] }
    if (size === cached.end) return cached.records
    const bytes = Buffer.alloc(size - cached.end)
    fd = openSync(file, "r")
    const read = readSync(fd, bytes, 0, bytes.length, cached.end)
    const chunk = bytes.subarray(0, read)
    // 0x0A never occurs inside a multi-byte UTF-8 character, so cutting there is safe.
    const complete = chunk.lastIndexOf(0x0a) + 1
    cached.records = [...cached.records, ...parseLines(chunk.subarray(0, complete).toString("utf8"))]
    cached.end += complete
    // A last line without its newline yet (being written, or cut by a crash) is read every time
    // and kept only once it is complete.
    const tail = parseLines(chunk.subarray(complete).toString("utf8"))
    return tail.length > 0 ? [...cached.records, ...tail] : cached.records
  } catch {
    return []
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
