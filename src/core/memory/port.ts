import type { AmbiguousReason, RejectReason } from "./content"
import type { EntityState } from "./entities"
import type { MemoryItem, SourceEvent, Status, Visibility } from "./schema"

export type { EntityState } from "./entities"

/** What the core knows about this turn. Everything but the text is optional. */
export interface TurnContext {
  userText: string
  sessionId?: string
  /** Explicit @-mentions from the UI (codes); @CODE written in the text is detected anyway. */
  mentions?: string[]
  /**
   * Restricted memories the user switched on for this turn only, by id. Restricted items never enter the stable
   * block, search or compaction; they appear in the per-turn block of this turn and nowhere else.
   */
  allowedRestrictedIds?: string[]
}
/** @deprecated V0 name; kept so early callers keep compiling. */
export type TurnContextV0 = TurnContext

export interface ContextBudget {
  /** Bytes of the final rendered memory text. Effective cap is min(config caps, maxBytes). */
  maxBytes?: number
}

export type MemoryWarningCode =
  | "db_unavailable"
  | "selection_failed"
  | "invalid_record"
  | "t1_overflow"
  | "projection_overflow"
  | "entity_limit"
  | "rule_error"
  | "t3_timeout"
  | "t3_failed"
  | "auto_disabled"
export interface MemoryWarning {
  code: MemoryWarningCode
  message: string
}

/**
 * Audit reference to what a turn used: ids and versions, never content. Memory is rebuilt from the store on every
 * request (current projection), so deleting a memory takes effect everywhere and history holds no memory text.
 */
export type InjectionRef =
  | { type: "memory"; id: string; version: number; ageDays: number; restricted: boolean }
  | { type: "rule"; name: string; hash: string }

export interface ContextContribution {
  /** Stable block: always-on rules, global profiles and lessons. Same bytes across turns unless data changes. */
  stableBlocks: string[]
  /** Per-turn block for the instruments being discussed (notes, scoped lessons and rules), or null. */
  projection: string | null
  /** Refs of everything in `projection`, for audit and the "used" line. */
  injection: { refs: InjectionRef[] } | null
  /** Session entities after this turn, when they changed. */
  entities: EntityState | null
  used: { memories: string[]; rules: string[] }
  warnings: MemoryWarning[]
}

export interface MemoryHit {
  id: string
  kind: MemoryItem["kind"]
  scope: string
  title: string | null
  snippet: string
}

/** Read side. This is the only memory object model-facing code may hold. */
export interface MemoryPort {
  /** Build memory for one real turn: advances the session's turn counter and entities. */
  beforeTurn(ctx: TurnContext, budget?: ContextBudget): Promise<ContextContribution>
  /** Same output without side effects (for previews such as /context). */
  peek(ctx: { sessionId?: string; userText?: string }, budget?: ContextBudget): Promise<ContextContribution>
  /** After the answer: record which memories were applied in that turn. */
  afterTurn(turn: { sessionId?: string }): Promise<void>
  /** Verbatim lookup for the model's search_memory tool: active, valid, model-visible items only by default. */
  search(
    query: string,
    opts?: { scope?: string; limit?: number; allowedRestrictedIds?: string[] },
  ): Promise<MemoryHit[]>
  /** Body of an agent-mode or any other rule by name, for load_rule. */
  loadRule(name: string): string | null
  endSession(sessionId: string): void
}

export type WriteFailureCode =
  | "needs_confirmation"
  | "content_rejected"
  | "invalid_input"
  | "too_large"
  | "t1_unfit"
  | "unknown_instrument"
  | "invalid_date"
  | "not_found"
  | "invalid_state"
  | "storage_busy"
  | "storage_failed"
/** @deprecated V0 name. */
export type RememberFailureCode = WriteFailureCode

export type RememberResult =
  | { ok: true; item: MemoryItem }
  /** Ambiguous content; nothing was written. Only the TUI may retry with confirmAmbiguous after the user agrees. */
  | { ok: false; code: "needs_confirmation"; reasons: AmbiguousReason[] }
  /** Never stored; confirmAmbiguous has no effect. */
  | { ok: false; code: "content_rejected"; reasons: RejectReason[] }
  | { ok: false; code: Exclude<WriteFailureCode, "needs_confirmation" | "content_rejected">; reasons: string[] }

export type TransitionResult =
  { ok: true } | { ok: false; code: "not_found" | "invalid_state" | "storage_busy" | "storage_failed" }
export type PurgeResult = TransitionResult

export interface WriteOptions {
  confirmAmbiguous?: boolean
}

export interface FeedbackResult {
  /** Memories the rating was recorded against (those used in the session's last turn). */
  rated: string[]
  /** A lesson proposal created from the correction, waiting for review. */
  proposal: MemoryItem | null
  /** Why no proposal was made from the correction, if one was given. */
  proposalSkipped?: string
  /** Lessons switched off by the auto-disable rule. */
  disabled: string[]
}

/**
 * Write side as an object capability: holding this object is the permission. Methods take no actor or token.
 * Production code hands it only to the TUI adapter.
 */
export interface UserMemoryCommands {
  /** A profile fact or preference the user states about themselves: active at once. */
  remember(
    input: { body: string; title?: string; visibility?: Visibility },
    opts?: WriteOptions,
  ): Promise<RememberResult>
  /** A dated note tied to one instrument: active until expiresAt (inclusive, Vietnam date). */
  note(
    input: { code: string; body: string; expiresAt?: string; visibility?: Visibility },
    opts?: WriteOptions,
  ): Promise<RememberResult>
  /** Edit the content: adds a new version, never overwrites. */
  edit(id: string, input: { body: string; title?: string }, opts?: WriteOptions): Promise<RememberResult>
  list(filter?: { status?: Status | Status[]; kind?: MemoryItem["kind"] }): Promise<MemoryItem[]>
  approve(id: string): Promise<TransitionResult>
  reject(id: string): Promise<TransitionResult>
  disable(id: string): Promise<TransitionResult>
  enable(id: string): Promise<TransitionResult>
  archive(id: string): Promise<TransitionResult>
  /** Logical purge: content of every version erased, removed from search; the row and fingerprint remain. */
  purge(id: string): Promise<PurgeResult>
  /** Everything, including tombstones (no content), for the user's data-export right. */
  exportAll(): Promise<MemoryItem[]>
  /** Set (codes), clear ([]) or read (undefined) the session's entities. Unknown codes are ignored. */
  focus(sessionId: string, codes?: string[]): Promise<EntityState>
  /** Rate the session's last answer. A harmful rating with a correction may produce a lesson proposal. */
  feedback(f: { sessionId: string; verdict: "helpful" | "harmful"; correction?: string }): Promise<FeedbackResult>
  /** Lessons that keep helping: suggest turning them into a human-written rule (never automatic). */
  promotionCandidates(): Promise<MemoryItem[]>
}

export type ProposeResult =
  | { ok: true; item: MemoryItem }
  | {
      ok: false
      code:
        | "content_rejected"
        | "duplicate"
        | "covered_by_rule"
        | "daily_cap"
        | "invalid_input"
        | "too_large"
        | "storage_busy"
        | "storage_failed"
      reasons: string[]
    }

/**
 * System side: feedback, validator failures and repeated tool errors may only propose. A proposal is never active
 * and never reaches the prompt until the user approves it.
 */
export interface SystemMemory {
  propose(input: {
    body: string
    title?: string
    scope?: string
    origin: "feedback" | "validator" | "tool_error"
    sourceEvents?: SourceEvent[]
  }): Promise<ProposeResult>
}
