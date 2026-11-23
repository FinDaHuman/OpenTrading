import type { ModelMessage } from "ai"
import { AUTO_BLOCK_PREFIXES, RULE_DENY_PREFIXES, USER_DENY_PREFIXES } from "../permission/denial"
import { stableJson } from "../tools/loop-guard"
import { noticeAlternatives, SOURCE_FAILED_PREFIX } from "../tools/outcome"
import { loadedPrefixOf } from "../tools/search"

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
export interface FailureThresholds { nudge: number; stop: number }

/** Neither a success nor a failure of the call itself. */
const NEUTRAL = new Set<ToolOutcome>(["deferred", "denied", "aborted"])
/** The call could have brought data and did not. */
const DATA_LOST = new Set<ToolOutcome>(["source-unavailable", "timeout", "rate-limited", "quota", "transport"])

const DEFERRED = /chưa (được nạp|có trong bước)|was not in this step|could not be sent with this step/
// English first, then the Vietnamese texts of sessions saved before 20/11/2026.
const DENIED = [
  ...AUTO_BLOCK_PREFIXES,
  ...USER_DENY_PREFIXES,
  ...RULE_DENY_PREFIXES,
  "The user stopped a loop",
  "The tool call was cancelled",
  "Could not run",
  "This call needs the user's confirmation",
  "Người dùng dừng vòng lặp",
  "Lời gọi tool đã bị huỷ",
  "Không chạy được",
  "Lời gọi này cần người dùng xác nhận",
]
const INVALID = /^(Tham số (không hợp lệ|của )|Invalid arguments|The arguments of|Không có tool|No tool "|Model tried to call)/
const ABORTED = /^Đã huỷ|^Cancelled\.|^Stopped\.|^Tool bị ngắt|^Tool interrupted/
const QUOTA = /hết quota|quota is exhausted/
const RATE_LIMITED = /giới hạn tốc độ|rate-limit|Server yêu cầu chờ|asks to wait/i
const TIMEOUT = /quá thời gian|timed out|stopped after \d+s|Hết thời gian/i
// `did not reconnect` and `[HTTP 5xx` are the MCP client's own lines for a server still down
// after the wait for a reconnect, and for a 5xx it does not retry (mcp/errors.ts, #325).
const TRANSPORT = /lỗi tạm thời|đang lỗi kết nối|chưa kết nối|temporary error|failing to connect|is not connected|did not reconnect|\[HTTP 5\d\d[,\]]|Connection closed|Streamable HTTP|fetch failed|ECONN/

/** The kind of a tool result, from what the harness wrote in it. */
export function classifyOutcome(ok: boolean, text: string): ToolOutcome {
  if (ok) return text.startsWith(SOURCE_FAILED_PREFIX) ? "source-unavailable" : "ok"
  if (loadedPrefixOf(text) || DEFERRED.test(text)) return "deferred"
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
  /** A tool other than the harness's own (todo list, tool search, skills) returned something to answer from. */
  usable: boolean
  /** A data tool (MCP, web) returned data: with gaps and none of this, every source failed. */
  fetched: boolean
  /**
   * Data tools that returned an error of their own (an MCP isError, an eval replay miss), by short
   * name. Not gaps: the call may have been the model's mistake, so the UI line and the subagent's
   * dataGaps leave them out, but a turn where these are all it got has nothing to answer from (#414).
   */
  errored: string[]
}

/** Tools that run the harness, not fetch data: their success is nothing to answer from. */
const HARNESS_TOOLS = new Set(["todo_write", "tool_search", "load_skill"])

/** Over the last turn in `messages` (from its user message). */
export function turnFailures(messages: readonly ModelMessage[]): TurnFailures {
  const start = messages.findLastIndex((m) => m.role === "user")
  const inputs = new Map<string, unknown>()
  const missing = new Map<string, { name: string; alternatives: string[] }>()
  const worked = new Set<string>()
  const errored = new Set<string>()
  let streak = 0
  let usable = false
  let fetched = false
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
        if (!HARNESS_TOOLS.has(part.toolName)) usable = true
        if (bringsData(part.toolName)) fetched = true
        missing.delete(key)
        worked.add(shortName(part.toolName))
      } else if (!NEUTRAL.has(outcome)) {
        failed = true
        if (outcome === "tool-error" && bringsData(part.toolName)) errored.add(shortName(part.toolName))
        if (DATA_LOST.has(outcome) && bringsData(part.toolName)) {
          missing.set(key, { name: shortName(part.toolName), alternatives: outcome === "source-unavailable" ? noticeAlternatives(resultText(output)) : [] })
        }
      }
    }
    if (succeeded) streak = 0
    else if (failed) streak++
  }
  const gaps = [...missing.values()].filter((gap) => !gap.alternatives.some((name) => worked.has(name))).map((gap) => gap.name)
  return { gaps: [...new Set(gaps)], streak, usable, fetched, errored: [...errored] }
}

/**
 * The answer the harness writes when the model gave none after every recovery and sources
 * failed: it names what is missing and states no figure. Seen 13/11 (eval m6): both price
 * sources down, the model answered empty three times. Tools that returned errors of their own
 * (#414) are named too, without calling them an outage.
 */
export function gapsAnswer(gaps: readonly string[], errored: readonly string[] = []): string {
  const names = [...new Set([...gaps, ...errored])]
  // An error of the tool's own may come from the question (a wrong ticker or period): no outage, no wait.
  const why = gaps.length === 0
    ? "tool báo lỗi"
    : errored.length > 0
      ? "tool báo lỗi, nguồn lỗi hoặc quá thời gian"
      : "nguồn lỗi hoặc quá thời gian"
  const next = gaps.length === 0
    ? "Bạn kiểm tra lại mã hoặc kỳ trong câu hỏi rồi hỏi lại, hoặc hỏi phần dữ liệu khác."
    : "Bạn thử hỏi lại sau ít phút, hoặc hỏi phần dữ liệu khác."
  return [
    `Mình chưa trả lời được câu này vì chưa lấy được dữ liệu cần thiết: ${names.join(", ")} (${why} trong lượt này).`,
    `Mình không đưa ra con số nào cho phần thiếu để tránh sai. ${next}`,
  ].join("\n\n")
}

const remind = (text: string) => `<nhac_nho>\n${text}\n</nhac_nho>`

/** Reminder for the next step, if the turn has one to give. */
export function failureNudge({ gaps, streak }: Pick<TurnFailures, "gaps" | "streak">, threshold = FAILURE_STREAK_NUDGE): string | undefined {
  const lines = [
    ...(gaps.length > 0 ? [`This turn has not got data from: ${gaps.join(", ")}. When you answer, say plainly what is missing and do not fill in figures for it.`] : []),
    ...(streak === threshold ? [`${streak} steps in a row returned nothing but errors. Try another way, or answer with the data you have.`] : []),
  ]
  return lines.length > 0 ? remind(lines.join("\n")) : undefined
}

export const FAILURE_STREAK_FINAL = remind("Too many steps in a row returned nothing but errors, so tools are off for this step. Answer with the data you have, say plainly what is missing, and do not fill in figures.")

/** The line under the answer: from the harness, so it holds whatever the model wrote. */
export function gapsLine(gaps: readonly string[]) {
  return `! ${gaps.length} nguồn lỗi chưa khắc phục trong lượt này: ${gaps.join(", ")}`
}

/** The same line under a subagent's result, which the main agent reads. */
export function gapsNote(gaps: readonly string[]) {
  return `! ${gaps.length} failed sources not recovered in this run: ${gaps.join(", ")}`
}
