import type { Target } from "../../chat"
import type { AgentOrigin, ToolDef } from "../../tools/types"
import { classify, type ClassifierDeps, type Verdict } from "./classifier"
import { labelVi, type AutoModeConfig } from "./rules"
import { ActionLog, compactInput } from "./transcript"

export { ActionLog } from "./transcript"

/**
 * ▸▸ auto mode's reviewer: for each action that would otherwise ask, the classifier decides.
 * Rules from Claude Code's auto mode:
 * - a block is a tool error the model reads and works around ("deny and continue");
 * - 3 blocks in a row, or 20 in the session, stop deciding: the user is asked (that action
 *   and the next ones) until they answer one prompt;
 * - no verdict (error, timeout, unreadable) → ask the user; a quota error (429) also pauses
 *   the classifier for 10 minutes so the user's quota is not spent on every call
 *   (web side-model.ts guardedNative).
 */

export const MAX_CONSECUTIVE = 3
export const MAX_TOTAL = 20
export const QUOTA_PAUSE_MS = 10 * 60_000

export type Review =
  | { decision: "allow" }
  | { decision: "block"; label?: string; reason: string }
  /** Ask the user instead, and say why (shown in the prompt). */
  | { decision: "ask"; why: string }

export interface Denial {
  at: number
  tool: string
  /** Short form of the call, for /permissions. */
  summary: string
  label?: string
  reason: string
  /** Key of a one-time retry the user may grant. */
  key: string
}

export interface ReviewerDeps {
  /** The classifier's model: config autoMode.model, else the session's; undefined = none set up. */
  target: () => Promise<Target | undefined>
  config: () => Promise<AutoModeConfig | undefined>
  /** Workspace folders, OS and shell, trusted MCP servers. */
  environment: () => string[]
  classifier?: ClassifierDeps
  now?: () => number
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })

export class AutoReviewer {
  readonly log = new ActionLog()
  consecutive = 0
  total = 0
  pausedUntil?: number
  readonly recent: Denial[] = []
  /** Classifier requests spent this session (shown in /permissions). */
  requests = 0
  private retries = new Set<string>()
  private listeners = new Set<() => void>()

  constructor(private deps: ReviewerDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now()
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const l of this.listeners) l()
  }

  private resume?: ReturnType<typeof setTimeout>

  /** The classifier is paused (quota): until when. */
  paused(): number | undefined {
    return this.pausedUntil !== undefined && this.pausedUntil > this.now() ? this.pausedUntil : undefined
  }

  /** A new conversation (/new, /clear, resume): an empty log and fresh counters. */
  reset(history: Parameters<ActionLog["rebuild"]>[0] = [], defOf: Parameters<ActionLog["rebuild"]>[1] = () => undefined, visible: Parameters<ActionLog["rebuild"]>[2] = () => "") {
    this.log.rebuild(history, defOf, visible)
    this.consecutive = 0
    this.total = 0
    this.recent.length = 0
    this.retries.clear()
    this.emit()
  }

  /** The user answered a prompt: auto mode decides again. */
  userAnswered() {
    this.consecutive = 0
    if (this.total >= MAX_TOTAL) this.total = 0
    this.emit()
  }

  /** The user lets one blocked call through (/permissions → r): its next identical call runs. */
  grantRetry(denial: Denial) {
    this.retries.add(denial.key)
  }

  async review(def: ToolDef, input: unknown, agent: AgentOrigin | undefined, signal: AbortSignal): Promise<Review> {
    const compact = compactInput(def, input)
    const key = `${def.name}|${compact}`
    if (this.retries.delete(key)) return { decision: "allow" }
    if (this.consecutive >= MAX_CONSECUTIVE || this.total >= MAX_TOTAL) {
      return { decision: "ask", why: `auto mode đã chặn ${this.consecutive >= MAX_CONSECUTIVE ? `${this.consecutive} lần liên tiếp` : `${this.total} lần trong phiên`}; bạn duyệt lần này` }
    }
    const paused = this.paused()
    if (paused) return { decision: "ask", why: `model duyệt hết quota, tạm hỏi bạn tới ${hhmm(paused)}` }
    const target = await this.deps.target().catch(() => undefined)
    if (!target) return { decision: "ask", why: "chưa có model để duyệt (gõ /model)" }
    let verdict: Verdict
    try {
      verdict = await classify(
        { transcript: this.log.render(), action: { tool: def.name, input: compact, ...(agent ? { agent: `${agent.type}#${agent.id}` } : {}) }, environment: this.deps.environment(), config: await this.deps.config() },
        target,
        signal,
        this.deps.classifier,
      )
    } catch (error) {
      if (signal.aborted) throw error
      return { decision: "ask", why: `model duyệt lỗi: ${error instanceof Error ? error.message : String(error)}` }
    }
    this.requests += verdict.requests
    if (verdict.kind === "allow") {
      this.consecutive = 0
      this.emit()
      return { decision: "allow" }
    }
    if (verdict.kind === "unavailable") {
      if (verdict.quota) {
        this.pausedUntil = this.now() + QUOTA_PAUSE_MS
        // Tell the status bar when the pause is over.
        clearTimeout(this.resume)
        this.resume = setTimeout(() => this.emit(), QUOTA_PAUSE_MS + 50)
        this.resume.unref?.()
      }
      this.emit()
      return { decision: "ask", why: verdict.quota ? `model duyệt hết quota (${verdict.why}); tạm hỏi bạn 10 phút` : `model duyệt không trả lời được: ${verdict.why}` }
    }
    this.consecutive++
    this.total++
    const label = verdict.rule ? labelVi(verdict.rule) : undefined
    this.recent.unshift({ at: this.now(), tool: def.name, summary: compact.slice(0, 200), label, reason: verdict.reason, key })
    this.recent.splice(20)
    this.emit()
    // At the limit this block is not final: the user decides, so a run of false blocks ends here.
    if (this.consecutive >= MAX_CONSECUTIVE || this.total >= MAX_TOTAL) {
      return { decision: "ask", why: `auto mode chặn ${label ? `[${label}] ` : ""}${verdict.reason} — đã chặn ${this.consecutive >= MAX_CONSECUTIVE ? `${this.consecutive} lần liên tiếp` : `${this.total} lần`}, bạn quyết định` }
    }
    return { decision: "block", label, reason: verdict.reason }
  }
}

/** What the model reads when the classifier blocks. */
export function blockedMessage(label: string | undefined, reason: string) {
  return (
    `Auto mode chặn lời gọi này${label ? ` [${label}]` : ""}: ${reason}. ` +
    "Nếu còn việc khác không phụ thuộc vào nó thì làm tiếp. Được làm cách khác an toàn hơn, nhưng không tìm cách lách. " +
    "Nếu bắt buộc phải làm, dừng lại và giải thích cho người dùng: người dùng có thể nói rõ cho phép đúng hành động này (và đối tượng của nó), hoặc chuyển sang ▸ sửa có hỏi để tự duyệt."
  )
}
