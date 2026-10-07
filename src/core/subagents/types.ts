import type { ModelMessage } from "ai"

/**
 * queued: waiting for a slot (subagents.maxConcurrent); running; completed: answered;
 * failed: the model or a setup step errored; stopped: aborted (Esc, stop_agent, exit).
 */
export type AgentStatus = "queued" | "running" | "completed" | "failed" | "stopped"

/** One tool call made by a subagent, as its row shows it. */
export interface ChildToolView {
  callId: string
  name: string
  label: string
  status: "running" | "ok" | "error"
  durationMs?: number
  /** The user's answer when the call needed approval ("✓ Đã cho phép"). */
  decision?: string
}

/** What UIs see of a subagent; plain data, safe to copy into a store. */
export interface SubagentView {
  /** "ag-" + 6 base36 characters; the model uses it to refer to the agent. */
  id: string
  /** Agent type (e.g. nghien-cuu). */
  type: string
  description: string
  prompt: string
  /** Call id of the spawn_subagent call in the parent, when it came from one. */
  parentCallId?: string
  background: boolean
  /** "Provider · model", for display. */
  model: string
  status: AgentStatus
  createdAt: number
  startedAt?: number
  endedAt?: number
  /** The latest calls (at most MAX_TOOL_VIEWS); `toolCount` stays exact. */
  tools: ChildToolView[]
  toolCount: number
  /** Billed tokens over every request the subagent made. */
  usage: { input: number; output: number }
  /** Final answer (or the partial text after a failure or stop). */
  text: string
  error?: string
}

export interface SubagentResult {
  status: AgentStatus
  text: string
  error?: string
  toolCount: number
  usage: { input: number; output: number }
  durationMs: number
}

/** A running or finished subagent inside the manager. */
export interface SubagentRun extends SubagentView {
  controller: AbortController
  /** The child's conversation (for continuing it later). */
  messages: ModelMessage[]
  done: Promise<SubagentResult>
}

export const MAX_TOOL_VIEWS = 50
