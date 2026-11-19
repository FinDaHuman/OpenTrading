/**
 * What an OpenTrading data server's result says about its own data. A source that failed comes
 * back as a normal result (`availability: "unavailable"`, isError false), so without this the
 * model and the UI read an outage as data. Nothing here retries: the server's negative cache
 * answers an immediate repeat with the same failure, and every call costs quota. The model
 * decides, from a line that says what happened and what it can do.
 *
 * A wait or an alternative tool is stated only when the server gave one. Guessing would stop the
 * model from a repeat that may work: the negative cache often has far less than its 90s left.
 */

/** First line of a result whose source failed; the UI and compaction recognise it. */
export const SOURCE_FAILED_PREFIX = "[Source failed]"

const MAX_WARNING_CHARS = 160
const MAX_ENVELOPE_CHARS = 5_000_000

export interface SourceState {
  availability: "unavailable" | "partial" | "stale"
  reason?: string
  retryable?: boolean
  retryAfterS?: number
  alternatives: string[]
  warning?: string
}

/** Why a source failed, for the `reason` values the server sends. */
const REASONS: Record<string, string> = {
  upstream_timeout: "the source timed out",
  upstream_down: "the source is down",
  upstream_rate_limited: "the source is rate-limiting",
  not_configured: "the source is not configured",
  auth_missing: "the source needs a login",
  recent_failure: "the source just failed",
  busy: "the server is overloaded",
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [])

/** The state of a result that is not plainly available; undefined for anything else, JSON or not. */
export function readSourceState(text: string): SourceState | undefined {
  if (text.length > MAX_ENVELOPE_CHARS || !text.includes('"availability"')) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const env = parsed as Record<string, unknown>
  const availability = env.availability
  if (availability !== "unavailable" && availability !== "partial" && availability !== "stale") return undefined
  const after = env.retry_after_s
  return {
    availability,
    ...(typeof env.reason === "string" ? { reason: env.reason } : {}),
    ...(typeof env.retryable === "boolean" ? { retryable: env.retryable } : {}),
    ...(typeof after === "number" && Number.isFinite(after) && after > 0 ? { retryAfterS: Math.ceil(after) } : {}),
    alternatives: strings(env.alternatives),
    ...(strings(env.warnings)[0] ? { warning: strings(env.warnings)[0]!.slice(0, MAX_WARNING_CHARS) } : {}),
  }
}

/** The tool's name as the server has it: `mcp__server__tool` → `tool`. */
const shortName = (name: string) => name.replace(/^mcp__.+?__/, "")

/**
 * What to do, as an order naming the call: seen 05/11 on gemini-3.1-flash-lite, "có thể thử lại"
 * got a repeat in 1 of 3 runs where a repeat would have worked. A model has no way to wait, so a
 * wait is said as a fact about the source, after the step it can take now.
 */
function nextStep(state: SourceState) {
  const alternatives = state.alternatives.join(", ")
  if (alternatives) {
    const later = state.retryable !== false && state.retryAfterS !== undefined ? ` This source can be retried after ${state.retryAfterS}s.` : ""
    return `Call ${alternatives} in the very next step.${later}`
  }
  if (state.retryable === false) return "Calling again will not help."
  if (state.retryAfterS !== undefined) return `This source can be retried after ${state.retryAfterS}s.`
  return "Repeat this exact call once in the next step before concluding the data is missing."
}

const ALTERNATIVES = /(?:Call (.+?) in the very next step|Gọi (.+?) ngay ở bước kế tiếp)/

/**
 * The tools a stored notice named. Read from the notice because it is always the first line:
 * the envelope below it is followed by the provenance line, so the text as a whole is not JSON.
 */
export function noticeAlternatives(text: string): string[] {
  const m = ALTERNATIVES.exec(text.split("\n", 1)[0]!)
  return (m?.[1] ?? m?.[2])?.split(", ") ?? []
}

/** The line put before the result, so it is read before the envelope. */
export function sourceNotice(toolName: string, state: SourceState): string {
  const detail = state.warning ? `: ${state.warning}` : ""
  if (state.availability === "partial") return `[Partial data]${detail || ": the result is incomplete"}. State this limit when using the figures.`
  if (state.availability === "stale") return `[Stale data]${detail || ": the result is not the latest"}. State the figures' date when using them.`
  const why = (state.reason && REASONS[state.reason]) ?? state.warning ?? "the source is temporarily unavailable"
  return `${SOURCE_FAILED_PREFIX} ${shortName(toolName)}: ${why}. ${nextStep(state)} If it is still missing, report what is missing; never fill in numbers yourself.`
}
