import type { ModelMessage } from "ai"
import { contextLimits as limitsOf, DEFAULT_COMPACT_PERCENT, type ContextLimits } from "../core/compact"
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
import type { ShownNotice } from "./notify"
import type { ModelPrefs } from "../core/model-prefs"
import { DEFAULT_SCROLL_SPEED } from "./scroll"
import type { AttachedFile } from "../core/mentions"

export type ToolStatus = "running" | "ok" | "error"

export type Line =
  /** `files`: what the user @-attached, one "⎿ Đã đọc …" line each. */
  | { kind: "user"; text: string; files?: AttachedFile[] }
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
  /** "✻ Xong sau 1m 23s": a long turn finished (`background` subagents still running). */
  | { kind: "done"; ms: number; background?: number }

/** The turn (or compaction) being worked on, for the row above the prompt (activity.tsx). */
export interface Activity {
  startedAt: number
  /** Time the turn spent waiting for the user (approval, question): not counted. */
  pausedMs: number
  /** Set while a prompt waits for the user. */
  pausedAt?: number
  /** Output tokens the provider billed for the finished steps. */
  billedOut: number
  /** Output tokens of the step streaming now, estimated (chars / 4). */
  streamedOut: number
  /** Last sign of life: a delta, a tool event, streamed reasoning. */
  lastProgressAt: number
  toolsRunning: number
  verb: string
  tip?: string
  /** A model request waiting to be retried; `until` is when it goes out again. */
  retry?: { attempt: number; max: number; until: number; label: string }
}

/**
 * A message typed while an answer was streaming, sent once it ends (Claude Code). `display`
 * is what the box showed; `saved` turns its pills back on if it returns to the box.
 */
export type Queued = { text: string; display: string; images: PromptImage[]; saved: Omit<DraftSnapshot, "text"> }

export type DialogName = "connect" | "model" | "skills" | "help" | "mcp" | "tools" | "context" | "sessions" | "memory" | "config" | "agents" | "tasks" | "watchlist" | "permissions" | "shortcuts"

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
  /** Favourite and recent models (~/.opentrading/model.json). */
  modelPrefs: { favorite: [], recent: [] } as ModelPrefs,
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
  /** The footer notification showing now (see notify.ts); the rest wait in its queue. */
  notification: undefined as ShownNotice | undefined,
  /** Warning/error cards in the top-right corner, newest first. */
  toasts: [] as ShownNotice[],
  /** Set after one Ctrl+C / Ctrl+D: a second press within the window exits. */
  exitArmed: undefined as "Ctrl+C" | "Ctrl+D" | undefined,
  exiting: false,
  /** Questions from the model waiting for the user (ask_user). */
  question: undefined as AskRequest | undefined,
  /** todo_write accepted during the running turn; undefined → derive from history. */
  liveTodos: undefined as Todo[] | undefined,
  /** Context size after the last turn (provider usage, else estimated); undefined = unknown. */
  contextTokens: undefined as number | undefined,
  /** `contextTokens` is an estimate (chars/4, scaled after a compaction), not the provider's count. */
  contextEstimated: false,
  /** Size right after a compaction that stayed above the threshold: wait for growth past it. */
  compactFloor: undefined as number | undefined,
  /** Consecutive failed automatic compactions in this session. */
  compactFailures: 0,
  compacting: false,
  /** Messages waiting for the running answer to finish. */
  queue: [] as Queued[],
  /** Config `compactWindow`: cap on the model's window; undefined = the model's whole window. */
  compactCap: undefined as number | undefined,
  /** Config `autoCompactPercent`: compact at this share of (window − reserve). */
  compactPercent: DEFAULT_COMPACT_PERCENT,
  /** Subagents of this session by id (live progress from the SubagentManager). */
  agents: {} as Record<string, SubagentView>,
  /** The row of the subagent panel that has the keyboard (↓ from the prompt); undefined = the prompt. */
  panelFocus: undefined as number | undefined,
  /** Subagent /tasks opens on (enter on a panel row). */
  tasksFocus: undefined as string | undefined,
  /** Subagent slots: running, waiting for a slot, limit (config subagents.maxConcurrent). */
  agentSlots: { running: 0, waiting: 0, max: 10 },
  /** What is being worked on now; undefined when idle. */
  activity: undefined as Activity | undefined,
  /** Config `ui.tips`: a tip under the working row once a turn runs long. */
  tips: true,
  /** Config `ui.terminalNotify`: notifications and the tab progress ring (attention.ts). */
  terminalNotify: true,
  /** Config `ui.scrollSpeed` / `ui.scrollAcceleration`: transcript rows per wheel notch. */
  scroll: { speed: DEFAULT_SCROLL_SPEED, accelerate: false },
  /** Config `autoCompact: "off"`: the status bar warns when the context runs low. */
  autoCompactOff: false,
  /** Every approval request waiting (the head is `approval`). */
  approvals: [] as ApprovalRequest[],
  /** ‖ read-only / ▸ ask (Shift+Tab); mirrors PermissionGate.mode. */
  permissionMode: "read-only" as PermissionMode,
  /** The ▸▸ auto opt-in dialog is open; `from` is the mode kept if the user says no. */
  autoOptIn: undefined as { from: PermissionMode } | undefined,
  /** The user said yes to ▸▸ auto once (config permissions.autoAcknowledged). */
  autoAcknowledged: false,
  /** ▸▸ auto's classifier paused after a quota error, until this time (ms). */
  autoPausedUntil: undefined as number | undefined,
  /** Subagent types (bundled, user, project) and files that failed to load. */
  agentDefs: [] as AgentDefinition[],
  agentProblems: [] as AgentProblem[],
  /** Background subagent results not yet delivered to the model (<thong_bao_subagent>). */
  notices: [] as string[],
  /** The last turn failed: hold notices until the user sends something (no 429 retry loop). */
  noticeHold: false,
})

/** Window, reserve and auto-compaction threshold of the selected model (see core/compact). */
export const contextLimits = (): ContextLimits | undefined =>
  limitsOf(state.provider && state.model ? state.catalog[state.provider]?.models[state.model]?.limit : undefined, {
    cap: state.compactCap,
    percent: state.compactPercent,
  })

/** Fresh-session values for the compaction bookkeeping. */
export const NO_COMPACTION = { contextTokens: undefined, contextEstimated: false, compactFloor: undefined, compactFailures: 0 } as const

export function pushLine(line: Line) {
  setState("lines", (lines) => [...lines, line])
}

export const closeDialog = () => setState("dialog", undefined)

export const providerName = (id?: ProviderId) => (id ? (state.catalog[id]?.name ?? id) : "")

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
export const blocked = () => Boolean(state.approval || state.question || state.autoOptIn)
