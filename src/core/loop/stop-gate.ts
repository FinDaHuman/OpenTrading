import type { StepResult, ToolSet } from "ai"
import { hasOpenTodos, TODO_PREFIX, TODO_WRITE, type Todo } from "../tools/todos"

/**
 * When a turn may end. Every harness read (Claude Code, Codex, opencode, Gemini CLI) ends a
 * turn when the model calls no tool; what differs is the gate at that point. This one is code
 * only — no model call judges the answer (quota) — and spends a request only on a final step
 * that is already broken, never on a valid answer.
 *
 * Seen 29/10 with gemini-3.1-flash-lite: a turn whose whole answer was
 * "*(Đã hoàn thành các việc cần làm)*" (the model echoing its own todo status) ended as done.
 */

/** Recovery requests a turn may spend at most: the gate never loops. */
export const MAX_RECOVERIES = 2

export type RecoveryKind = "malformed" | "length" | "empty"

/** What the last request's final step produced. */
export interface LastStep {
  /** Text of that step only (an earlier step's preamble is not an answer). */
  text: string
  /** Tools it called. */
  toolNames: string[]
  /** The SDK's unified finish reason (stop, length, content-filter…). */
  finish?: string
  /** The provider's own (Gemini: MALFORMED_FUNCTION_CALL, SAFETY…). */
  rawFinish?: string
  /** It streamed reasoning. */
  reasoned?: boolean
  /** The step came right after tool results. */
  afterTools?: boolean
}

export type Verdict =
  | { action: "accept" }
  | { action: "continue"; kind: RecoveryKind; nudge: string; toolChoice: "auto" | "none" }
  /** Broken and no recovery left (or none would help): end the turn and say so. */
  | { action: "give-up"; kind: RecoveryKind | "blocked" }

/** A call the model meant but sent malformed, or a call where none was allowed. */
const MALFORMED = /^(MALFORMED_FUNCTION_CALL|UNEXPECTED_TOOL_CALL)$/i
/** Stopped by the provider's filters: asking again gets the same answer. */
const BLOCKED = /^(SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII|IMAGE_SAFETY|LANGUAGE)$/i

export const RESCUE_MALFORMED =
  "<nhac_nho>\nLời gọi tool vừa rồi sai định dạng nên không chạy. Gọi lại tool đúng tham số, hoặc trả lời người dùng nếu đã đủ dữ liệu.\n</nhac_nho>"
export const RESCUE_LENGTH =
  "<nhac_nho>\nCâu trả lời bị cắt vì chạm giới hạn độ dài output. Viết tiếp ngay từ chỗ dừng: không xin lỗi, không tóm tắt lại phần đã viết.\n</nhac_nho>"
/** Gemini CLI's nudge after an empty answer: the answer, or a tool when data is missing. */
export const RESCUE_EMPTY =
  "<nhac_nho>\nBạn chưa viết câu trả lời nào cho người dùng. Trả lời ngay dựa trên dữ liệu đã có, hoặc gọi tool nếu còn thiếu dữ liệu. Không viết dòng trạng thái việc cần làm.\n</nhac_nho>"
/** Tools off (it brought 2.5-flash-lite's empty answers back). */
export const RESCUE_EMPTY_FINAL = "Hãy trả lời câu hỏi của người dùng dựa trên kết quả tool ở trên. Không gọi thêm tool."

export function judgeStop(last: LastStep, done: readonly RecoveryKind[]): Verdict {
  // Still calling tools: the step cap ended the run, and its summary step has its own rules.
  if (last.toolNames.some((name) => name !== TODO_WRITE)) return { action: "accept" }
  const raw = last.rawFinish ?? ""
  const empty = isEmptyAnswer(last.text)
  const left = MAX_RECOVERIES - done.length
  const used = (kind: RecoveryKind) => done.filter((k) => k === kind).length

  if (empty && (BLOCKED.test(raw) || last.finish === "content-filter")) return { action: "give-up", kind: "blocked" }
  if (MALFORMED.test(raw) && empty) {
    if (left > 0 && used("malformed") === 0) return { action: "continue", kind: "malformed", nudge: RESCUE_MALFORMED, toolChoice: "auto" }
    return { action: "give-up", kind: "malformed" }
  }
  if (!empty && last.finish === "length") {
    // A cut answer is still an answer: out of budget, keep it as it is.
    if (left > 0) return { action: "continue", kind: "length", nudge: RESCUE_LENGTH, toolChoice: "auto" }
    return { action: "accept" }
  }
  if (empty) {
    if (left <= 0) return { action: "give-up", kind: "empty" }
    // Right after tool results the data is there: tools off first, the fix that brought
    // 2.5-flash-lite's empty answers back. Otherwise the model may still lack data, so it may
    // call a tool first (Gemini CLI). The second try is the other one.
    const off = !!last.afterTools !== (used("empty") > 0)
    return off
      ? { action: "continue", kind: "empty", nudge: RESCUE_EMPTY_FINAL, toolChoice: "none" }
      : { action: "continue", kind: "empty", nudge: RESCUE_EMPTY, toolChoice: "auto" }
  }
  return { action: "accept" }
}

/**
 * Lines a model writes when it echoes the todo tool instead of answering: the tool's result
 * prefix, the TUI's one-line label, "(Đã hoàn thành các việc cần làm)".
 */
const ECHO_LINE = new RegExp(
  `^(${escape(TODO_PREFIX)}|Cập nhật việc cần làm|Đã hoàn thành (hết |tất cả |toàn bộ )?(các )?việc cần làm|Đã đóng (danh sách )?việc cần làm)`,
  "i",
)
/** A rendered todo item (renderTodos): only dropped next to an echoed status line. */
const TODO_ITEM = /^\[[x> -]\] /

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Zero-width characters and HTML comments carry no answer (Gemini CLI strips them too). */
function invisible(text: string) {
  return text.replace(/[​-‍﻿‎‏]/g, "").replace(/<!--[\s\S]*?-->/g, "")
}

/** A line stripped of markdown emphasis and wrapping parentheses. */
const bare = (line: string) => line.normalize("NFC").trim().replace(/^[\s*_()]+|[\s*_()]+$/g, "")

/** The text without echoed todo status lines (and the item list printed under one). */
export function stripEchoes(text: string): string {
  const lines = text.split("\n")
  if (!lines.some((line) => ECHO_LINE.test(bare(line)))) return text
  const kept = lines.filter((line) => {
    const b = bare(line)
    return !ECHO_LINE.test(b) && !TODO_ITEM.test(line.trim())
  })
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/** No answer in it: nothing visible once echoed todo lines are gone. */
export function isEmptyAnswer(text: string): boolean {
  return stripEchoes(invisible(text)).trim() === ""
}

function resultText(output: unknown): string {
  if (typeof output === "string") return output
  const text = output && typeof output === "object" && "output" in output ? (output as { output: unknown }).output : undefined
  return typeof text === "string" ? text : ""
}

/**
 * Stop condition: the step wrote the answer and closed the todo list in the same step. Without
 * it the SDK runs one more request after todo_write, which comes back empty (29/10). A step
 * that opens a list ("Để mình lấy dữ liệu…" + todo_write with pending items) goes on.
 */
export function answeredAndClosedTodos({ steps }: { steps: StepResult<ToolSet>[] }): boolean {
  const step = steps.at(-1)
  // An echoed status line is no answer: the SDK runs the next step as it would anyway.
  if (!step || isEmptyAnswer(step.text) || step.toolCalls.length === 0) return false
  return step.toolCalls.every((call) => {
    if (call.toolName !== TODO_WRITE) return false
    // The registry wraps a tool's text as { output } (ToolResult).
    const ok = step.toolResults.some((r) => r.toolCallId === call.toolCallId && resultText(r.output).startsWith(TODO_PREFIX))
    const todos = (call.input as { todos?: Todo[] } | undefined)?.todos
    return ok && Array.isArray(todos) && !hasOpenTodos(todos)
  })
}
