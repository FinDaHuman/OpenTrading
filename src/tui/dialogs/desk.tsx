import type { KeyEvent } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { listDeskRuns, type DeskMeta } from "../../core/desk/journal"
import type { DeskAgentView, DeskRunStatus, DeskRunView } from "../../core/desk/types"
import type { Runtime } from "../../core/runtime"
import { fmtSeconds, fmtTokens, groupDigits } from "../../core/subagents/result"
import { flash, say } from "../notify"
import { currentSession } from "../session"
import { closeDialog, setState, state } from "../state"
import { color } from "../theme"
import { useKeys } from "../ui/keys"
import { truncate } from "../ui/text"
import { DeskCard } from "../desk-card"
import { fmtElapsed } from "../activity"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

/**
 * /desk (the user picked "cây phase → agent", 21/10; Claude Code's /workflows): runs of this
 * session → a run's phases with counts → a phase's agents → one agent. p pauses or resumes,
 * x twice (or ctrl+x) stops, r runs a cut or stopped run again from its journal.
 */

export const DESK_STATUS: Record<DeskRunStatus, string> = {
  running: "đang chạy",
  paused: "tạm dừng",
  done: "xong",
  partial: "xong một phần",
  failed: "lỗi",
  stopped: "đã dừng",
}

const AGENT_GLYPH: Record<DeskAgentView["status"], string> = { queued: "◌", running: "✻", done: "✓", cached: "↺", failed: "✘", skipped: "○" }
const AGENT_COLOR: Record<DeskAgentView["status"], string> = {
  queued: color.tx3,
  running: color.tham,
  done: color.tang,
  cached: color.san,
  failed: color.giam,
  skipped: color.tx3,
}
const AGENT_STATUS: Record<DeskAgentView["status"], string> = { queued: "chờ", running: "đang chạy", done: "xong", cached: "từ journal", failed: "lỗi", skipped: "bỏ qua" }

/** Every agent of a run, grouped by phase in the playbook's order: what it is doing, how long, how much. */
function agentItems(run: DeskRunView) {
  const order = run.phases.map((p) => p.title)
  const rank = (a: DeskAgentView) => (order.includes(a.phase) ? order.indexOf(a.phase) : order.length)
  return [...run.agents]
    .sort((a, b) => rank(a) - rank(b))
    .map((a) => {
      const live = a.agentId ? state.agents[a.agentId] : undefined
      const doing = a.status === "running" ? (live?.tools.findLast((t) => t.status === "running") ?? live?.tools.at(-1))?.label : undefined
      const span = live?.startedAt ? fmtElapsed((live.endedAt ?? Date.now()) - live.startedAt) : ""
      const out = live?.usage.output ?? a.tokens.output
      const hint = [doing ?? AGENT_STATUS[a.status], a.requests > 0 ? `${a.requests} req` : "", span, out > 0 ? `↓${fmtTokens(out)}` : "", a.error ? truncate(a.error, 40) : ""]
        .filter(Boolean)
        .join(" · ")
      return { label: `${a.type} · ${truncate(a.label, 40)}`, group: a.phase, hint, mark: AGENT_GLYPH[a.status], markColor: AGENT_COLOR[a.status], value: a.key }
    })
}
const STOP_WINDOW_MS = 2000

export const isLive = (run: Pick<DeskRunView, "status">) => run.status === "running" || run.status === "paused"

/** "6 agent · 21 request · 48k token · 1m12s". */
export function runStats(run: DeskRunView) {
  const c = run.counters
  const cached = c.cached > 0 ? ` (+${c.cached} từ journal)` : ""
  return `${c.agents} agent${cached} · ${groupDigits(c.requests)} request · ${fmtTokens(c.input + c.output)} token · ${fmtSeconds((run.endedAt ?? Date.now()) - run.createdAt)}`
}

function phaseGlyph(p: DeskRunView["phases"][number], live: boolean) {
  if (p.total === 0) return "○"
  if (p.done + p.failed < p.total) return live ? "✻" : "○"
  return p.failed > 0 ? "△" : "✓"
}

/** A run of an earlier sitting of this session (only on disk): enough to resume it. */
function fromMeta(m: DeskMeta): DeskRunView {
  return {
    id: m.id,
    playbook: m.playbook,
    version: m.version,
    args: m.args,
    size: m.size,
    effort: m.effort,
    status: m.status === "running" || m.status === "paused" ? "stopped" : m.status,
    cut: m.cut,
    phases: [],
    agents: [],
    logs: [],
    createdAt: Date.parse(m.createdAt) || 0,
    endedAt: Date.parse(m.updatedAt) || undefined,
    counters: m.counters,
    sessionId: m.sessionId,
  }
}

export function DeskDialog(props: { runtime: Runtime }) {
  const [stored] = createResource(() => listDeskRuns(currentSession().dir))
  const runs = createMemo(() => {
    const live = Object.values(state.deskRuns)
    const old = (stored() ?? []).filter((m) => !state.deskRuns[m.id]).map(fromMeta)
    return [...live, ...old].sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.createdAt - a.createdAt)
  })
  // Enter on a panel row opens that run; a single run opens directly.
  const [open, setOpen] = createSignal<string | undefined>(state.deskFocus ?? (Object.keys(state.deskRuns).length === 1 ? Object.keys(state.deskRuns)[0] : undefined))
  setState("deskFocus", undefined)
  const [agentKey, setAgentKey] = createSignal<string>()
  const [highlighted, setHighlighted] = createSignal<string>()
  let stopArmed: { id: string; at: number } | undefined

  const dims = useTerminalDimensions()
  const cardWidth = () => Math.max(40, dims().width - 4)
  const run = () => runs().find((r) => r.id === open())
  const agent = () => run()?.agents.find((a) => a.key === agentKey())

  async function resume(id: string) {
    try {
      await props.runtime.desk.resume(id)
      say(`Đang chạy tiếp run ${id}`, "success")
    } catch (error) {
      say(error instanceof Error ? error.message : String(error), "error")
    }
  }

  function stop(id: string, force: boolean) {
    const confirmed = force || (stopArmed?.id === id && Date.now() - stopArmed.at <= STOP_WINDOW_MS)
    if (!confirmed) {
      stopArmed = { id, at: Date.now() }
      return flash("Nhấn x lần nữa để dừng run", STOP_WINDOW_MS, "warning")
    }
    stopArmed = undefined
    if (props.runtime.desk.stop(id)) say(`Đã dừng run ${id}`, "success")
  }

  /** Run-level keys, wherever the view is; true when handled. */
  function runKey(evt: KeyEvent, id: string | undefined): boolean {
    const target = runs().find((r) => r.id === id)
    if (!target) return false
    if (evt.name === "p" && !evt.ctrl) {
      if (target.status === "paused") props.runtime.desk.unpause(target.id)
      else if (target.status === "running") props.runtime.desk.pause(target.id)
      return true
    }
    if (evt.name === "x") {
      if (isLive(target)) stop(target.id, evt.ctrl)
      return true
    }
    if (evt.name === "r" && !evt.ctrl && !isLive(target) && target.status !== "done") {
      void resume(target.id)
      return true
    }
    return false
  }

  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") {
      if (agentKey()) return setAgentKey(undefined)
      if (open() && runs().length > 1) return setOpen(undefined)
      closeDialog()
    }
  })

  const keysHint = (r: DeskRunView) =>
    [isLive(r) ? (r.status === "paused" ? "p chạy tiếp" : "p tạm dừng") : "", isLive(r) ? "x×2 dừng" : "", !isLive(r) && r.status !== "done" ? "r chạy tiếp" : "", "esc"]
      .filter(Boolean)
      .join(" · ")

  return (
    <Show
      when={run()}
      fallback={
        <DialogFrame title={`Ultradesk · ${runs().length} run`} hint="enter xem · p tạm dừng · x×2 dừng · r chạy tiếp · esc đóng">
          <Show when={runs().length > 0} fallback={<text fg={color.tx3}>Chưa có run ultradesk nào trong phiên này. Gõ ultradesk trong câu hỏi, hoặc /desk on.</text>}>
            <Picker
              items={runs().map((r) => ({
                label: `${r.playbook} · ${r.id}`,
                group: isLive(r) ? "Đang chạy" : "Đã xong",
                hint: `${DESK_STATUS[r.status]}${r.cut && r.cut !== "stop" ? ` (${r.cut})` : ""} · ${runStats(r)}`,
                mark: isLive(r) ? "◆" : r.status === "done" ? "●" : "△",
                value: r.id,
              }))}
              onPick={(id) => setOpen(id)}
              onHighlight={(id) => setHighlighted(id)}
              onKey={(evt, id) => runKey(evt, id ?? highlighted())}
              rows={10}
            />
          </Show>
        </DialogFrame>
      }
    >
      {(r) => (
        <Show
          when={agent()}
          fallback={
            <DialogFrame title={`Ultradesk · ${r().id}`} hint={`↑↓ chọn agent · enter xem · ${keysHint(r())}`}>
              <Show
                when={r().phases.length > 0}
                fallback={<text fg={color.tx3}>{`${r().playbook} · ${DESK_STATUS[r().status]} · ${runStats(r())}. Run của lần mở trước; r để chạy tiếp từ journal.`}</text>}
              >
                {/* The same live card as in the chat (bar, phases), then every agent by phase. */}
                <DeskCard run={r()} width={cardWidth()} rows={0} footer={`${runStats(r())}${r().logs.length > 1 ? ` · ${r().logs.length} dòng log` : ""}`} />
                <box marginTop={1} flexDirection="column" flexShrink={1} minHeight={0}>
                  <Show when={r().agents.length > 0} fallback={<text fg={color.tx3}>Chưa có agent nào bắt đầu.</text>}>
                    <Picker
                      items={agentItems(r())}
                      onPick={(key) => setAgentKey(key)}
                      onKey={(evt) => runKey(evt, r().id)}
                      rows={Math.max(4, dims().height - 23)}
                    />
                  </Show>
                </box>
              </Show>
            </DialogFrame>
          }
        >
          {(a) => {
            const live = () => (a().agentId ? state.agents[a().agentId!] : undefined)
            return (
              <DialogFrame
                title={`${a().type} · ${a().label}`}
                accent={AGENT_COLOR[a().status]}
                subtitle={`${a().phase} · ${AGENT_STATUS[a().status]} · ${a().requests} request · ${fmtTokens(a().tokens.input + a().tokens.output)} token${live()?.startedAt ? ` · ${fmtElapsed((live()!.endedAt ?? Date.now()) - live()!.startedAt!)}` : ""}${a().agentId ? ` · ${a().agentId}` : ""}`}
                hint="esc quay lại"
              >
                <Show when={a().error}>
                  <text fg={color.giam} wrapMode="word">{`Lỗi: ${a().error}`}</text>
                </Show>
                <Show when={live()}>
                  {(v) => (
                    <box flexDirection="column" flexShrink={0}>
                      <text fg={color.tham} marginTop={1}>
                        Yêu cầu:
                      </text>
                      <text fg={color.tx3} wrapMode="word">
                        {truncate(v().prompt, 600)}
                      </text>
                      <Show when={v().tools.length > 0}>
                        <text fg={color.tham} marginTop={1}>{`Tool (${v().toolCount}):`}</text>
                        <For each={v().tools.slice(-12)}>
                          {(t) => (
                            <text fg={t.status === "error" ? color.giam : color.tx3} wrapMode="none">
                              {truncate(`${t.status === "running" ? "…" : t.status === "error" ? "✘" : "●"} ${t.label}`, 100)}
                            </text>
                          )}
                        </For>
                      </Show>
                      <Show when={v().text}>
                        <text fg={color.tham} marginTop={1}>
                          Kết quả:
                        </text>
                        <text fg={color.tx3} wrapMode="word">
                          {truncate(v().text, 1200)}
                        </text>
                      </Show>
                    </box>
                  )}
                </Show>
              </DialogFrame>
            )
          }}
        </Show>
      )}
    </Show>
  )
}
