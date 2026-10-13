/**
 * Questions from the model to the user (the `ask_user` tool), modelled on Claude Code's
 * AskUserQuestion, opencode's question tool and Codex's request_user_input: a few
 * multiple-choice questions, answered in a prompt that takes the input's place.
 *
 * Same shape as PermissionGate: one request shown at a time, aborting the turn cancels
 * what waits, and with no UI attached the model is told to ask in plain text instead.
 */

export interface AskOption {
  label: string
  description?: string
}

export interface AskQuestion {
  /** Short chip label (≤ 12 characters), e.g. "Khung thời gian". */
  header: string
  question: string
  options: AskOption[]
  multiSelect?: boolean
}

export interface AskRequest {
  id: number
  /** Tool call this belongs to, so the transcript can show "waiting for you". */
  callId?: string
  questions: AskQuestion[]
}

export type AskResult =
  | { answered: true; answers: Record<string, string> }
  | { answered: false; reason: "declined" | "cancelled" | "headless" }

interface Pending {
  request: AskRequest
  resolve: (r: AskResult) => void
  cleanup: () => void
}

export class AskBroker {
  private queue: Pending[] = []
  private listeners = new Set<(head: AskRequest | undefined) => void>()
  private nextId = 1
  /** Set by the TUI. Without it the model is told to ask in plain text. */
  interactive = false

  head(): AskRequest | undefined {
    return this.queue[0]?.request
  }

  onChange(listener: (head: AskRequest | undefined) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    const head = this.head()
    for (const listener of this.listeners) listener(head)
  }

  ask(questions: AskQuestion[], signal: AbortSignal, callId?: string): Promise<AskResult> {
    if (!this.interactive) return Promise.resolve({ answered: false, reason: "headless" })
    if (signal.aborted) return Promise.resolve({ answered: false, reason: "cancelled" })
    return new Promise<AskResult>((resolve) => {
      const request: AskRequest = { id: this.nextId++, callId, questions }
      const onAbort = () => {
        this.queue = this.queue.filter((p) => p.request.id !== request.id)
        resolve({ answered: false, reason: "cancelled" })
        this.emit()
      }
      signal.addEventListener("abort", onAbort, { once: true })
      this.queue.push({ request, resolve, cleanup: () => signal.removeEventListener("abort", onAbort) })
      if (this.queue.length === 1) this.emit()
    })
  }

  /** The user's answers (question text → answer), or undefined when they declined. */
  respond(id: number, answers: Record<string, string> | undefined) {
    const index = this.queue.findIndex((p) => p.request.id === id)
    if (index < 0) return
    const [pending] = this.queue.splice(index, 1)
    pending!.cleanup()
    pending!.resolve(answers ? { answered: true, answers } : { answered: false, reason: "declined" })
    this.emit()
  }

  cancelAll() {
    for (const p of this.queue) {
      p.cleanup()
      p.resolve({ answered: false, reason: "cancelled" })
    }
    this.queue = []
    this.emit()
  }
}

/** What the model reads back (Claude Code's wording, in Vietnamese). */
export function formatAskResult(result: AskResult) {
  if (result.answered) {
    // JSON strings, so a typed answer containing " cannot break the format.
    const pairs = Object.entries(result.answers).map(([q, a]) => `${JSON.stringify(q)}=${JSON.stringify(a)}`)
    return `Người dùng đã trả lời: ${pairs.join(", ")}. Tiếp tục dựa trên các câu trả lời này.`
  }
  if (result.reason === "headless") {
    return "Không có giao diện để hỏi người dùng bằng lựa chọn. Hãy hỏi bằng một câu hỏi ngắn trong câu trả lời rồi dừng lại."
  }
  if (result.reason === "cancelled") return "Lượt hỏi đã bị huỷ."
  return "Người dùng bỏ qua các câu hỏi. Tự chọn phương án hợp lý nhất, nêu giả định ở đầu câu trả lời rồi làm tiếp; nếu thật sự không làm tiếp được khi thiếu câu trả lời thì nói cần thông tin gì rồi dừng."
}
