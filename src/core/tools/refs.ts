/**
 * Raw results of recent data tool calls, by a short ref the model can name (`r3`).
 *
 * Provider call IDs are not visible to every model (Gemini has none the model can read), so
 * the harness stamps `[ref rN]` at the head of each MCP result that carries a data array and
 * keeps the untruncated text here. `chart_render({from_call: "r3"})` then reads the numbers
 * itself: the model never re-types them, and the chart may hold more points than the
 * (truncated) text the model saw. Process-wide, so subagent results are reachable too. RAM holds
 * the recent ones; the session's evidence file (evidence.ts) answers for the rest, also after a
 * restart.
 *
 * Each result belongs to the session that was open when it came in: a resumed session's
 * history may name `r1` for data this process never saw, and another session's `r1` must not
 * answer for it.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { appendEvidence, evidenceFile, readEvidence, type Evidence } from "./evidence"

const MAX_ENTRIES = 40
const MAX_BYTES = 8 * 1024 * 1024

export interface StoredResult {
  ref: string
  tool: string
  text: string
  callId?: string
  sourceInput?: unknown
  rawText?: string
  rawSha256?: string
  visibleSha256?: string
  at: number
  /** The session it was fetched in ("" outside a session: headless runs, tests). */
  session: string
}

/** A data result written as <ref>.json is at most this big; larger ones stay in RAM and evidence only. */
export const RESULT_FILE_MAX_BYTES = 5 * 1024 * 1024
/** All result files of a session together. */
export const RESULT_FILES_MAX_BYTES = 50 * 1024 * 1024

const store = new Map<string, StoredResult>()
/**
 * Where each data result is also written as `<ref>.json` for scripts (issue #309 A2): a shell
 * command cannot read the tool results the model sees, so without a file it re-types the numbers,
 * the commonest source of wrong arithmetic. undefined: not written.
 */
let exportDir: (() => string | undefined) | undefined
let exportedBytes = 0
let counter = 0
let bytes = 0
let session = ""
/** The open session's evidence file; undefined with no session folder (headless runs). */
let evidence: string | undefined

/**
 * The session new results belong to and refs resolve in (start, /new, resume). `history`:
 * the resumed conversation, so new refs never reuse a number it already names. `dir`: the
 * session's folder, whose evidence also holds the refs subagents took.
 */
export function useResultSession(id: string, history?: string, dir?: string) {
  session = id
  exportedBytes = 0
  evidence = dir ? evidenceFile(dir) : undefined
  for (const m of history?.matchAll(/\[ref r(\d+)\]/g) ?? []) counter = Math.max(counter, Number(m[1]))
  for (const saved of evidence ? readEvidence(evidence) : []) counter = Math.max(counter, Number(saved.ref?.slice(1) ?? 0))
}

/** Keep a full result for the session: what `recallResult` falls back on. */
export function keepEvidence(record: Omit<Evidence, "at">) {
  if (evidence) appendEvidence(evidence, { ...record, at: new Date().toISOString() })
}

/** Write data results as `<ref>.json` into this folder (a function: the session's temp folder may move); undefined stops it. */
export function exportResultsTo(dir: string | (() => string | undefined) | undefined) {
  exportDir = typeof dir === "string" ? () => dir : dir
}

/** The folder data results are written to now, if any. */
export function resultExportDir(): string | undefined {
  return exportDir?.()
}

/** The JSON a result carries (the text after any label line), or undefined when it holds none. */
function resultJson(text: string): string | undefined {
  // A label line may itself open with "[" ("[nguồn: …]"): try each opening within the head.
  for (let start = 0; start <= 200 && start < text.length; start++) {
    if (text[start] !== "[" && text[start] !== "{") continue
    const body = text.slice(start)
    try {
      JSON.parse(body)
      return body
    } catch {}
  }
  return undefined
}

function writeResultFile(ref: string, text: string) {
  const dir = resultExportDir()
  if (!dir || text.length > RESULT_FILE_MAX_BYTES) return
  const body = resultJson(text)
  if (body === undefined) return
  const size = Buffer.byteLength(body)
  if (size > RESULT_FILE_MAX_BYTES || exportedBytes + size > RESULT_FILES_MAX_BYTES) return
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${ref}.json`), body)
    exportedBytes += size
  } catch {
    // A full disk or a read-only folder only loses the copy; the result itself is unaffected.
  }
}

export function rememberResult(tool: string, text: string, source: Partial<Pick<StoredResult, "callId" | "sourceInput" | "rawText" | "rawSha256" | "visibleSha256">> = {}): string {
  const ref = `r${++counter}`
  store.set(ref, { ref, tool, text, at: Date.now(), session, ...source })
  // The text the model read (dates already ISO, normalizeNetDates in wrap.ts; not yet capped), not the raw
  // reply: a script must see the same dates as the model. Its sha256 is the evidence row's `visibleSha256`
  // when the result is plain JSON (#311 review F5).
  writeResultFile(ref, text)
  bytes += text.length
  while (store.size > MAX_ENTRIES || bytes > MAX_BYTES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    bytes -= store.get(oldest)!.text.length
    store.delete(oldest)
  }
  return ref
}

/** A ref of the current session; another session's result is as gone as an evicted one. */
export function recallResult(ref: string): StoredResult | undefined {
  const id = ref.trim().replace(/^\[?ref\s+/i, "").replace(/\]$/, "")
  const stored = store.get(id)
  if (stored?.session === session) return stored
  const saved = evidence ? readEvidence(evidence).find((e) => e.ref === id) : undefined
  return saved && { ref: id, tool: saved.tool, text: saved.text, at: Date.parse(saved.at), session, callId: saved.callId, sourceInput: saved.sourceInput ?? saved.input, rawText: saved.rawText, rawSha256: saved.rawSha256, visibleSha256: saved.visibleSha256 }
}

/** A result of the open session by ref or call id: the evidence file, or RAM in a headless run. */
export function findResult(id: string): Pick<Evidence, "ref" | "tool" | "text" | "at"> | undefined {
  const saved = evidence ? readEvidence(evidence).find((e) => e.ref === id || e.callId === id) : undefined
  if (saved) return saved
  const stored = recallResult(id)
  return stored && { ref: stored.ref, tool: stored.tool, text: stored.text, at: new Date(stored.at).toISOString() }
}

/** Refs of the current session still stored, oldest first. */
export function storedResults(): StoredResult[] {
  return [...store.values()].filter((r) => r.session === session)
}

/** Tests only. */
export function clearResults() {
  store.clear()
  counter = 0
  bytes = 0
  exportDir = undefined
  exportedBytes = 0
  session = ""
  evidence = undefined
}

/** Parse a JSON tool result; non-JSON text (or a JSON prefix line) yields undefined. */
export function parseResult(text: string): unknown {
  const start = text.search(/[[{]/)
  if (start < 0 || start > 200) return undefined
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return undefined
  }
}

/** Whether a parsed result holds an array worth charting: ≥3 numbers, or ≥2 objects with a number. */
export function hasDataArray(value: unknown, depth = 0): boolean {
  if (depth > 5 || value === null || typeof value !== "object") return false
  if (Array.isArray(value)) {
    if (value.length >= 3 && value.every((v) => typeof v === "number")) return true
    if (value.length >= 2 && value.some((v) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((x) => typeof x === "number"))) {
      return true
    }
    return value.slice(0, 20).some((v) => hasDataArray(v, depth + 1))
  }
  return Object.values(value).some((v) => hasDataArray(v, depth + 1))
}

export const REF_PREFIX = "[ref "
