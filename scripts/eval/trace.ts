import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"

/**
 * One line per event, in the order things happened. The scorer reads this format and nothing
 * else: traces of other harnesses are converted to it, so a field added here must be optional
 * for them, and any other change bumps the version.
 */
export const TRACE_VERSION = 1

interface Asked {
  /** Question id and repeat number: every event of a run of a question carries them. */
  q: string
  rep: number
}

export type TraceEvent =
  | {
      type: "run"
      trace_version: number
      harness: string
      harness_version: string
      commit?: string
      prompt_version?: string
      provider: string
      model: string
      started_at: string
      tools: number
      settings?: Record<string, unknown>
    }
  | (Asked & { type: "question"; group: string; question: string; now: string })
  | (Asked & { type: "tool_call"; call_id: string; tool: string; input: unknown; step: number })
  /** What the model was shown, after notices and the output cap. Subagent calls have none. */
  | (Asked & { type: "tool_result"; call_id: string; ok: boolean; visible: string; duration_ms: number })
  /** What the tool returned, before any cap: `agent` is set when a subagent made the call. */
  | (Asked & { type: "tool_raw"; call_id: string; tool: string; input: unknown; ok: boolean; raw: string; agent?: string })
  | (Asked & { type: "retry"; attempt: number; delay_ms: number; label: string })
  | (Asked & { type: "notice"; text: string })
  | (Asked & { type: "error"; message: string; kind?: string })
  | (Asked & {
      type: "answer"
      /** The answer the harness kept. */
      text: string
      /** Everything the user saw stream, drafts the stop gate threw away included. */
      streamed?: string
      outcome: string
      unanswered: boolean
      recoveries: { kind: string; attempt: number }[]
      data_gaps: string[]
      /** Finished model steps, subagents included. Retries and side calls are not in it. */
      model_steps: number
      input_tokens: number
      output_tokens: number
      duration_ms: number
    })

export type TraceWriter = (event: TraceEvent) => void

/** Appends synchronously: a killed run keeps every line written so far. */
export function traceFile(file: string): TraceWriter {
  mkdirSync(path.dirname(file), { recursive: true })
  return (event) => appendFileSync(file, `${JSON.stringify(event)}\n`)
}
