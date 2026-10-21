import type { Effort } from "../effort"
import type { DeskSize, Estimate } from "./types"

/** What the approval card shows before a run, and lets the user adjust. */
export interface DeskApprovalRequest {
  id: number
  playbook: string
  description: string
  phases: string[]
  /** One line about the arguments, e.g. "8 mã: FPT, MWG, … (+4)". */
  summary: string
  args: unknown
  /** Proposed size and effort; the user may change both. */
  size: DeskSize
  effort?: Effort
  /** Cost per size, so the card updates as the size changes. */
  estimates: Record<DeskSize, Estimate>
  warnRequests: number
  maxRequests?: number
  /** "Provider · model" desk agents will use. */
  model: string
  /** Why the card shows: the run was not opted into, or this playbook was never approved. */
  reason: "no-opt-in" | "first-time"
}

export interface DeskDecision {
  run: boolean
  size: DeskSize
  effort?: Effort
  /** "Chạy, không hỏi lại <playbook>". */
  remember: boolean
}

type Pending = { request: DeskApprovalRequest; resolve: (d: DeskDecision) => void; reject: (e: unknown) => void }

/** Queue of desk approval cards (one shows at a time); the TUI answers them. */
export class DeskApprovals {
  private queue: Pending[] = []
  private listeners = new Set<(head: DeskApprovalRequest | undefined) => void>()
  private next = 1

  ask(request: Omit<DeskApprovalRequest, "id">, signal?: AbortSignal): Promise<DeskDecision> {
    if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"))
    return new Promise<DeskDecision>((resolve, reject) => {
      const pending: Pending = { request: { ...request, id: this.next++ }, resolve, reject }
      this.queue.push(pending)
      signal?.addEventListener(
        "abort",
        () => {
          const at = this.queue.indexOf(pending)
          if (at < 0) return
          this.queue.splice(at, 1)
          reject(new DOMException("aborted", "AbortError"))
          this.emit()
        },
        { once: true },
      )
      this.emit()
    })
  }

  head(): DeskApprovalRequest | undefined {
    return this.queue[0]?.request
  }

  answer(decision: DeskDecision) {
    const pending = this.queue.shift()
    if (!pending) return
    pending.resolve(decision)
    this.emit()
  }

  onChange(listener: (head: DeskApprovalRequest | undefined) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    const head = this.head()
    for (const listener of this.listeners) listener(head)
  }
}
