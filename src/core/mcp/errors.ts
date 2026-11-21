/**
 * MCP errors as the model reads them (#326). A server's error can be a whole HTML page (a
 * proxy in front of it), a stack trace, or paragraphs of prose; the model needs one short
 * line plus the codes it acts on (HTTP status, `error_code` / `reason`, retry hints) to
 * decide whether to try again or state what is missing.
 */

/** Longest MCP error text the model reads; the codes are kept even when the text is cut. */
export const MAX_MODEL_ERROR = 300

/**
 * An error the harness worded for the model itself (retry advice, quota, sign-in): it is
 * already short and English, so the sanitiser passes it through.
 */
export class McpModelError extends Error {}

/** Envelope fields worth keeping, in the order they are shown. */
const FIELDS = ["error_code", "error", "reason", "status", "retryable", "retry_after", "retry_after_s"] as const

/** `"key": "short value"` or `"key": 12` / `true`, as JSON or JSON-like text writes it. */
function field(text: string, key: string) {
  const m = new RegExp(`"${key}"\\s*:\\s*(?:"([^"\\\\\\n]{1,60})"|(-?\\d+(?:\\.\\d+)?|true|false)\\b)`).exec(text)
  return m ? (m[1] ?? m[2]) : undefined
}

/** The codes a raw error carries, found before any cutting so none is lost. */
function codesOf(raw: string, status?: number) {
  const codes: string[] = []
  const http = status ?? Number(/\bHTTP (\d{3})\b/.exec(raw)?.[1] ?? NaN)
  if (Number.isFinite(http)) codes.push(`HTTP ${http}`)
  const rpc = /\bMCP error (-?\d+):/.exec(raw)?.[1]
  if (rpc) codes.push(`code ${rpc}`)
  for (const key of FIELDS) {
    const value = field(raw, key)
    if (value === undefined) continue
    if (key === "status" && Number(value) === http) continue
    codes.push(`${key}=${value}`)
  }
  return codes
}

/** Drop JS (`    at f (file:1:2)`) and Python (`Traceback …`, `  File "…"`) stack frames. */
function dropStacks(text: string) {
  const out: string[] = []
  let frame = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s+at\s+\S/.test(line) || /^\s*Traceback \(most recent call last\)/.test(line)) continue
    if (/^\s+File "/.test(line)) {
      frame = true
      continue
    }
    // The source line Python prints under each `File` line.
    if (frame && /^\s{4,}\S/.test(line)) continue
    frame = false
    out.push(line)
  }
  return out.join("\n")
}

/** A JSON error body reads better as its message than as JSON. */
function messageOf(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return text
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    for (const key of ["message", "detail", "error_description", "error"]) {
      const value = parsed[key]
      if (typeof value === "string" && value.trim()) return value
      if (value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") return (value as { message: string }).message
    }
  } catch {}
  return text
}

/**
 * One short English line for the model: HTML pages reduced to their title, stack frames
 * dropped, whitespace collapsed, cut to `max` characters with the codes appended after the
 * cut (`… [HTTP 502, reason=upstream_down]`).
 */
export function modelErrorText(raw: string, opts: { status?: number; max?: number } = {}): string {
  const max = opts.max ?? MAX_MODEL_ERROR
  const codes = codesOf(raw, opts.status)
  let body = raw
  const html = body.search(/<!doctype html|<html[\s>]/i)
  if (html >= 0) {
    const title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim()
    body = `${body.slice(0, html).trim()} [HTML error page${title ? ` "${title}"` : ""}]`
  }
  body = messageOf(dropStacks(body))
    .replace(/\bMCP error -?\d+:\s*/g, "")
    .replace(/<[^>]{1,200}>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!body) body = "the server reported an error without a message"
  // Codes take at most half the room, so a server listing many fields still leaves a reason.
  let tag = codes.length > 0 ? ` [${codes.join(", ")}]` : ""
  if (tag.length > max / 2) tag = tag.slice(0, Math.floor(max / 2) - 2) + "…]"
  const room = max - tag.length
  if (body.length > room) body = body.slice(0, room - 1).trimEnd() + "…"
  return body + tag
}
