import { guardModelRequests, onModelRequest } from "./requests"

/**
 * A caller's cap on the model requests of one turn (`ot -p --max-requests N`, an eval's
 * `--turn-requests N`, a benchmark runner's `maxRequests`). Issue #278 R3: a benchmark cut the run
 * at its 25th request, so the summary step that the step cap forces never ran.
 *
 * Every request the process sends while the turn runs counts: retries, stop-gate recoveries,
 * subagents, side calls (compaction, the web side model). The cap is never passed: past it a
 * request is refused before it is sent (requests.ts guard). When what is left covers only the
 * answer and one retry, the loop forces the summary step (tools off, SUMMARY_PROMPT).
 *
 * The cap is per turn: a caller running several turns (a benchmark trial with memory turns) passes
 * each turn what is left of its own cap.
 *
 * What is not promised: if a retry spends that reserve, the summary itself may be refused and the
 * turn ends with an error instead of an answer. One budget per process at a time: two turns
 * running together (a TUI with background work) would count each other's requests.
 */
export class RequestBudget {
  used = 0
  private readonly stopGuard: () => void
  private readonly stopCount: () => void

  constructor(readonly max: number) {
    this.stopGuard = guardModelRequests(() => (this.used >= this.max ? `Đã dùng hết ${this.max} request được phép cho lượt này; không gửi thêm.` : undefined))
    this.stopCount = onModelRequest(() => {
      this.used++
    })
  }

  remaining() {
    return this.max - this.used
  }

  /** The next step must be the answer: what is left covers it and one retry. */
  get closing() {
    return this.remaining() <= BUDGET_RESERVE
  }

  dispose() {
    this.stopGuard()
    this.stopCount()
  }
}

/** Requests kept back for the answer step and one retry of it. */
export const BUDGET_RESERVE = 2

/** The smallest budget a caller may set. Below BUDGET_RESERVE + 1 the first step is already the answer, tools off. */
export const MIN_REQUEST_BUDGET = 1
