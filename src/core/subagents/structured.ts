import type { z } from "zod"
import type { ToolDef } from "../tools/types"

/**
 * Structured output for a subagent, the way Claude Code's workflow agents do it: a tool the
 * agent must call once with the result as its input. Tool input is validated by the SDK on
 * every provider, so this needs no provider's JSON mode (unlike Output.object).
 */
export const RESULT_TOOL = "tra_ket_qua"

/** Sorts before native tools (no priority, read as -1) and MCP tools (server order, 0 and up). */
export const RESULT_PRIORITY = -1000

/** Turns a run may take to produce a valid result. */
export const MAX_RESULT_ATTEMPTS = 5

/** Sent when a turn ended without a valid call; the next turn's last step forces the tool. */
export const RESULT_REMINDER =
  `You have not called ${RESULT_TOOL} with a valid result. Call ${RESULT_TOOL} now, matching the schema, with what you have; ` +
  "mark missing figures as missing, never invent them."

/** The last step of a run with a schema: answer through the tool, not in prose. */
export const RESULT_LAST_STEP = `This is the last step. Call ${RESULT_TOOL} now with the result you have; mark anything missing as missing.`

export function resultTool(schema: z.ZodObject, sink: (data: unknown) => void): ToolDef {
  return {
    name: RESULT_TOOL,
    description:
      `Returns the task's final result to whoever assigned it, matching the schema. Call exactly once when done; ` +
      "after the call, stop and write nothing more.",
    input: schema,
    readOnly: true,
    // Ahead of every other tool, so a provider's tool cap can never drop it.
    priority: RESULT_PRIORITY,
    summarize: () => `${RESULT_TOOL}(…)`,
    async execute(input) {
      // The SDK validated the call against the schema and hands over its parsed output
      // (defaults and transforms applied once). Parsing it again would break transforms
      // such as z.string().transform(Number).
      sink(input)
      return "Result received. Stop here."
    },
  }
}
