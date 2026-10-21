import type { z } from "zod"
import type { Effort } from "../effort"
import type { RunFailure } from "../subagents/types"

/**
 * Ultradesk: deterministic orchestration of many research subagents (docs/desk.md), modelled
 * on Claude Code's dynamic workflows. A playbook's code holds the loop, the branching and the
 * intermediate results; the main agent only gets the final result.
 */

/** How big a run may get. Typed playbooks map it to their own tiers (estimate). */
export type DeskSize = "small" | "medium" | "large" | "unrestricted"
export const DESK_SIZES: DeskSize[] = ["small", "medium", "large", "unrestricted"]

/** Options of one agent() call. Only prompt + type/schema/effort/model/maxSteps identify it for resume. */
export interface AgentOpts {
  /** Display name in /desk (defaults to the start of the prompt). */
  label?: string
  /** Progress group; defaults to the last phase() title. */
  phase?: string
  /** Agent type (agents/*.md); default tra-cuu. Tools are always narrowed to read-only. */
  type?: string
  /** Structured result: the agent returns this object (tra_ket_qua) instead of prose. */
  schema?: z.ZodObject
  effort?: Effort
  model?: { provider?: string; model?: string }
  maxSteps?: number
}

/** A rough cost before running: agents started and model requests (sum of maxSteps). */
export interface Estimate {
  agents: number
  requests: number
}

export interface PlaybookMeta<A = unknown> {
  name: string
  /** Bump when prompts or the flow change: resume never reuses results across versions. */
  version: string
  description: string
  /** When the main agent should pick it (desk_run's description). */
  whenToUse: string
  args: z.ZodType<A>
  /** Agent types it may start; agent() rejects any other. */
  agentTypes: string[]
  /** Phase titles in order, for the progress view. */
  phases: string[]
  estimate(args: A, size: DeskSize): Estimate
}

export interface Playbook<A = any, R = unknown> {
  meta: PlaybookMeta<A>
  run(ctx: DeskContext<A>): Promise<R>
}

/** What a playbook's code may use: Claude Code's workflow hooks, typed. */
export interface DeskContext<A = unknown> {
  args: A
  size: DeskSize
  /**
   * One subagent. Resolves to its structured data (with a schema) or its report text.
   * Throws when it fails, is stopped, or a cap is reached; inside parallel()/pipeline()
   * that becomes null instead.
   */
  agent<T = unknown>(prompt: string, opts?: AgentOpts): Promise<T>
  /** All thunks concurrently; waits for all (a barrier). A thunk that throws gives null. */
  parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>>
  /**
   * Every item through every stage, with no barrier between stages: item A can be in stage 3
   * while item B is in stage 1. A stage that throws drops that item to null.
   */
  pipeline<T>(items: readonly T[], ...stages: Array<(prev: any, item: T, index: number) => unknown>): Promise<unknown[]>
  phase(title: string): void
  log(message: string): void
  budget: { maxAgents: number; maxRequests: number | undefined; agents(): number; requests(): number }
  /** Run another playbook inline (one level only); it shares this run's caps and journal. */
  playbook<R = unknown>(name: string, args: unknown): Promise<R>
  /** Whether the run is winding down (quota, cap, stop): long loops should end early. */
  stopping(): boolean
}

export type DeskAgentStatus = "queued" | "running" | "done" | "cached" | "failed" | "skipped"

export interface DeskAgentView {
  key: string
  label: string
  phase: string
  type: string
  status: DeskAgentStatus
  /** The subagent (ag-…), once started. */
  agentId?: string
  requests: number
  tokens: { input: number; output: number }
  error?: string
  failure?: RunFailure | "cap" | "stopped"
}

/**
 * running → done (every agent answered) | partial (quota, a cap or a stop cut it short:
 * resumable) | failed (the playbook threw) | stopped.
 */
export type DeskRunStatus = "running" | "paused" | "done" | "partial" | "failed" | "stopped"

export interface DeskRunView {
  id: string
  playbook: string
  version: string
  args: unknown
  size: DeskSize
  effort?: Effort
  status: DeskRunStatus
  /** Why it ended early: "quota" (daily quota), "rate" (repeated 429s), "agents" / "requests" (a cap), "stop". */
  cut?: "quota" | "rate" | "agents" | "requests" | "stop"
  phases: { title: string; total: number; done: number; failed: number }[]
  agents: DeskAgentView[]
  logs: string[]
  createdAt: number
  endedAt?: number
  counters: { agents: number; cached: number; requests: number; input: number; output: number }
  /** What run() returned. */
  result?: unknown
  error?: string
  sessionId?: string
}
