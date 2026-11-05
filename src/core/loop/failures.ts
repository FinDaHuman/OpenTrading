import type { ModelMessage } from "ai"
import { AUTO_BLOCK_PREFIX, RULE_DENY_PREFIX, USER_DENY_PREFIX } from "../permission/denial"
import { stableJson } from "../tools/loop-guard"
import { SOURCE_FAILED_PREFIX } from "../tools/outcome"
import { LOADED_PREFIX } from "../tools/search"

/**
 * What the failed calls of a turn add up to, read from the turn's messages: they are the same
 * in a running step, at the end of the turn, and in a saved session.
 *
 * Seeing a failure is not enough for a model to report it (Failure-Transparent Agents: false
 * success in about one answer in five, with the failure in context), so the turn keeps a list of
 * the data it did not get: the UI shows it whatever the model writes, and the model is reminded.
 * LoopGuard only sees the same call repeated; a run of failures also covers changing arguments
 * and alternating calls, and invalid calls that never reach a tool.
 */

export type ToolOutcome =
  | "ok"
  | "source-unavailable"
  | "deferred"
  | "invalid-call"
  | "denied"
  | "aborted"
  | "timeout"
  | "rate-limited"
  | "quota"
  | "transport"
  | "tool-error"

/** Steps in a row with nothing but failures before the model is told to change course. */
export const FAILURE_STREAK_NUDGE = 4
/** Then tools are switched off for a step, so the turn ends with an answer. */
export const FAILURE_STREAK_STOP = 8

/** Neither a success nor a failure of the call itself. */
const NEUTRAL = new Set<ToolOutcome>(["deferred", "denied", "aborted"])
/** The call could have brought data and did not. */
const DATA_LOST = new Set<ToolOutcome>(["source-unavailable", "timeout", "rate-limited", "quota", "transport"])

const DEFERRED = /chưa (được nạp|có trong bước)/
const DENIED = [AUTO_BLOCK_PREFIX, USER_DENY_PREFIX, RULE_DENY_PREFIX, "Người dùng dừng vòng lặp", "Lời gọi tool đã bị huỷ", "Không chạy được", "Lời gọi này cần người dùng xác nhận"]
const INVALID = /^(Tham số (không hợp lệ|của )|Không có tool|Model tried to call)/
const ABORTED = /^Đã huỷ|^Tool bị ngắt/
const QUOTA = /hết quota/
const RATE_LIMITED = /giới hạn tốc độ|Server yêu cầu chờ/
const TIMEOUT = /quá thời gian|timed out|Hết thời gian/i
const TRANSPORT = /lỗi tạm thời|đang lỗi kết nối|chưa kết nối|Connection closed|Streamable HTTP|fetch failed|ECONN/

/** The kind of a tool result, from what the harness wrote in it. */
export function classifyOutcome(ok: boolean, text: string): ToolOutcome {
  if (ok) return text.startsWith(SOURCE_FAILED_PREFIX) ? "source-unavailable" : "ok"
  if (text.startsWith(LOADED_PREFIX) || DEFERRED.test(text)) return "deferred"
  if (DENIED.some((prefix) => text.startsWith(prefix))) return "denied"
  if (INVALID.test(text)) return "invalid-call"
  if (ABORTED.test(text)) return "aborted"
  if (QUOTA.test(text)) return "quota"
  if (RATE_LIMITED.test(text)) return "rate-limited"
  if (TIMEOUT.test(text)) return "timeout"
  if (TRANSPORT.test(text)) return "transport"
  return "tool-error"
}

function resultText(output: { type?: string; value?: unknown } | undefined) {
  const value = output?.value
  if (typeof value === "string") return value
  if (Array.isArray(value)) return (value as { type?: string; text?: string }[]).find((p) => p?.type === "text")?.text ?? ""
  return ""
}

/** Data tools: an MCP tool, or a web read. A failed shell or file edit is not missing data. */
const bringsData = (name: string) => name.startsWith("mcp__") || name.startsWith("web_")

const shortName = (name: string) => name.replace(/^mcp__.+?__/, "")

export interface TurnFailures {
  /** Tools whose data the turn still lacks, by short name. */
  gaps: string[]
  /** Steps in a row, up to the last one, where every call failed. */
  streak: number
}

/** Over the last turn in `messages` (from its user message). */
export function turnFailures(messages: readonly ModelMessage[]): TurnFailures {
  const start = messages.findLastIndex((m) => m.role === "user")
  const inputs = new Map<string, unknown>()
  const missing = new Map<string, string>()
  let streak = 0
  for (const message of messages.slice(start + 1)) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === "tool-call") inputs.set(part.toolCallId, part.input)
    }
    if (message.role !== "tool") continue
    let failed = false
    let succeeded = false
    for (const part of message.content) {
      if (part.type !== "tool-result") continue
      const output = part.output as { type?: string; value?: unknown }
      const outcome = classifyOutcome(!String(output?.type ?? "").startsWith("error"), resultText(output))
      const key = `${part.toolName}\u0000${stableJson(inputs.get(part.toolCallId))}`
      if (outcome === "ok") {
        succeeded = true
        missing.delete(key)
      } else if (!NEUTRAL.has(outcome)) {
        failed = true
        if (DATA_LOST.has(outcome) && bringsData(part.toolName)) missing.set(key, shortName(part.toolName))
      }
    }
    if (succeeded) streak = 0
    else if (failed) streak++
  }
  return { gaps: [...new Set(missing.values())], streak }
}

const remind = (text: string) => `<nhac_nho>\n${text}\n</nhac_nho>`

/** Reminder for the next step, if the turn has one to give. */
export function failureNudge({ gaps, streak }: TurnFailures): string | undefined {
  const lines = [
    ...(gaps.length > 0 ? [`Lượt này chưa lấy được dữ liệu từ: ${gaps.join(", ")}. Khi trả lời, nêu rõ phần còn thiếu và không tự điền số cho phần đó.`] : []),
    ...(streak === FAILURE_STREAK_NUDGE ? [`${streak} bước liên tiếp chỉ toàn lỗi. Đổi cách khác, hoặc trả lời bằng dữ liệu đã có.`] : []),
  ]
  return lines.length > 0 ? remind(lines.join("\n")) : undefined
}

export const FAILURE_STREAK_FINAL = remind("Quá nhiều bước liên tiếp chỉ toàn lỗi nên tool đã tắt ở bước này. Trả lời bằng dữ liệu đã có, nêu rõ phần còn thiếu, không tự điền số.")

/** The line under the answer: from the harness, so it holds whatever the model wrote. */
export function gapsLine(gaps: readonly string[]) {
  return `! ${gaps.length} nguồn lỗi chưa khắc phục trong lượt này: ${gaps.join(", ")}`
}
