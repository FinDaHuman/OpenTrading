import type { ModelMessage } from "ai"
import { z } from "zod"

export const TODO_WRITE = "todo_write"
/** First line of every successful todo_write result; the TUI keys its one-line summary on it. */
export const TODO_PREFIX = "Đã cập nhật việc cần làm"
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
 * The todo list as of the last successful todo_write call in history. Derived from history
 * alone (like loadedTools), so it survives --resume and empties with /new.
 */
export function currentTodos(messages: readonly ModelMessage[]): Todo[] {
  const calls = new Map<string, unknown>()
  let current: Todo[] = []
  for (const message of messages) {
    if (typeof message.content === "string") continue
    for (const part of message.content as Part[]) {
      if (part.type === "tool-call" && part.toolName === TODO_WRITE && part.toolCallId) calls.set(part.toolCallId, part.input)
      if (part.type === "tool-result" && part.toolName === TODO_WRITE && part.toolCallId) {
        const failed = part.output?.type === "error-text" || part.output?.type === "error-json"
        const parsed = TodoWriteInput.safeParse(calls.get(part.toolCallId))
        if (!failed && parsed.success) current = parsed.data.todos
      }
    }
  }
  return current
}
