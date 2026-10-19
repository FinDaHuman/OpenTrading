import type { ModelMessage } from "ai"
import { DEFAULT_COMPACT_WINDOW, effectiveWindow } from "../core/compact"
import type { Todo } from "../core/tools/todos"
import type { ChartData } from "../core/tools/chart/data"
import { createStore } from "solid-js/store"
import type { Catalog } from "../core/catalog"
import type { McpServerStatus } from "../core/mcp/manager"
import type { AskRequest } from "../core/ask"
import type { PermissionMode } from "../core/permission/mode"
import type { ApprovalRequest } from "../core/permission"
import type { ProviderId } from "../core/providers"
import type { ClockSnapshot } from "../core/prompt/market-clock"
import type { Skill, SkillProblem } from "../core/skills/schema"
import type { PromptImage } from "./prompt/image"
import type { DraftSnapshot } from "./prompt/parts"
import type { SubagentView } from "../core/subagents/types"
import type { AgentDefinition, AgentProblem } from "../core/agents/schema"

export type ToolStatus = "running" | "ok" | "error"

export type Line =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; done: boolean }
  | {
      kind: "tool"
      callId: string
      name: string
      label: string
      status: ToolStatus
      output?: string
      durationMs?: number
      /** The user's answer to the approval prompt, shown under the call ("✓ Đã cho phép …"). */
      decision?: string
      /** Model request that made the call; parallel subagents of one step render as one block. */
      step?: number
    }
  | { kind: "info"; text: string }
  /** A coloured chart the TUI paints itself (chart_render carried structured data). */
  | { kind: "chart"; data: ChartData }
  /** History was compacted here. `summary` is absent when only old tool results were pruned. */
  | { kind: "compact"; summary?: string; before?: number; after?: number; pruned?: number }
  | { kind: "error"; text: string }
  /** A background subagent finished; its result went (or goes) to the model as a notification. */
  | { kind: "agent-notice"; agentId: string; text: string; status: string }

/**
 * A message typed while an answer was streaming, sent once it ends (Claude Code). `display`
 * is what the box showed; `saved` turns its pills back on if it returns to the box.
 */
export type Queued = { text: string; display: string; images: PromptImage[]; saved: Omit<DraftSnapshot, "text"> }

export type DialogName = "connect" | "model" | "skills" | "help" | "mcp" | "tools" | "context" | "sessions" | "memory" | "config" | "agents" | "tasks" | "watchlist" | "permissions"

export const [state, setState] = createStore({
  lines: [] as Line[],
  /** What the model sees next turn, including tool calls and results. */
  history: [] as ModelMessage[],
  streaming: false,
  provider: undefined as ProviderId | undefined,
  model: undefined as string | undefined,
  catalog: {} as Catalog,
  /** Providers that have a stored key or env var. */
  connected: [] as ProviderId[],
  /** Pre-filled filter for the next /model dialog (e.g. right after /connect). */
  modelFilter: "",
  skills: [] as Skill[],
  skillProblems: [] as SkillProblem[],
  /** Skills pinned for the session with /skill <name>. */
  activeSkills: [] as string[],
  /** Market-clock snapshot last sent to the model; undefined → send on the next turn. */
  clock: undefined as ClockSnapshot | undefined,
  mcp: [] as McpServerStatus[],
  /** Show full tool output instead of the first lines (ctrl+o). */
  expandTools: false,
  dialog: undefined as DialogName | undefined,
  /** Tool call waiting for the user's yes/no (head of the permission queue). */
  approval: undefined as ApprovalRequest | undefined,
  /** A short status-bar message ("✓ Đã copy 42 ký tự"), cleared after a moment. */
  flash: undefined as string | undefined,
  /** Set after one Ctrl+C / Ctrl+D: a second press within the window exits. */
  exitArmed: undefined as "Ctrl+C" | "Ctrl+D" | undefined,
  exiting: false,
  /** Questions from the model waiting for the user (ask_user). */
  question: undefined as AskRequest | undefined,
  /** todo_write accepted during the running turn; undefined → derive from history. */
  liveTodos: undefined as Todo[] | undefined,
  /** Context size after the last turn (provider usage, else estimated); undefined = unknown. */
  contextTokens: undefined as number | undefined,
  /** Size right after a compaction that stayed above the threshold: wait for growth past it. */
  compactFloor: undefined as number | undefined,
  /** Consecutive failed automatic compactions in this session. */
  compactFailures: 0,
  compacting: false,
  /** Messages waiting for the running answer to finish. */
  queue: [] as Queued[],
  /** Effective-window cap (config compactWindow). */
  compactCap: DEFAULT_COMPACT_WINDOW,
  /** Subagents of this session by id (live progress from the SubagentManager). */
  agents: {} as Record<string, SubagentView>,
  /** Subagent slots: running, waiting for a slot, limit (config subagents.maxConcurrent). */
  agentSlots: { running: 0, waiting: 0, max: 10 },
  /** Every approval request waiting (the head is `approval`). */
  approvals: [] as ApprovalRequest[],
  /** ‖ read-only / ▸ ask (Shift+Tab); mirrors PermissionGate.mode. */
  permissionMode: "read-only" as PermissionMode,
  /** Subagent types (bundled, user, project) and files that failed to load. */
  agentDefs: [] as AgentDefinition[],
  agentProblems: [] as AgentProblem[],
  /** Background subagent results not yet delivered to the model (<thong_bao_subagent>). */
  notices: [] as string[],
  /** The last turn failed: hold notices until the user sends something (no 429 retry loop). */
  noticeHold: false,
})

/** Effective context window of the selected model: models.dev limit, capped (see core/compact). */
export const contextWindow = (): number | undefined =>
  effectiveWindow(state.provider && state.model ? state.catalog[state.provider]?.models[state.model]?.limit?.context : undefined, state.compactCap)

/** Fresh-session values for the compaction bookkeeping. */
export const NO_COMPACTION = { contextTokens: undefined, compactFloor: undefined, compactFailures: 0 } as const

export function pushLine(line: Line) {
  setState("lines", (lines) => [...lines, line])
}

export const closeDialog = () => setState("dialog", undefined)

export const providerName = (id?: ProviderId) => (id ? (state.catalog[id]?.name ?? id) : "")

let flashTimer: ReturnType<typeof setTimeout> | undefined
/** Show a message in the status bar for `ms`. */
export function flash(text: string, ms = 2000) {
  clearTimeout(flashTimer)
  setState("flash", text)
  flashTimer = setTimeout(() => setState("flash", undefined), ms)
}

/** Claude Code's double-press window for Ctrl+C / Ctrl+D. */
export const EXIT_WINDOW_MS = 800

let exitTimer: ReturnType<typeof setTimeout> | undefined
export function armExit(key: "Ctrl+C" | "Ctrl+D") {
  clearTimeout(exitTimer)
  setState("exitArmed", key)
  exitTimer = setTimeout(() => setState("exitArmed", undefined), EXIT_WINDOW_MS)
}

let exitHandler: (() => void) | undefined
/** The app registers its exit routine; SIGINT (main.tsx) goes through the same path. */
export function onExitRequest(fn: (() => void) | undefined) {
  exitHandler = fn
}
export function requestExit() {
  if (exitHandler) exitHandler()
  else process.exit(0)
}

/**
 * A prompt (approval or question) sits on top. Panels and dialogs stay mounted underneath —
 * nothing typed or chosen is lost — but must not react to keys meanwhile.
 */
export const blocked = () => Boolean(state.approval || state.question)
