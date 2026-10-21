import { createMemo, For, Show } from "solid-js"
import { PLAYBOOKS } from "../core/desk/playbooks"
import type { DeskAgentView, DeskRunView } from "../core/desk/types"
import { fmtTokens, groupDigits } from "../core/subagents/result"
import type { SubagentView } from "../core/subagents/types"
import { fmtElapsed } from "./activity"
import { state } from "./state"
import { color } from "./theme"
import { useNow, useSpinner } from "./ui/clock"
import { pad, truncate, width as cells } from "./ui/text"

/**
 * A desk run, live, in the transcript under its desk_run row (the user picked "card sống
 * trong chat + /desk", 22/10; Claude Code's workflow progress):
 *
 *   ╭─ ◆ ultradesk · sang-loc · dk-7f3a ──────────── ⠹ đang chạy · 1m12s ─╮
 *   │ medium · effort high · 8 mã: FPT, MWG, VNM, HPG … (+4)              │
 *   │ ━━━━━━━━━━━━━━━━━━━━╺──────────  14/22 agent · 64%                  │
 *   │ ✓ Thu thập     ━━━━━━━━━━  8/8   52s                                │
 *   │ ⠹ Xếp hạng     ━━━━━╺────  3/6                                      │
 *   │ ⠹ phan-tich  MWG · vn_financials(MWG)          23s · ↓1,2k          │
 *   │ ✓ tra-cuu VNM xong · 4 req · 12s                                    │
 *   ╰─ 48 request · ↑182k ↓21k token · /desk chi tiết · p tạm dừng · x×2 dừng ╯
 *
 * Finished, it folds to one line; ctrl+o opens the final card. /desk shows the same card
 * with every agent listed.
 */

const DONE: DeskAgentView["status"][] = ["done", "cached", "failed", "skipped"]

/** The run a desk_run result started ("Đã bắt đầu run ultradesk dk-…"). */
export function deskRunIdOf(output: string | undefined): string | undefined {
  return /\bdk-[A-Za-z0-9]+/.exec(output ?? "")?.[0]
}

export const isLiveRun = (run: Pick<DeskRunView, "status">) => run.status === "running" || run.status === "paused"

/** Agents the playbook expects at this size (its estimate), never fewer than already started. */
export function plannedAgents(run: DeskRunView): number {
  const started = run.phases.reduce((n, p) => n + p.total, 0)
  const meta = PLAYBOOKS.find((p) => p.meta.name === run.playbook)?.meta
  let estimate = 0
  try {
    estimate = meta ? meta.estimate(run.args as never, run.size).agents : 0
  } catch {
    // args from an older version: count what started
  }
  return Math.max(started, run.status === "running" || run.status === "paused" ? estimate : started, 1)
}

/** Agents that have finished one way or another. */
export const finishedAgents = (run: DeskRunView) => run.agents.filter((a) => DONE.includes(a.status)).length

/** One line about the arguments, from the playbook (as on the approval card). */
export function argsLine(run: DeskRunView): string {
  const meta = PLAYBOOKS.find((p) => p.meta.name === run.playbook)?.meta
  try {
    return meta?.summarize?.(run.args as never) ?? ""
  } catch {
    return ""
  }
}

/** ━━━━╺──── : `cells` wide, filled for done/total. */
export function barParts(done: number, total: number, cells: number): { full: string; head: string; rest: string } {
  const ratio = total > 0 ? Math.min(1, done / total) : 0
  const exact = ratio * cells
  const whole = Math.floor(exact)
  const head = whole < cells && exact - whole >= 0.5 ? "╺" : ""
  return { full: "━".repeat(whole), head, rest: "─".repeat(Math.max(0, cells - whole - head.length)) }
}

function Bar(props: { done: number; total: number; cells: number; fg: string }) {
  const parts = () => barParts(props.done, props.total, props.cells)
  return (
    <>
      <span style={{ fg: props.fg }}>{parts().full}</span>
      <span style={{ fg: props.fg }}>{parts().head}</span>
      <span style={{ fg: color.rule }}>{parts().rest}</span>
    </>
  )
}

/** The subagent behind a desk agent, once it started (live tools, tokens, times). */
const liveOf = (a: DeskAgentView): SubagentView | undefined => (a.agentId ? state.agents[a.agentId] : undefined)

/** Start of the first agent to the end of the last one in a phase (now while one runs). */
function phaseSpan(run: DeskRunView, title: string, t: number): number | undefined {
  const lives = run.agents.filter((a) => a.phase === title).map(liveOf).filter((v): v is SubagentView => Boolean(v?.startedAt))
  if (lives.length === 0) return undefined
  const start = Math.min(...lives.map((v) => v.startedAt!))
  const running = lives.some((v) => v.status === "running")
  const end = running ? t : Math.max(...lives.map((v) => v.endedAt ?? t))
  return end - start
}

export const STATUS_TEXT: Record<DeskRunView["status"], string> = {
  running: "đang chạy",
  paused: "tạm dừng",
  done: "xong",
  partial: "xong một phần",
  failed: "lỗi",
  stopped: "đã dừng",
}

const statusColor = (run: DeskRunView) =>
  run.status === "done" ? color.tang : run.status === "failed" ? color.giam : run.status === "running" ? color.tham : color.tx2

/** "◆ ultradesk sang-loc · xong · 22 agent · 48 request · 182k token · 1m40s". */
export function runSummary(run: DeskRunView): string {
  const c = run.counters
  const span = fmtElapsed((run.endedAt ?? Date.now()) - run.createdAt)
  const cut = run.cut && run.cut !== "stop" ? ` (${run.cut})` : ""
  return `ultradesk ${run.playbook} · ${STATUS_TEXT[run.status]}${cut} · ${c.agents} agent · ${groupDigits(c.requests)} request · ${fmtTokens(c.input + c.output)} token · ${span}`
}

function AgentLine(props: { agent: DeskAgentView; width: number; t: number; typeWidth: number }) {
  const live = () => liveOf(props.agent)
  const running = () => props.agent.status === "running"
  const frame = useSpinner(running)
  const glyph = () =>
    running()
      ? { g: frame(), fg: color.tham }
      : props.agent.status === "queued"
        ? { g: "◌", fg: color.tx3 }
        : props.agent.status === "failed"
          ? { g: "✘", fg: color.giam }
          : props.agent.status === "cached"
            ? { g: "↺", fg: color.san }
            : props.agent.status === "skipped"
              ? { g: "○", fg: color.tx3 }
              : { g: "✓", fg: color.tang }
  const doing = () => {
    const v = live()
    if (!v || !running()) return undefined
    return (v.tools.findLast((x) => x.status === "running") ?? v.tools.at(-1))?.label
  }
  const right = (): { text: string; fg: string } => {
    const a = props.agent
    const v = live()
    if (a.status === "queued") return { text: `chờ slot ${state.agentSlots.running}/${state.agentSlots.max}`, fg: color.tx3 }
    if (v?.retry) return { text: `△ thử lại sau ${Math.max(0, Math.ceil((v.retry.until - props.t) / 1000))}s`, fg: color.tham }
    const span = v?.startedAt ? fmtElapsed((v.endedAt ?? props.t) - v.startedAt) : ""
    const out = (v?.usage.output ?? a.tokens.output) > 0 ? `↓${fmtTokens(v?.usage.output ?? a.tokens.output)}` : ""
    const req = a.requests > 0 ? `${a.requests} req` : ""
    if (a.status === "failed") return { text: ["lỗi", truncate(a.error ?? "", 30), span].filter(Boolean).join(" · "), fg: color.giam }
    if (a.status === "cached") return { text: "từ journal", fg: color.tx3 }
    return { text: [running() ? "" : req, span, out].filter(Boolean).join(" · "), fg: color.tx3 }
  }
  const room = () => Math.max(8, props.width - 2 - props.typeWidth - 2 - cells(right().text) - 2)
  const label = () => truncate(doing() ? `${props.agent.label} · ${doing()}` : props.agent.label, room())
  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      <text fg={glyph().fg} width={2} flexShrink={0} selectable={false}>
        {glyph().g}
      </text>
      <text wrapMode="none" flexGrow={1} flexShrink={1}>
        <span style={{ fg: running() ? color.tx : color.tx2, bold: running() }}>{pad(truncate(props.agent.type, props.typeWidth), props.typeWidth)}</span>
        <span style={{ fg: running() ? color.tx2 : color.tx3 }}>{`  ${label()}`}</span>
      </text>
      <text fg={right().fg} flexShrink={0} wrapMode="none" selectable={false}>
        {`  ${right().text}`}
      </text>
    </box>
  )
}

/**
 * The card. `rows`: agent rows at most (running first, then queued, then the latest
 * finished); `all` lists every agent instead (the /desk view does its own list).
 */
export function DeskCard(props: { run: DeskRunView; width: number; rows?: number; footer?: string }) {
  const live = () => isLiveRun(props.run)
  const t = useNow(1000, live)
  const spin = useSpinner(() => props.run.status === "running")
  const inner = () => Math.max(30, props.width - 4)
  const planned = createMemo(() => plannedAgents(props.run))
  const finished = createMemo(() => finishedAgents(props.run))
  const pct = () => Math.round((finished() / planned()) * 100)
  const elapsed = () => fmtElapsed((props.run.endedAt ?? t()) - props.run.createdAt)
  const shown = createMemo(() => {
    const a = props.run.agents
    const running = a.filter((x) => x.status === "running")
    const queued = a.filter((x) => x.status === "queued")
    // Latest finished first: by the subagent's end time, else the order they were added.
    const done = a
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => DONE.includes(x.status))
      .sort((p, q) => (liveOf(q.x)?.endedAt ?? q.i) - (liveOf(p.x)?.endedAt ?? p.i))
      .map(({ x }) => x)
    const max = props.rows ?? 5
    const active = [...running, ...queued]
    const pick = active.slice(0, max)
    // While running, at most two finished rows (what just happened); finished, the latest ones.
    const extra = Math.max(0, live() ? Math.min(2, max - pick.length) : max - pick.length)
    return { rows: [...pick, ...done.slice(0, extra)], hidden: active.length - pick.length }
  })
  const typeWidth = () => Math.min(12, Math.max(4, ...props.run.agents.map((a) => cells(a.type))))
  const phaseWidth = () => Math.min(16, Math.max(6, ...props.run.phases.map((p) => cells(p.title))))
  const barCells = () => Math.max(10, Math.min(36, inner() - 28))
  const head = () => `◆ ultradesk · ${props.run.playbook} · ${props.run.id}`
  const state_ = () => `${props.run.status === "running" ? spin() : props.run.status === "done" ? "✓" : props.run.status === "paused" ? "‖" : "△"} ${STATUS_TEXT[props.run.status]} · ${elapsed()}`
  const c = () => props.run.counters
  const meta = () => [props.run.size, props.run.effort ? `effort ${props.run.effort}` : "", argsLine(props.run)].filter(Boolean).join(" · ")
  const footer = () =>
    props.footer ??
    `${groupDigits(c().requests)} request · ↑${fmtTokens(c().input)} ↓${fmtTokens(c().output)} token${live() ? " · /desk chi tiết (p tạm dừng · x×2 dừng)" : " · /desk chi tiết"}`

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={live() ? color.tham : props.run.status === "done" ? color.tang : color.rule}
      paddingLeft={1}
      paddingRight={1}
      marginLeft={2}
      width={Math.min(props.width - 2, 110)}
    >
      <box flexDirection="row" height={1} flexShrink={0}>
        <text wrapMode="none" flexGrow={1} flexShrink={1}>
          <span style={{ fg: color.tran, bold: true }}>{truncate(head(), inner() - cells(state_()) - 2)}</span>
        </text>
        <text fg={statusColor(props.run)} flexShrink={0} wrapMode="none">
          {`  ${state_()}`}
        </text>
      </box>
      <Show when={meta()}>
        <text fg={color.tx3} wrapMode="none">
          {truncate(meta(), inner())}
        </text>
      </Show>
      <box flexDirection="row" height={1} flexShrink={0} marginTop={1}>
        <text wrapMode="none" flexShrink={0}>
          <Bar done={finished()} total={planned()} cells={barCells()} fg={props.run.status === "failed" ? color.giam : color.tang} />
        </text>
        <text fg={color.tx2} wrapMode="none" flexShrink={0}>
          {`  ${finished()}/${planned()} agent · ${pct()}%`}
        </text>
      </box>
      <For each={props.run.phases}>
        {(p) => {
          const active = () => p.total > 0 && p.done + p.failed < p.total
          // Spins only while one of its agents runs; agents waiting for a slot show ◌.
          const working = () => props.run.status === "running" && props.run.agents.some((a) => a.phase === p.title && a.status === "running")
          const pspin = useSpinner(working)
          const glyph = () =>
            p.total === 0
              ? { g: "○", fg: color.tx3 }
              : active()
                ? { g: working() ? pspin() : "◌", fg: color.tham }
                : p.failed > 0
                  ? { g: "△", fg: color.tham }
                  : { g: "✓", fg: color.tang }
          const span = () => phaseSpan(props.run, p.title, t())
          return (
            <box flexDirection="row" height={1} flexShrink={0}>
              <text fg={glyph().fg} width={2} flexShrink={0}>
                {glyph().g}
              </text>
              <text wrapMode="none" flexShrink={0}>
                <span style={{ fg: active() ? color.tx : p.total === 0 ? color.tx3 : color.tx2, bold: active() }}>{pad(truncate(p.title, phaseWidth()), phaseWidth())}</span>
                <span>{"  "}</span>
                <Bar done={p.done + p.failed} total={Math.max(p.total, 1)} cells={10} fg={p.failed > 0 ? color.tham : color.tang} />
              </text>
              <text fg={color.tx3} wrapMode="none" flexShrink={0}>
                {`  ${p.done}/${p.total}${p.failed ? ` · ${p.failed} lỗi` : ""}${span() !== undefined && !active() ? ` · ${fmtElapsed(span()!)}` : ""}`}
              </text>
            </box>
          )
        }}
      </For>
      <Show when={shown().rows.length > 0}>
        <box flexDirection="column" flexShrink={0} marginTop={1}>
          <For each={shown().rows}>{(a) => <AgentLine agent={a} width={inner()} t={t()} typeWidth={typeWidth()} />}</For>
          <Show when={shown().hidden > 0}>
            <text fg={color.tx3} wrapMode="none">{`  … +${shown().hidden} agent đang chạy/chờ`}</text>
          </Show>
        </box>
      </Show>
      <Show when={props.run.logs.length > 0}>
        <text fg={color.tx3} wrapMode="none">
          {truncate(`» ${props.run.logs.at(-1)}`, inner())}
        </text>
      </Show>
      <Show when={props.run.error}>
        <text fg={color.giam} wrapMode="word">{`Lỗi: ${props.run.error}`}</text>
      </Show>
      <text fg={color.tx3} wrapMode="none" marginTop={1}>
        {truncate(footer(), inner())}
      </text>
    </box>
  )
}
