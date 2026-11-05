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
export const SOURCE_FAILED_PREFIX = "[Nguồn lỗi]"

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
  upstream_timeout: "nguồn quá thời gian",
  upstream_down: "nguồn đang lỗi",
  upstream_rate_limited: "nguồn đang giới hạn tốc độ",
  not_configured: "nguồn chưa được cấu hình",
  auth_missing: "nguồn cần đăng nhập",
  recent_failure: "nguồn vừa lỗi",
  busy: "server đang quá tải",
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
    const later = state.retryable !== false && state.retryAfterS !== undefined ? ` Nguồn này thử lại được sau ${state.retryAfterS}s.` : ""
    return `Gọi ${alternatives} ngay ở bước kế tiếp.${later}`
  }
  if (state.retryable === false) return "Gọi lại không giúp được."
  if (state.retryAfterS !== undefined) return `Nguồn này thử lại được sau ${state.retryAfterS}s.`
  return "Gọi lại đúng lời gọi này một lần ở bước kế tiếp trước khi kết luận thiếu dữ liệu."
}

const ALTERNATIVES = /Gọi (.+?) ngay ở bước kế tiếp/

/**
 * The tools a stored notice named. Read from the notice because it is always the first line:
 * the envelope below it is followed by the provenance line, so the text as a whole is not JSON.
 */
export function noticeAlternatives(text: string): string[] {
  return ALTERNATIVES.exec(text.split("\n", 1)[0]!)?.[1]?.split(", ") ?? []
}

/** The line put before the result, so it is read before the envelope. */
export function sourceNotice(toolName: string, state: SourceState): string {
  const detail = state.warning ? `: ${state.warning}` : ""
  if (state.availability === "partial") return `[Dữ liệu một phần]${detail || ": kết quả chưa đầy đủ"}. Nêu rõ giới hạn này khi dùng số liệu.`
  if (state.availability === "stale") return `[Dữ liệu cũ]${detail || ": kết quả không phải mới nhất"}. Nêu rõ thời điểm của số liệu khi dùng.`
  const why = (state.reason && REASONS[state.reason]) ?? state.warning ?? "nguồn tạm không khả dụng"
  return `${SOURCE_FAILED_PREFIX} ${shortName(toolName)}: ${why}. ${nextStep(state)} Nếu vẫn không có, báo phần còn thiếu, không tự điền số.`
}
