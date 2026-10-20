import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { fmtTokens } from "../core/subagents/result"
import type { SubagentView } from "../core/subagents/types"
import { fmtElapsed } from "./activity"
import { state } from "./state"
import { shownTodos, visibleTodos } from "./todo-panel"
import { hasOpenTodos } from "../core/tools/todos"
import { color } from "./theme"
import { useNow, useSpinner } from "./ui/clock"
import { pad, truncate, width as cells } from "./ui/text"

/**
 * This session's subagents under the prompt, after Claude Code's agent list (the screenshot
 * the user sent; CoordinatorAgentStatus.tsx):
 *
 *   ● main
 *   ⠹ nghien-cuu  Định giá FPT · valuation_run(FPT)        53s · ↓ 12,4k token
 *   ◌ vi-mo       Lãi suất VN                                    chờ slot (10/10)
 *   … +2 agent
 *
 * Running and queued agents stay; finished ones linger a few seconds, then go. ↓ from the
 * prompt (at the end of its history) selects a row: ↑↓ move, enter opens it in /tasks,
 * x twice (or ctrl+x) stops it, esc or typing goes back to the prompt.
 */

/** A finished agent stays on the panel this long. */
export const LINGER_MS = 5000
/** Rows for agents; the rest are counted. */
export const PANEL_ROWS = 5

const isActive = (a: SubagentView) => a.status === "queued" || a.status === "running"

/** The agents the panel lists at time `t`, oldest first. */
export function panelAgents(t: number): SubagentView[] {
  return Object.values(state.agents)
    .filter((a) => isActive(a) || (a.endedAt !== undefined && t - a.endedAt < LINGER_MS))
    .sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Agent rows that fit on a terminal `height` rows tall next to everything else that cannot
 * shrink (prompt, mode line, status bar, working row, todo panel, queued messages) and a few
 * transcript rows: at least 2 (one agent and "… +N"), at most PANEL_ROWS.
 */
export function panelRowsFor(height: number): number {
  const todos = shownTodos()
  const todoRows = hasOpenTodos(todos) ? (() => {
    const v = visibleTodos(todos)
    return v.items.length + (v.hidden > 0 ? 1 : 0) + 2
  })() : 0
  const fixed =
    3 + // prompt
    1 + // mode line
    1 + // status bar
    1 + // "● main"
    3 + // the least of the transcript worth keeping
    (state.activity ? 2 : 0) +
    todoRows +
    (state.queue.length > 0 ? state.queue.length + 1 : 0)
  return Math.max(2, Math.min(PANEL_ROWS, height - fixed))
}

/** The window of rows shown, keeping the selected one in view. */
export function panelWindow(count: number, selected: number | undefined, rows = PANEL_ROWS) {
  if (count <= rows) return { start: 0, end: count }
  const visible = rows - 1 // one row says "… +N agent"
  const start = selected === undefined ? 0 : Math.max(0, Math.min(selected - Math.floor(visible / 2), count - visible))
  return { start, end: start + visible }
}

const GLYPH: Record<string, { glyph: string; fg: string }> = {
  queued: { glyph: "◌", fg: color.tx3 },
  completed: { glyph: "✓", fg: color.tang },
  failed: { glyph: "✘", fg: color.giam },
  stopped: { glyph: "■", fg: color.tx3 },
}

function AgentRow(props: { agent: SubagentView; selected: boolean; typeWidth: number; width: number; t: number }) {
  const a = () => props.agent
  const frame = useSpinner(() => a().status === "running")
  const glyph = () => (a().status === "running" ? { glyph: frame(), fg: color.tham } : (GLYPH[a().status] ?? GLYPH.stopped!))
  /** What it is doing now: the call running, else the last one (as the transcript row did). */
  const doing = () => {
    if (a().status !== "running") return undefined
    return (a().tools.findLast((x) => x.status === "running") ?? a().tools.at(-1))?.label
  }
  const right = (): { text: string; fg: string } => {
    const v = a()
    if (v.status === "queued") return { text: `chờ slot (${state.agentSlots.running}/${state.agentSlots.max})`, fg: color.tx3 }
    if (v.retry) return { text: `△ thử lại sau ${Math.max(0, Math.ceil((v.retry.until - props.t) / 1000))}s (lần ${v.retry.attempt}/${v.retry.max})`, fg: color.tham }
    const elapsed = fmtElapsed((v.endedAt ?? props.t) - (v.startedAt ?? v.createdAt))
    const tokens = v.usage.output > 0 ? ` · ↓ ${fmtTokens(v.usage.output)} token` : ""
    if (v.status === "running") return { text: `${elapsed}${tokens}`, fg: color.tx3 }
    if (v.status === "failed") return { text: `lỗi · ${elapsed}`, fg: color.giam }
    if (v.status === "stopped") return { text: `đã dừng · ${elapsed}`, fg: color.tx3 }
    return { text: `xong · ${elapsed}${tokens}`, fg: color.tx3 }
  }
  const room = () => Math.max(8, props.width - 2 - props.typeWidth - 2 - cells(right().text) - 2)
  const label = () => {
    const d = doing()
    return truncate(d ? `${a().description} · ${d}` : a().description, room())
  }
  return (
    <box flexDirection="row" height={1} flexShrink={0} backgroundColor={props.selected ? color.rule : undefined}>
      <text fg={glyph().fg} width={2} flexShrink={0} selectable={false}>
        {props.selected ? "❯" : glyph().glyph}
      </text>
      <text wrapMode="none" flexGrow={1} flexShrink={1} selectable={false}>
        <span style={{ fg: props.selected ? color.tx : color.tx2, bold: props.selected }}>{pad(truncate(a().type, props.typeWidth), props.typeWidth)}</span>
        <span style={{ fg: color.tx2 }}>{`  ${label()}`}</span>
      </text>
      <text fg={right().fg} flexShrink={0} wrapMode="none" selectable={false}>
        {`  ${right().text}`}
      </text>
    </box>
  )
}

export function AgentPanel() {
  const dims = useTerminalDimensions()
  // Elapsed times and lingering rows move once a second; rows that animate use the spinner clock.
  const t = useNow(1000)
  const agents = createMemo(() => panelAgents(t()))
  const main = useSpinner(() => state.streaming)
  const range = createMemo(() => panelWindow(agents().length, state.panelFocus, panelRowsFor(dims().height)))
  const typeWidth = () => Math.min(14, Math.max(4, ...agents().map((a) => cells(a.type))))
  const width = () => Math.max(30, dims().width - 7)

  return (
    <Show when={agents().length > 0}>
      <box flexDirection="column" flexShrink={0} paddingLeft={3} paddingRight={2} backgroundColor={color.bg}>
        <text wrapMode="none" selectable={false}>
          <span style={{ fg: state.streaming ? color.tham : color.tx3 }}>{`${state.streaming ? main() : "●"} `}</span>
          <span style={{ fg: color.tx, bold: true }}>main</span>
        </text>
        <For each={agents().slice(range().start, range().end)}>
          {(agent, i) => <AgentRow agent={agent} selected={state.panelFocus === range().start + i()} typeWidth={typeWidth()} width={width()} t={t()} />}
        </For>
        <Show when={agents().length > range().end - range().start}>
          <text fg={color.tx3} wrapMode="none" selectable={false}>
            {`  … +${agents().length - (range().end - range().start)} agent`}
          </text>
        </Show>
      </box>
    </Show>
  )
}
