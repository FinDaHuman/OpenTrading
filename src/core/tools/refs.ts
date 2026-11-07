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

import { appendEvidence, evidenceFile, readEvidence, type Evidence } from "./evidence"

const MAX_ENTRIES = 40
const MAX_BYTES = 8 * 1024 * 1024

export interface StoredResult {
  ref: string
  tool: string
  text: string
  at: number
  /** The session it was fetched in ("" outside a session: headless runs, tests). */
  session: string
}

const store = new Map<string, StoredResult>()
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
  evidence = dir ? evidenceFile(dir) : undefined
  for (const m of history?.matchAll(/\[ref r(\d+)\]/g) ?? []) counter = Math.max(counter, Number(m[1]))
  for (const saved of evidence ? readEvidence(evidence) : []) counter = Math.max(counter, Number(saved.ref?.slice(1) ?? 0))
}

/** Keep a full result for the session: what `recallResult` falls back on. */
export function keepEvidence(record: Omit<Evidence, "at">) {
  if (evidence) appendEvidence(evidence, { ...record, at: new Date().toISOString() })
}

export function rememberResult(tool: string, text: string): string {
  const ref = `r${++counter}`
  store.set(ref, { ref, tool, text, at: Date.now(), session })
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
  return saved && { ref: id, tool: saved.tool, text: saved.text, at: Date.parse(saved.at), session }
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
