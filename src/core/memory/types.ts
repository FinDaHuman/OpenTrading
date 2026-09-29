import type { HookBus } from "../hooks"
import type { ToolDef } from "../tools/types"

/**
 * Memory contract for teammates. The harness decides WHERE memory goes in the prompt and
 * enforces the size caps; a provider decides WHAT is remembered and how it is stored.
 *
 * Rules every provider must follow (docs/contracts.md §6):
 * - `pending` items are proposals: never returned by index() or recall() until approved.
 * - Never store market data (prices, signals, ratios): it goes stale; tools fetch it.
 * - Memory never overrides INVESTOR.md or the built-in safety rules (lowest precedence).
 */

export type MemoryScope = "user" | "workspace"
export type MemoryStatus = "pending" | "active"

export interface MemoryItem {
  id: string
  text: string
  scope: MemoryScope
  status: MemoryStatus
  /** Where it came from, for the /memory list and audits. */
  source?: { sessionId?: string; via: "model" | "user" }
  createdAt: string
  updatedAt: string
}

export interface MemoryContext {
  sessionId: string
}

export interface MemoryProvider {
  readonly id: string
  /** Static system-prompt section: how the model should use memory. Keep it short. */
  instructions?(): string | undefined
  /** Always-on summary for the context channel. The harness caps it (~4 KB). */
  index?(ctx: MemoryContext): Promise<string | undefined>
  /** Items relevant to this user message, sent as a reminder. The harness keeps ≤ 5 / ~4 KB. */
  recall?(query: string, ctx: MemoryContext): Promise<MemoryItem[]>
  /** Tools the model may call, e.g. propose_memory. Registered once at startup. */
  tools?(): ToolDef[]
  /** Subscribe to lifecycle events (session-start, user-prompt, turn-end, session-end). */
  register?(hooks: HookBus): void
  /** Management, used by /memory. */
  list?(): Promise<MemoryItem[]>
  approve?(id: string): Promise<void>
  reject?(id: string): Promise<void>
  remove?(id: string): Promise<void>
}

/** Harness-side caps on what a provider may inject. */
export const MEMORY_INDEX_MAX_CHARS = 4_000
export const MEMORY_RECALL_MAX_ITEMS = 5
export const MEMORY_RECALL_MAX_CHARS = 4_000

/** Default: memory off. Everything optional is simply absent. */
export class NoopMemory implements MemoryProvider {
  readonly id = "none"
}
