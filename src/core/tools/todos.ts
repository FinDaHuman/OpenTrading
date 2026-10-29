import type { ModelMessage } from "ai"
import { z } from "zod"
import { compactCarry, isCompactMarker } from "../compact-marker"

export const TODO_WRITE = "todo_write"
/**
 * First words of every successful todo_write result; the TUI keys its one-line summary on it.
 * The result reads as an instruction, not as prose an answer could reuse: the old "Đã cập nhật
 * việc cần làm: 1/3 xong" was copied into answers, then became a whole answer (29/10).
 */
export const TODO_PREFIX = "[todo_write] Đã lưu"
/** The prefix before 29/10, still in saved sessions. */
export const LEGACY_TODO_PREFIX = "Đã cập nhật việc cần làm"
/**
 * Set on the turn's last assistant message when the model answered but left items of a list it
 * touched that turn open (retireLeftTodos). The harness retires the list — no longer recited
 * or pinned, so it cannot pull the next question back to old work (MyToDoList 31a) — but never
 * marks an item done for the model: the items are recorded as unconfirmed, as they were.
 * A provider ignores a namespace it does not own, so the model never sees it.
 */
export const HARNESS_OPTIONS = "opentrading"
export type HarnessMarks = { retiredTodos?: Todo[] }
export const MAX_TODOS = 20

export const TodoStatus = z.enum(["pending", "in_progress", "completed", "cancelled"])
export type TodoStatus = z.infer<typeof TodoStatus>

export const Todo = z.object({
  content: z.string().trim().min(1).max(200).describe("Việc cần làm, viết như một mệnh lệnh ngắn, ví dụ: Lấy BCTC 4 quý gần nhất của FPT"),
  status: TodoStatus.describe("pending: chưa làm · in_progress: đang làm (tối đa 1) · completed: đã xong · cancelled: bỏ"),
})
export type Todo = z.infer<typeof Todo>

export const TodoWriteInput = z.object({
  todos: z.array(Todo).max(MAX_TODOS).describe("Toàn bộ danh sách; danh sách mới thay hẳn danh sách cũ"),
})
export type TodoWriteInput = z.infer<typeof TodoWriteInput>

/** Rules the schema cannot express; each message tells the model how to fix the call. */
export function todoProblems(todos: readonly Todo[]): string[] {
  const problems: string[] = []
  const running = todos.filter((t) => t.status === "in_progress").length
  if (running > 1) problems.push(`Có ${running} việc in_progress; chỉ để một việc đang làm, các việc khác để pending.`)
  const seen = new Set<string>()
  for (const t of todos) {
    const key = t.content.trim().toLowerCase()
    if (seen.has(key)) problems.push(`Việc bị trùng: "${t.content}". Mỗi việc chỉ ghi một lần.`)
    seen.add(key)
  }
  return problems
}

const MARK: Record<TodoStatus, string> = { completed: "[x]", in_progress: "[>]", pending: "[ ]", cancelled: "[-]" }

export const todoMark = (status: TodoStatus) => MARK[status]

export const renderTodos = (todos: readonly Todo[]) => todos.map((t) => `${MARK[t.status]} ${t.content}`).join("\n")

/** Done out of the items still in scope (cancelled ones do not count). */
export function todoProgress(todos: readonly Todo[]) {
  const scope = todos.filter((t) => t.status !== "cancelled")
  return { done: scope.filter((t) => t.status === "completed").length, total: scope.length }
}

export const hasOpenTodos = (todos: readonly Todo[]) => todos.some((t) => t.status === "pending" || t.status === "in_progress")

type Part = { type: string; toolCallId?: string; toolName?: string; input?: unknown; output?: { type?: string } }

/**
 * A list the model has not touched for this many user turns belongs to an earlier question:
 * it is no longer recited or pinned, so it cannot pull a new question back to old work.
 */
export const TODO_STALE_TURNS = 2

/**
 * The todo list as of the last successful todo_write call in history, or [] once it is
 * stale. Derived from history alone (like loadedTools), so it survives --resume and empties
 * with /new.
 */
export function currentTodos(messages: readonly ModelMessage[]): Todo[] {
  const calls = new Map<string, unknown>()
  let current: Todo[] = []
  let userTurnsSince = 0
  for (const message of messages) {
    if (message.role === "user") userTurnsSince++
    if (message.role === "assistant" && harnessMarks(message).retiredTodos) current = []
    // The list in force when the history was compacted (its todo_write calls were summarized).
    if (isCompactMarker(message)) {
      const carried = z.array(Todo).safeParse(compactCarry(message).todos)
      if (carried.success) {
        current = carried.data
        userTurnsSince = 0
      }
    }
    if (typeof message.content === "string") continue
    for (const part of message.content as Part[]) {
      if (part.type === "tool-call" && part.toolName === TODO_WRITE && part.toolCallId) calls.set(part.toolCallId, part.input)
      if (part.type === "tool-result" && part.toolName === TODO_WRITE && part.toolCallId) {
        const failed = part.output?.type === "error-text" || part.output?.type === "error-json"
        const parsed = TodoWriteInput.safeParse(calls.get(part.toolCallId))
        if (!failed && parsed.success) {
          current = parsed.data.todos
          userTurnsSince = 0
        }
      }
    }
  }
  return userTurnsSince >= TODO_STALE_TURNS ? [] : current
}

/** The harness's own marks on a message (never sent to a provider's model). */
export function harnessMarks(message: ModelMessage): HarnessMarks {
  const marks = (message.providerOptions as Record<string, unknown> | undefined)?.[HARNESS_OPTIONS]
  return marks && typeof marks === "object" ? (marks as HarnessMarks) : {}
}

/** Whether this turn's messages hold a successful todo_write (the model touched its list). */
export function touchedTodos(messages: readonly ModelMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "tool" &&
      typeof m.content !== "string" &&
      (m.content as Part[]).some((p) => p.type === "tool-result" && p.toolName === TODO_WRITE && p.output?.type !== "error-text" && p.output?.type !== "error-json"),
  )
}

/**
 * The turn's messages with the list retired when the model answered but left items open in a
 * list it touched this turn; `left` is what it left (unconfirmed, not done). Untouched lists from
 * earlier turns are left alone (TODO_STALE_TURNS retires them).
 */
export function retireLeftTodos(history: readonly ModelMessage[], turn: ModelMessage[]): { messages: ModelMessage[]; left: Todo[] } {
  if (!touchedTodos(turn)) return { messages: turn, left: [] }
  const left = currentTodos([...history, ...turn]).filter((t) => t.status === "pending" || t.status === "in_progress")
  const index = turn.findLastIndex((m) => m.role === "assistant")
  if (left.length === 0 || index < 0) return { messages: turn, left: [] }
  const last = turn[index]!
  const marked = { ...last, providerOptions: { ...last.providerOptions, [HARNESS_OPTIONS]: { retiredTodos: left } } } as ModelMessage
  return { messages: [...turn.slice(0, index), marked, ...turn.slice(index + 1)], left }
}
