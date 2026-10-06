import type { ModelMessage } from "ai"
import type { ClockSnapshot } from "./prompt/market-clock"

/**
 * Everything the agent loop tells a UI. Tool events are correlated by `callId`.
 * Core never imports UI code; the TUI (or a future daemon/web client) just consumes these.
 */
export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-start"; callId: string; name: string; label: string; input: unknown }
  | { type: "tool-end"; callId: string; ok: boolean; output: string; durationMs: number }
  /** Informational: step limit reached, model without tool support… */
  | { type: "notice"; text: string }
  /** The turn failed; `done` still follows. */
  | { type: "error"; message: string }
  /** Messages to append to history. Never contains a tool call without its result. */
  | {
      type: "done"
      messages: ModelMessage[]
      clock?: ClockSnapshot
      /** Context size after this turn: the provider's count, or chars/4 when it gave none. */
      usage?: { contextTokens: number; estimated: boolean }
    }
