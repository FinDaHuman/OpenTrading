import { useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { MODE_LABEL } from "../core/permission/mode"
import { noticeText, type NoticeLevel } from "./notify"
import { state } from "./state"
import { color } from "./theme"
import { width as cells } from "./ui/text"

/**
 * The line under the prompt, after Claude Code's prompt footer: the permission mode
 * (with "(shift+tab đổi)" while there is room), what runs in the background, a key hint on
 * the left; notifications and exit prompts on the right. A notice too long for what is left
 * gets its own wrapped row under the line: a message cut off is worse than none.
 *
 *   ▸ sửa có hỏi (shift+tab đổi) · esc dừng                         ✓ Đã copy 42 ký tự
 */

export const NOTICE_COLOR: Record<NoticeLevel, string> = { info: color.tx2, success: color.tang, warning: color.tham, error: color.giam }

export const MODE_COLOR = { "read-only": color.tx3, ask: color.tham, auto: color.tang } as const

// Desk agents count as their run, not one by one.
const running = () => Object.values(state.agents).filter((a) => !a.deskRunId && (a.status === "running" || a.status === "queued"))
const deskLive = () => Object.values(state.deskRuns).filter((r) => r.status === "running" || r.status === "paused")

const time = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })

export function ModeLine(props: { hint?: string }) {
  const dims = useTerminalDimensions()
  const mode = () => {
    if (state.autoOptIn) return `${MODE_LABEL.auto} (chờ xác nhận)`
    const paused = state.permissionMode === "auto" && state.autoPausedUntil ? ` · tạm hỏi tay tới ${time(state.autoPausedUntil)}` : ""
    return `${MODE_LABEL[state.permissionMode]}${paused}`
  }
  const modeColor = () => (state.autoOptIn ? color.tham : MODE_COLOR[state.permissionMode])
  /** Subagents at work (Claude Code's tasks pill): "2 subagent · 1 nền · ↓ quản lý". */
  const pills = () => {
    const list = running()
    const runs = deskLive()
    const out: string[] = []
    if (state.deskMode) out.push("desk ●")
    if (runs.length > 0) out.push(runs.length === 1 ? `desk ${runs[0]!.playbook} ${runs[0]!.counters.agents} agent` : `${runs.length} run desk`)
    if (list.length > 0) {
      const bg = list.filter((a) => a.background).length
      out.push(`${list.length} subagent${bg > 0 ? ` · ${bg} nền` : ""}`)
    }
    if ((list.length > 0 || runs.length > 0) && state.panelFocus === undefined) out[out.length - 1] += " · ↓ quản lý"
    return out
  }
  /** Claude Code drops the cycle hint once the line has more than the mode on it. */
  const cycleHint = () => (pills().length === 0 && !state.autoOptIn ? " (shift+tab đổi)" : "")
  const left = () => [...pills(), ...(props.hint ? [props.hint] : [])].map((p) => ` · ${p}`).join("")

  const right = (): { text: string; fg: string } | undefined => {
    if (state.exiting) return { text: "Đang thoát…", fg: color.tham }
    if (state.exitArmed) return { text: `Nhấn ${state.exitArmed} lần nữa để thoát`, fg: color.tham }
    const n = state.notification
    return n ? { text: noticeText(n), fg: NOTICE_COLOR[n.level] } : undefined
  }
  /** Columns left of the line (3 + 2 of padding, 2 between the sides). */
  const free = () => dims().width - 7 - cells(mode() + cycleHint() + left())
  const own = () => {
    const r = right()
    return r !== undefined && cells(r.text) > free()
  }

  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={color.bg}>
      <box flexDirection="row" height={1} paddingLeft={3} paddingRight={2}>
        <text wrapMode="none" flexShrink={1} selectable={false}>
          <span style={{ fg: modeColor() }}>{mode()}</span>
          <span style={{ fg: color.tx3 }}>{cycleHint()}</span>
          <span style={{ fg: color.san }}>{pills().length > 0 ? ` · ${pills().join(" · ")}` : ""}</span>
          <span style={{ fg: color.tx3 }}>{props.hint ? ` · ${props.hint}` : ""}</span>
        </text>
        <box flexGrow={1} />
        <Show when={!own() && right()}>
          {(r) => (
            <text fg={r().fg} flexShrink={0} wrapMode="none" selectable={false}>
              {r().text}
            </text>
          )}
        </Show>
      </box>
      <Show when={own() && right()}>
        {(r) => (
          <box paddingLeft={3} paddingRight={2} flexShrink={0}>
            <text fg={r().fg} wrapMode="word" selectable={false}>
              {r().text}
            </text>
          </box>
        )}
      </Show>
    </box>
  )
}
