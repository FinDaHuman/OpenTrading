import type { JSONSchema7 } from "@ai-sdk/provider"
import type { z } from "zod"

export interface ToolContext {
  signal: AbortSignal
  callId: string
}

export interface ToolResult {
  output: string
  title?: string
}

/**
 * One tool, native or from MCP. Everything the model can call goes through this shape,
 * so the agent loop never needs to know where a tool came from.
 */
export interface ToolDef<I = any> {
  /** Name the model sees: [A-Za-z0-9_-], at most 64 characters. */
  name: string
  description: string
  /** zod for native tools, plain JSON Schema for MCP tools. */
  input: z.ZodType<I> | JSONSchema7
  /** Read-only tools may run in parallel; anything else runs alone. */
  readOnly: boolean
  /** Default 60s. */
  timeoutMs?: number
  /** Output longer than this is cut (head + tail) before the model sees it. Default 30 000. */
  maxOutputChars?: number
  /** Where the tool came from, shown in /tools. */
  source?: string
  /** Short label for the TUI, e.g. `current_time()` or `add 2 + 3`. */
  summarize?(input: I): string
  execute(input: I, ctx: ToolContext): Promise<string | ToolResult>
}

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_OUTPUT_CHARS = 30_000
