import type { AmbiguousReason, RejectReason } from "./content"
import type { MemoryItemV0 } from "./schema"

/** V0 needs no date, session or entities. Later versions add fields only when they need them. */
export interface TurnContextV0 {
  /** Unused in V0: T1 does not depend on the question. Present so V1 can add T2 without changing the call. */
  userText: string
}

export interface ContextBudget {
  /** Bytes of the final rendered block. Effective cap is min(config.t1MaxBytes, maxBytes). */
  maxBytes?: number
}

export type MemoryWarningCode = "db_unavailable" | "selection_failed" | "invalid_record" | "t1_overflow"
export interface MemoryWarning {
  code: MemoryWarningCode
  message: string
}

/**
 * Audit reference to what a turn used, not a way to rebuild context. Placeholder shape: always null in V0,
 * fixed in V2 together with the current-projection design.
 */
export type InjectionRef = { type: "memory"; id: string } | { type: "rule"; name: string }
export interface EntityState {
  items: { code: string; type: "ticker" | "index" | "future" }[]
}

export interface ContextContribution {
  stableBlocks: string[]
  injection: { refs: InjectionRef[] } | null
  entities: EntityState | null
  used: { memories: string[]; rules: string[] }
  warnings: MemoryWarning[]
}

/** Read side. This is the only memory object model-facing code may hold. */
export interface MemoryPort {
  beforeTurn(ctx: TurnContextV0, budget?: ContextBudget): Promise<ContextContribution>
}

export type RememberFailureCode =
  | "needs_confirmation"
  | "content_rejected"
  | "invalid_input"
  | "too_large"
  | "t1_unfit"
  | "storage_busy"
  | "storage_failed"

export type RememberResult =
  | { ok: true; item: MemoryItemV0 }
  /** Ambiguous content; nothing was written. Only the TUI may retry with confirmAmbiguous after the user agrees. */
  | { ok: false; code: "needs_confirmation"; reasons: AmbiguousReason[] }
  /** Never stored; confirmAmbiguous has no effect. */
  | { ok: false; code: "content_rejected"; reasons: RejectReason[] }
  | { ok: false; code: Exclude<RememberFailureCode, "needs_confirmation" | "content_rejected">; reasons: string[] }

export type PurgeResult = { ok: true } | { ok: false; code: "not_found" | "storage_busy" | "storage_failed" }

/**
 * Write side as an object capability: holding this object is the permission. Methods take no actor or token.
 * Production code hands it only to the TUI adapter.
 */
export interface UserMemoryCommands {
  remember(input: { body: string }, opts?: { confirmAmbiguous?: boolean }): Promise<RememberResult>
  /** Active items only. */
  list(): Promise<MemoryItemV0[]>
  purge(id: string): Promise<PurgeResult>
}
