import { isChildConversation } from "./conversation"
import { guardModelRequests, onModelRequest } from "./requests"

/**
 * A caller's cap on the model requests of one turn (`ot -p --turn-requests N`, an eval's
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
 * Subagents spend the turn's budget (#328) but never its reserve: a child's request is refused once
 * only the reserve is left (the child's conversation is on the request, requests.ts), a child sees
 * its own view (`forChild`) that closes one request earlier, so it ends on its summary, and
 * spawn_subagent refuses a child when the room left is under SUBAGENT_MIN_REQUESTS.
 *
 * What is not promised: if a retry spends that reserve, the summary itself may be refused and the
 * turn ends with an error instead of an answer. One budget per process at a time: a budget exists
 * only for a caller that set a cap (`ot -p --turn-requests`, an eval, a benchmark), one turn per
 * process; the TUI never makes one. Two turns running together under budgets would count each
 * other's requests, so `activeBudget()` is the latest one made.
 */
export class RequestBudget implements TurnBudget {
  used = 0
  private readonly stopGuard: () => void
  private readonly stopCount: () => void

  constructor(readonly max: number) {
    this.stopGuard = guardModelRequests((request) => {
      if (this.used >= this.max) return `Đã dùng hết ${this.max} request được phép cho lượt này; không gửi thêm.`
      if (isChildConversation(request.conversation) && this.remaining() <= BUDGET_RESERVE)
        return `Subagent request refused: the last ${BUDGET_RESERVE} requests of this turn's budget (${this.max}) are kept for the main agent's answer.`
      return undefined
    })
    this.stopCount = onModelRequest(() => {
      this.used++
    })
    active = this
  }

  remaining() {
    return this.max - this.used
  }

  /** The next step must be the answer: what is left covers it and one retry. */
  get closing() {
    return this.remaining() <= BUDGET_RESERVE
  }

  /** What a subagent may still spend: the budget left, less the parent's reserve. */
  childRoom() {
    return this.remaining() - BUDGET_RESERVE
  }

  /**
   * A subagent's view: its room is the parent's, less the reserve, and it closes when one request
   * is left there, so its summary goes out before the guard refuses it.
   */
  forChild(): TurnBudget {
    const parent = this
    return {
      max: this.max,
      remaining: () => parent.childRoom(),
      get closing() {
        return parent.childRoom() <= 1
      },
    }
  }

  dispose() {
    this.stopGuard()
    this.stopCount()
    if (active === this) active = undefined
  }
}

/** What the loop reads of a budget: a turn's own (RequestBudget) or a subagent's view of its parent's. */
export interface TurnBudget {
  readonly max: number
  remaining(): number
  /** The next step must be the answer. */
  readonly closing: boolean
}

let active: RequestBudget | undefined

/** The budget of the turn now running, if its caller set one (agent.ts); subagents read it. */
export const activeBudget = () => active

/** Fewer requests left for a subagent than this: spawn_subagent refuses it (the child would end before doing anything). */
export const SUBAGENT_MIN_REQUESTS = 3

/** Requests kept back for the answer step and one retry of it. */
export const BUDGET_RESERVE = 2

/** The smallest budget a caller may set. Below BUDGET_RESERVE + 1 the first step is already the answer, tools off. */
export const MIN_REQUEST_BUDGET = 1
