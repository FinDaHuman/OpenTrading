import type { ModelMessage } from "ai"
import { createStore } from "solid-js/store"
import type { Catalog } from "../core/catalog"
import type { McpServerStatus } from "../core/mcp/manager"
import type { ApprovalRequest } from "../core/permission"
import type { ProviderId } from "../core/providers"
import type { ClockSnapshot } from "../core/prompt/market-clock"
import type { Skill, SkillProblem } from "../core/skills/schema"

export type ToolStatus = "running" | "ok" | "error"

export type Line =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; done: boolean }
  | { kind: "tool"; callId: string; name: string; label: string; status: ToolStatus; output?: string; durationMs?: number }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }

export type DialogName = "connect" | "model" | "skills" | "help" | "mcp" | "tools" | "context" | "sessions" | "memory" | "config"

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
})

export function pushLine(line: Line) {
  setState("lines", (lines) => [...lines, line])
}

export const closeDialog = () => setState("dialog", undefined)

export const providerName = (id?: ProviderId) => (id ? (state.catalog[id]?.name ?? id) : "")
