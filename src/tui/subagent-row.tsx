import { createMemo, For, Show } from "solid-js"
import { fmtSeconds, fmtTokens, parseTrailer, stripTrailer } from "../core/subagents/result"
import type { AgentStatus, ChildToolView } from "../core/subagents/types"
import { SPAWN_SUBAGENT } from "../core/tools/subagent/spawn"
import { state, type Line } from "./state"
import { color } from "./theme"
import { truncate } from "./ui/text"
import { useSpinner } from "./ui/clock"

/**
 * Subagents in the transcript, after Claude Code's AgentTool UI: the spawn_subagent calls
 * of one model step form one block.
 *
 *   ● Chạy 3 subagent…
 *     ├─ nghien-cuu (Định giá FPT) · 4 tool · 12,3k token
 *     │  ⎿ mcp__opentrading__valuation_run(FPT)
 *     └─ nghien-cuu (Định giá ELC) · đang chờ slot (10/10)
 *
 * That is the ctrl+o view. Collapsed, a block is one line ("● Chạy 3 subagent… · ↓ để quản lý",
 * "● nghien-cuu (Định giá FPT) · xong · 4 tool · 12k token · 53s"), plus failures and notices:
 * what each agent does right now is on the panel under the prompt (agent-panel.tsx).
 */

type ToolLine = Extract<Line, { kind: "tool" }>

export const isSpawn = (line: Line | undefined): line is ToolLine => line?.kind === "tool" && line.name === SPAWN_SUBAGENT

const sameGroup = (a: Line | undefined, b: Line | undefined) => isSpawn(a) && isSpawn(b) && a.step !== undefined && a.step === b.step

/** The spawn calls rendered together with the one at `index`. */
function groupAt(index: number): ToolLine[] {
  let start = index
  while (start > 0 && sameGroup(state.lines[start - 1], state.lines[start])) start--
  const group: ToolLine[] = []
  for (let i = start; i < state.lines.length; i++) {
    const line = state.lines[i]
    if (i > start && !sameGroup(state.lines[i - 1], line)) break
    if (isSpawn(line)) group.push(line)
  }
  return group
}

interface AgentInfo {
  type: string
  description: string
  status: AgentStatus
  toolCount?: number
  tokens?: number
  durationMs?: number
  error?: string
  notice?: string
  /** Label of the call it is making now. */
  current?: string
  waitingApproval: boolean
  prompt?: string
  tools: ChildToolView[]
  report?: string
  background?: boolean
}

const TRAILER_STATUS: Record<string, AgentStatus> = { xong: "completed", lỗi: "failed", "đã dừng": "stopped" }

/** What a row shows: the live view when this session started the agent, else the stored result. */
function infoFor(line: ToolLine): AgentInfo {
  const view = Object.values(state.agents).find((a) => a.parentCallId === line.callId)
  const report = line.status === "ok" && line.output ? stripTrailer(line.output) : undefined
  if (view) {
    const background = view.background
    return {
      type: view.type,
      description: view.description,
      status: view.status,
      toolCount: view.toolCount,
      tokens: view.usage.input + view.usage.output,
      durationMs: view.endedAt !== undefined ? view.endedAt - (view.startedAt ?? view.createdAt) : undefined,
      error: view.error ?? (line.status === "error" ? line.output : undefined),
      notice: view.notice,
      // The tool running now, else the last one (Claude Code and opencode keep it between calls).
      current: (view.tools.findLast((t) => t.status === "running") ?? view.tools.at(-1))?.label,
      waitingApproval: state.approvals.some((r) => r.agent?.id === view.id),
      prompt: view.prompt,
      tools: view.tools,
      // A background call's own output is only "started"; the report is the agent's text.
      report: background ? view.text || undefined : report,
      background,
    }
  }
  // Resumed session (or a call that never started): label "type(description)" plus the trailer.
  const named = /^([a-z0-9-]+)\((.*)\)$/s.exec(line.label)
  const trailer = parseTrailer(line.output)
  const status: AgentStatus =
    line.status === "running" ? "running" : line.status === "error" ? "failed" : (TRAILER_STATUS[trailer?.status ?? ""] ?? "completed")
  return {
    type: trailer?.type ?? named?.[1] ?? "subagent",
    description: named?.[2] ?? line.label,
    status,
    toolCount: trailer?.tools,
    tokens: trailer?.tokens,
    durationMs: trailer ? trailer.seconds * 1000 : line.durationMs,
    error: line.status === "error" ? line.output : undefined,
    waitingApproval: false,
    tools: [],
    report,
  }
}

const active = (s: AgentStatus) => s === "queued" || s === "running"

function stats(info: AgentInfo) {
  const bg = info.background ? " · chạy nền" : ""
  if (info.status === "queued") return `${bg} · đang chờ slot (${state.agentSlots.running}/${state.agentSlots.max})`
  if (info.status !== "running") return bg
  return `${bg} · ${info.toolCount ?? 0} tool · ${fmtTokens(info.tokens ?? 0)} token`
}

/** The line under an agent: what it is doing, or how it ended. */
function statusLine(info: AgentInfo): { text: string; fg: string } | undefined {
  switch (info.status) {
    case "queued":
      return undefined
    case "running":
      if (info.waitingApproval) return { text: "Đang chờ bạn xác nhận…", fg: color.tham }
      if (info.current) return { text: info.current, fg: color.tx3 }
      // "Starting" only before anything happened; after a model step it is thinking.
      return { text: (info.tokens ?? 0) > 0 ? "Đang suy nghĩ…" : "Đang khởi động…", fg: color.tx3 }
    case "completed": {
      const parts = [
        info.toolCount !== undefined ? `${info.toolCount} tool` : undefined,
        info.tokens !== undefined ? `${fmtTokens(info.tokens)} token` : undefined,
        info.durationMs !== undefined ? fmtSeconds(info.durationMs) : undefined,
      ].filter(Boolean)
      return { text: parts.length > 0 ? `Xong (${parts.join(" · ")})` : "Xong", fg: color.tx3 }
    }
    case "failed":
      return { text: `Lỗi: ${info.error ?? "không rõ"}`, fg: color.giam }
    case "stopped":
      return { text: "Đã dừng", fg: color.tx3 }
  }
}

/** A fixed, unselectable prefix and one line of text. */
function Prefixed(props: { prefix: string; text: string; fg: string; bold?: boolean }) {
  return (
    <box flexDirection="row" height={1}>
      <text fg={color.tx3} width={props.prefix.length} flexShrink={0} selectable={false}>
        {props.prefix}
      </text>
      <text fg={props.fg} wrapMode="none">
        {props.bold ? <span style={{ bold: true }}>{props.text}</span> : props.text}
      </text>
    </box>
  )
}

/** ctrl+o: the brief, the child's calls, its report. */
function Details(props: { info: AgentInfo; prefix: string; width: number }) {
  const room = () => Math.max(10, props.width - props.prefix.length)
  const lines = (text: string) => text.replace(/\r\n/g, "\n").trimEnd().split("\n")
  return (
    <>
      <Show when={props.info.notice}>
        <Prefixed prefix={props.prefix} text={truncate(`△ ${props.info.notice}`, room())} fg={color.tham} />
      </Show>
      <Show when={props.info.prompt}>
        <Prefixed prefix={props.prefix} text="Yêu cầu:" fg={color.tx2} bold />
        <For each={lines(props.info.prompt!)}>{(row) => <Prefixed prefix={props.prefix} text={truncate(row, room(), true)} fg={color.tx3} />}</For>
      </Show>
      <For each={props.info.tools}>
        {(call) => (
          <>
            <Prefixed
              prefix={props.prefix}
              text={truncate(`${call.status === "error" ? "✘" : "●"} ${call.label}${call.durationMs !== undefined ? ` · ${(call.durationMs / 1000).toFixed(1)}s` : ""}`, room())}
              fg={call.status === "error" ? color.giam : color.tx2}
            />
            <Show when={call.decision}>
              <Prefixed prefix={props.prefix} text={`  ${call.decision}`} fg={color.tx3} />
            </Show>
          </>
        )}
      </For>
      <Show when={props.info.report}>
        <Prefixed prefix={props.prefix} text="Kết quả:" fg={color.tx2} bold />
        <For each={lines(props.info.report!)}>{(row) => <Prefixed prefix={props.prefix} text={truncate(row, room(), true)} fg={color.tx3} />}</For>
      </Show>
    </>
  )
}

/** "xong · 4 tool · 12k token · 53s": how one agent ended, for a collapsed header. */
function ended(info: AgentInfo): string {
  const word = info.status === "failed" ? "lỗi" : info.status === "stopped" ? "đã dừng" : "xong"
  const parts = [
    word,
    info.toolCount !== undefined ? `${info.toolCount} tool` : undefined,
    info.tokens !== undefined ? `${fmtTokens(info.tokens)} token` : undefined,
    info.durationMs !== undefined ? fmtSeconds(info.durationMs) : undefined,
  ].filter(Boolean)
  return ` · ${parts.join(" · ")}`
}

export function SubagentRow(props: { line: ToolLine; index: number; width: number }) {
  const group = createMemo(() => groupAt(props.index))
  const first = () => group()[0]?.callId === props.line.callId
  const last = () => group().at(-1)?.callId === props.line.callId
  const single = () => group().length <= 1
  const info = createMemo(() => infoFor(props.line))
  const infos = createMemo(() => (first() ? group().map(infoFor) : []))
  const running = () => (single() ? active(info().status) : infos().some((i) => active(i.status)))
  const frame = useSpinner(running)
  /** ctrl+o: the full tree. Otherwise one line: the live view is the panel under the prompt. */
  const expanded = () => state.expandTools

  const headerGlyph = () => (running() ? frame() : "●")
  const headerColor = () => {
    const all = single() ? [info()] : infos()
    if (all.some((i) => i.waitingApproval)) return color.tham
    if (all.some((i) => active(i.status))) return color.tham
    return all.some((i) => i.status === "failed") ? color.giam : color.tang
  }
  const headerText = () => {
    if (single()) return `${info().type} (${info().description})`
    const n = group().length
    const failed = infos().filter((i) => i.status === "failed").length
    return running() ? `Chạy ${n} subagent…` : `${n} subagent đã xong${failed > 0 ? ` · ${failed} lỗi` : ""}`
  }
  const headerStats = () => {
    if (expanded()) return single() ? stats(info()) : ""
    const bg = (single() ? info().background : infos().some((i) => i.background)) ? " · chạy nền" : ""
    if (running()) return `${bg} · ↓ để quản lý`
    return single() ? `${bg}${ended(info())}` : bg
  }

  const branch = () => (last() ? "  └─ " : "  ├─ ")
  const under = () => (single() ? "  ⎿  " : last() ? "     ⎿ " : "  │  ⎿ ")
  const detailPrefix = () => (single() ? "     " : last() ? "       " : "  │    ")
  const status = () => statusLine(info())
  /** Collapsed, only a failure says more than the header. */
  const failure = () => (info().status === "failed" ? `${single() ? "" : `${info().type} (${info().description}): `}Lỗi: ${info().error ?? "không rõ"}` : undefined)

  return (
    <box flexDirection="column" marginTop={first() ? 1 : 0} flexShrink={0}>
      <Show when={first()}>
        <box flexDirection="row" height={1}>
          <text fg={headerColor()} width={2} flexShrink={0} selectable={false}>
            {headerGlyph()}
          </text>
          <text wrapMode="none">
            <span style={{ fg: color.tx, bold: true }}>{truncate(headerText(), props.width - 30)}</span>
            <span style={{ fg: color.tx3 }}>{headerStats()}</span>
          </text>
        </box>
      </Show>
      <Show
        when={expanded()}
        fallback={
          <>
            <Show when={failure()}>{(text) => <Prefixed prefix="  ⎿  " text={truncate(text(), props.width - 5)} fg={color.giam} />}</Show>
            <Show when={info().notice}>
              <Prefixed prefix="     " text={truncate(`△ ${info().notice}`, props.width - 5)} fg={color.tham} />
            </Show>
          </>
        }
      >
        <Show when={!single()}>
          <box flexDirection="row" height={1}>
            <text fg={color.tx3} width={5} flexShrink={0} selectable={false}>
              {branch()}
            </text>
            <text wrapMode="none">
              <span style={{ fg: color.tx }}>{truncate(`${info().type} (${info().description})`, props.width - 40)}</span>
              <span style={{ fg: color.tx3 }}>{stats(info())}</span>
            </text>
          </box>
        </Show>
        <Show when={status()}>
          {(s) => <Prefixed prefix={under()} text={truncate(s().text, props.width - under().length)} fg={s().fg} />}
        </Show>
        <Details info={info()} prefix={detailPrefix()} width={props.width} />
      </Show>
    </box>
  )
}
