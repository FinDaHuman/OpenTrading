import type { CardDraft } from "./memory/cards/types"
import type { ModelMessage } from "ai"
import type { ClockSnapshot } from "./prompt/market-clock"
import type { FailureKind } from "./retry"
import type { ChartData } from "./tools/chart/data"
import type { Redaction, RedactItem } from "./memory/redaction/redact"

/**
 * Everything the agent loop tells a UI. Tool events are correlated by `callId`.
 * Core never imports UI code; the TUI (or a future daemon/web client) just consumes these.
 */
export type AgentEvent =
  | { type: "text-delta"; text: string }
  /** `step`: the model request (1, 2, …) that made the call; calls of one step run together. */
  | { type: "tool-start"; callId: string; name: string; label: string; input: unknown; step: number }
  | { type: "tool-end"; callId: string; ok: boolean; output: string; chart?: ChartData; durationMs: number }
  /** Informational: step limit reached, model without tool support… */
  | { type: "notice"; text: string }
  /** A suggestion card the final answer ended with, checked, before "done" (spec 007); the TUI gives it an id. */
  | { type: "card"; card: CardDraft }
  /**
   * Start of a main-agent turn: memory blocks were masked. `kept` replaces the history (masks the store
   * confirmed); `record` is what to write as one redact line; `temporary` says blocks were held in what is
   * sent only. Sent only when `record` or `temporary` has something.
   */
  | { type: "memory-redaction"; kept: ModelMessage[]; record: RedactItem[]; temporary?: Redaction["temporary"] }
  /**
   * A model request failed and is retried after `delayMs` (retry `attempt` of `max`); the
   * next attempt starts at `until` (epoch ms). Any later event means the wait is over.
   */
  | { type: "retry"; attempt: number; max: number; delayMs: number; until: number; label: string }
  /**
   * The turn failed; `done` still follows. `kind`: retry.ts's reading of the error, a stall,
   * or "tool-choice" (the model ignored a required final tool).
   */
  | { type: "error"; message: string; kind?: FailureKind | "stall" | "tool-choice" }
  /** One model request finished (every step, whether or not the provider reported usage). */
  /** One finished model request; `servedBy` = the upstream provider that answered, when the gateway says (OpenRouter). */
  | { type: "step"; servedBy?: string }
  /** Billed tokens of one model request (sent after each step that reported usage). */
  | { type: "step-usage"; inputTokens: number; outputTokens: number }
  /** The model is streaming reasoning: never shown, but it is progress (stall timer, subagent watchdog). */
  | { type: "progress" }
  /** Messages to append to history. Never contains a tool call without its result. */
  | {
      type: "done"
      messages: ModelMessage[]
      clock?: ClockSnapshot
      /**
       * `contextTokens`: context size after this turn (the provider's count, or chars/4 when it
       * gave none). `total`: billed tokens of every request in the turn, when reported.
       */
      usage?: { contextTokens: number; estimated: boolean; total?: { input: number; output: number } }
      /** How the turn ended. Hook-blocked turns count as completed. */
      outcome?: "completed" | "failed" | "aborted"
      /** The stop gate sent the model back this many times, and why (loop/stop-gate.ts). */
      recoveries?: { kind: string; attempt: number }[]
      /** Completed without an answer: the stop gate gave up (a notice says why). */
      unanswered?: boolean
      /** Items the model left open in this turn's list when it answered (the list was retired). */
      retiredTodos?: number
      /** Tools whose data the turn did not get (loop/failures.ts). */
      dataGaps?: string[]
      /** Figures of the answer that no tool result held (stop-gate.ts ungroundedInTurn): measured only. */
      ungrounded?: string[]
      /** Harness markup taken out of the answer (loop/markup.ts): tag names, measured only. */
      markup?: string[]
    }
