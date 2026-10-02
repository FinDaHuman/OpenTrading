import type { JSONSchema7 } from "@ai-sdk/provider"
import type { z } from "zod"

export interface ToolContext {
  signal: AbortSignal
  callId: string
}

export interface ToolImage {
  /** Base64, no data: prefix. */
  data: string
  mediaType: string
}

export interface ToolResult {
  output: string
  title?: string
  /** Images for models that can see them (screenshots, charts); others get a placeholder. */
  images?: ToolImage[]
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
  /**
   * Order when the provider's tool limit forces some out: lower comes first. Native tools
   * have none (always first); MCP tools get their server's position in the config.
   */
  priority?: number
  /** Human label, e.g. `github · create_issue` (MCP); defaults to `name`. */
  displayName?: string
  /** MCP tool annotations, shown in /mcp and in the approval prompt. */
  annotations?: { title?: string; destructive?: boolean; openWorld?: boolean }
  /**
   * Who may run this without asking. Read-only tools never ask. `"never"` exempts a
   * non-read-only tool whose effect is already reviewed elsewhere (propose_memory only
   * queues a proposal the user approves in /memory).
   */
  approval?: "never"
  /**
   * Identity used for "always allow" rules: the MCP server's fingerprint (URL or command),
   * so a project server that reuses a trusted name does not inherit its permissions.
   */
  permissionScope?: string
  /** Short label for the TUI, e.g. `current_time()` or `add 2 + 3`. */
  summarize?(input: I): string
  execute(input: I, ctx: ToolContext): Promise<string | ToolResult>
}

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_OUTPUT_CHARS = 30_000
