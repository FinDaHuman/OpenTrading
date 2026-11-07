import type { HookBus } from "../hooks"
import type { ToolDef } from "../tools/types"
import type { ModelMessage } from "ai"
import type { Tier } from "../prompt/budget"
import type { CardOutcome } from "./cards/types"

/**
 * Memory contract for teammates. The harness decides WHERE memory goes in the prompt and
 * enforces the size caps; a provider decides WHAT is remembered and how it is stored.
 *
 * Rules every provider must follow (docs/contracts.md §6):
 * - Only the user makes memory take effect: a provider gives the model no tool that writes memory.
 * - Never store market data (prices, signals, ratios): it goes stale; tools fetch it.
 * - Memory never overrides INVESTOR.md or the built-in safety rules (lowest precedence).
 */

export type MemoryScope = "user" | "workspace"

export interface MemoryItem {
  id: string
  text: string
  /** A few words naming the item in the user's notice (what was used this turn); absent: its text's start. */
  title?: string
  scope: MemoryScope
  createdAt: string
  updatedAt: string
}

export interface MemoryContext {
  sessionId: string
  /**
   * The history this turn sends, before the user's message, with masks applied. A provider decides from it
   * what the model already has in view, instead of keeping its own record. Absent: none.
   */
  history?: readonly ModelMessage[]
  /**
   * The tier of the model this turn is sent to, so a provider can size what it returns to the core's
   * memory budget for that tier. Absent: the provider assumes the smallest tier.
   */
  tier?: Tier
  /**
   * The suggestion cards of this session and where each stands (spec 007), so a provider can tell the model
   * once what the user did with one, and that a pending one should not be suggested again. Absent: none.
   */
  cards?: readonly CardOutcome[]
}

export interface MemoryProvider {
  readonly id: string
  /** Static system-prompt section: how the model should use memory. Keep it short. */
  instructions?(): string | undefined
  /** Always-on summary for the context channel. The harness caps it (~4 KB). */
  index?(ctx: MemoryContext): Promise<string | undefined>
  /** Items relevant to this user message, sent as a reminder. The harness keeps ≤ 5 / ~4 KB. */
  recall?(query: string, ctx: MemoryContext): Promise<MemoryItem[]>
  /** Tools the model may call, read-only (e.g. memory_read). Registered once at startup. */
  tools?(): ToolDef[]
  /**
   * Subscribe to lifecycle events (session-start, user-prompt, turn-end, session-end).
   * Return a cleanup function so the provider can be switched off at runtime (/config).
   */
  register?(hooks: HookBus): void | (() => void)
  /** What keeps the provider from working (a store that did not open), for the TUI to say; empty when fine. */
  problems?(): string[]
}

/** Harness-side caps on what a provider may inject. */
export const MEMORY_INDEX_MAX_CHARS = 4_000
export const MEMORY_RECALL_MAX_ITEMS = 5
export const MEMORY_RECALL_MAX_CHARS = 4_000

/** Default: memory off. Everything optional is simply absent. */
export class NoopMemory implements MemoryProvider {
  readonly id = "none"
}
