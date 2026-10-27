import type { JSONSchema7 } from "@ai-sdk/provider"
import type { z } from "zod"
import type { ChartData } from "./chart/data"
import type { LoopGuard } from "./loop-guard"
import type { DiffLine } from "../fs/diff"

export interface ToolContext {
  signal: AbortSignal
  callId: string
  /** What `prepare` returned, if the tool has one. */
  prepared?: unknown
  /** Set when a subagent makes the call: approval prompts name it. */
  agent?: AgentOrigin
  /** Repeats of the same call in this turn (asks the user past the threshold). */
  loop?: LoopGuard
}

/** The subagent behind a tool call (see core/subagents). */
export interface AgentOrigin {
  id: string
  type: string
  description: string
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
  /** Structured chart payload the TUI renders as a coloured chart; never sent to the model. */
  chart?: ChartData
  /**
   * Where the content came from (web host, MCP server), told to the model in one line after the
   * output. Metadata only, not a judgement: content is not suspect because it came from there.
   */
  provenance?: string
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
  /** Default 60s. 0 = no time limit (the tool watches its own progress, e.g. spawn_subagent). */
  timeoutMs?: number
  /**
   * Runs without the read/write lock. Only for tools that wait on other tool calls
   * (spawn_subagent): holding a read lock while a child waits for the write lock deadlocks.
   */
  unlocked?: boolean
  /** Output longer than this is cut (head + tail) before the model sees it. Default 30 000. */
  maxOutputChars?: number
  /** Where the tool came from, shown in /tools. */
  source?: string
  /**
   * Order when the provider's tool limit forces some out: lower comes first. Native tools
   * have none (always first); MCP tools get their server's position in the config.
   */
  priority?: number
  /**
   * May be left out of the request until the model loads it with tool_search (MCP tools,
   * unless the server is `alwaysLoad`, and optional local tools such as charts). Core
   * built-ins (load_skill, ask_user, todo_write, tool_search…) are never deferred.
   */
  deferrable?: boolean
  /**
   * Never declared, listed as deferred or found by tool_search; it exists for a request only
   * when the turn preloads it (or history already called it). desk_run: only a request that
   * opted into ultradesk sees it, and it never crowds other tools out of search results.
   */
  onDemand?: boolean
  /** Extra words tool_search matches on (MCP `_meta["anthropic/searchHint"]`). */
  searchHint?: string
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
   * Per-call approval for a tool that is otherwise free to run (web_fetch: per domain).
   * Returns the scope to ask about (`domain:example.com`), or undefined when no prompt is
   * needed. "Always allow" rules are stored per tool and scope.
   */
  askFor?: (input: unknown) => string | undefined
  /**
   * Identity used for "always allow" rules: the MCP server's fingerprint (URL or command),
   * so a project server that reuses a trusted name does not inherit its permissions.
   */
  permissionScope?: string
  /**
   * A local side effect the permission mode governs: `file` (write_file, edit_file) or
   * `shell`. In ‖ read-only mode such a call asks with "switch to ▸" as an option.
   */
  effect?: "file" | "shell"
  /** Never run this call, whatever the mode or rules (odd Windows path, deleting a drive root). Returns why. */
  blockFor?(input: I): string | undefined
  /** Checks that need no approval (old_string not found, file not read yet): an error goes to the model before anyone is asked. */
  validate?(input: I): Promise<string | undefined>
  /** What the user approves: a title line and, for writes, the diff. */
  preview?(input: I): Promise<ApprovalPreview | undefined>
  /** What deny/ask rules with a `pattern` match: the target path (file tools) or the command (shell). */
  subject?(input: I): string | undefined
  /**
   * ▸▸ sends this call to the classifier although it is read-only: the read-only claim is the
   * tool's own (an MCP server's readOnlyHint), not something OpenTrading checked.
   */
  autoReview?: boolean
  /** ▸▸ auto mode may run this call without the classifier (a new file or one this run created; a read-only shell command). */
  autoSafe?(input: I): Promise<boolean>
  /** Session approvals are shared by tools of one group ("this folder, this session" covers write_file and edit_file). */
  approvalGroup?: string
  /**
   * Runs before approval, the timeout and the lock — for waiting on the user (ask_user),
   * which must neither count as runtime nor hold a lock. Its result reaches `execute` as
   * `ctx.prepared`.
   */
  prepare?(input: I, ctx: ToolContext): Promise<unknown>
  /** Short label for the TUI, e.g. `current_time()` or `add 2 + 3`. */
  summarize?(input: I): string
  execute(input: I, ctx: ToolContext): Promise<string | ToolResult>
}

export interface ApprovalPreview {
  /** e.g. `D:\Dau-tu\ke-hoach-FPT.md (mới, 42 dòng)`. */
  title: string
  diff?: DiffLine[]
  added?: number
  removed?: number
}

/** `source` of OpenTrading's optional local tools (charts, watchlist, sessions): deferrable, not MCP. */
export const LOCAL_SOURCE = "local"

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_OUTPUT_CHARS = 30_000
