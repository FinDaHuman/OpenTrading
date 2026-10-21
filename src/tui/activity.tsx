import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { fmtTokens } from "../core/subagents/result"
import { pickTip } from "./tips"
import { shownTodos } from "./todo-panel"
import { state, type Activity } from "./state"
import { color, mix } from "./theme"
import { now, useNow } from "./ui/clock"
import { truncate } from "./ui/text"

/**
 * The working row above the prompt, after Claude Code's spinner:
 *
 *   ✶ Đang phân tích… (1m 23s · ↓ 4,2k token)
 *     ⎿ Tiếp: So sánh P/E với ngành
 *
 * The verb is the todo item in progress, else one picked per turn. With no output for 3 s
 * (and no tool running) the glyph turns red over 2 s. While a model request waits to be
 * retried the row says so with a live countdown; once anything arrives the row is back to
 * normal and nothing is left in the transcript (codex's status header, not a history cell).
 */

/** Claude Code's frames without the macOS-only one, played forwards then back. */
export const FRAMES = ["·", "✢", "*", "✶", "✻", "✽"]
const PINGPONG = [...FRAMES, ...FRAMES.slice(1, -1).reverse()]
const FRAME_MS = 120
/** No output for this long (and no tool running): the glyph starts turning red… */
export const STALL_AFTER_MS = 3000
/** …and is fully red this much later. */
export const STALL_RAMP_MS = 2000
/** Output below this is not shown. */
const MIN_TOKENS_SHOWN = 100
/** The tip line waits this long, so a quick answer never shows one. */
export const TIP_AFTER_MS = 10_000

export const VERBS = [
  "Đang phân tích",
  "Đang soi bảng giá",
  "Đang đọc báo cáo",
  "Đang đối chiếu số liệu",
  "Đang tính toán",
  "Đang cân nhắc",
  "Đang dò dữ liệu",
  "Đang tra cứu",
  "Đang tổng hợp",
  "Đang lọc tín hiệu",
  "Đang xem biểu đồ",
  "Đang đọc BCTC",
  "Đang so sánh",
  "Đang suy luận",
  "Đang kiểm tra",
  "Đang gom dữ liệu",
  "Đang soạn câu trả lời",
  "Đang lần theo dòng tiền",
  "Đang định giá",
  "Đang xâu chuỗi",
  "Đang nghiền ngẫm",
  "Đang rà soát",
  "Đang ước lượng",
  "Đang chắt lọc",
]

/** A fresh working state for a turn (or a compaction). */
export function startActivity(opts: { compacting?: boolean; random?: () => number } = {}): Activity {
  const random = opts.random ?? Math.random
  const t = now()
  return {
    startedAt: t,
    pausedMs: 0,
    billedOut: 0,
    streamedOut: 0,
    lastProgressAt: t,
    toolsRunning: 0,
    verb: opts.compacting ? "Đang nén hội thoại" : VERBS[Math.floor(random() * VERBS.length)]!,
    tip: pickTip(random),
  }
}

/** Time spent working, without the time the turn waited for the user. */
export function activeMs(a: Pick<Activity, "startedAt" | "pausedMs" | "pausedAt">, t: number): number {
  return Math.max(0, t - a.startedAt - a.pausedMs - (a.pausedAt !== undefined ? t - a.pausedAt : 0))
}

/** "12s", "1m 05s", "1h 02m" (codex's fmt_elapsed_compact). */
export function fmtElapsed(ms: number): string {
  // A shared ticker can be up to one interval older than a start time taken just now.
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
}

/** 0 while output flows, rising to 1 once nothing has come for STALL_AFTER_MS + STALL_RAMP_MS. */
export function stallShare(a: Activity, t: number): number {
  if (a.toolsRunning > 0 || a.retry || a.pausedAt !== undefined) return 0
  return Math.min(1, Math.max(0, (t - a.lastProgressAt - STALL_AFTER_MS) / STALL_RAMP_MS))
}

/** Output tokens so far: what the provider billed for finished steps plus the step streaming now. */
export const outTokens = (a: Activity) => Math.round(a.billedOut + a.streamedOut)

/** "Provider lỗi tạm thời (503) · thử lại sau 7s (lần 3/4) · esc dừng" */
export function retryLine(retry: NonNullable<Activity["retry"]>, t: number): string {
  const seconds = Math.max(0, Math.ceil((retry.until - t) / 1000))
  const label = retry.label.charAt(0).toUpperCase() + retry.label.slice(1)
  const wait = seconds > 0 ? `thử lại sau ${seconds}s` : "đang thử lại…"
  return `${label} · ${wait} (lần ${retry.attempt}/${retry.max}) · esc dừng`
}

export function ActivityRow(props: { tips: boolean }) {
  const dims = useTerminalDimensions()
  const t = useNow(FRAME_MS)
  const a = () => state.activity!
  const todos = createMemo(shownTodos)
  const doing = () => todos().find((x) => x.status === "in_progress")?.content
  const next = () => {
    const list = todos()
    const at = list.findIndex((x) => x.status === "in_progress")
    return list.slice(at + 1).find((x) => x.status === "pending")?.content ?? (at < 0 ? list.find((x) => x.status === "pending")?.content : undefined)
  }
  const room = () => Math.max(10, dims().width - 8)

  const glyph = () => (a().retry ? "△" : PINGPONG[Math.floor(t() / FRAME_MS) % PINGPONG.length]!)
  const glyphColor = () => {
    if (a().retry) return color.tham
    const share = stallShare(a(), t())
    return share > 0 ? mix(color.tham, color.giam, share) : color.tham
  }
  const verb = () => (a().verb === "Đang nén hội thoại" ? a().verb : (doing() ?? a().verb))
  const stats = () => {
    const parts = [fmtElapsed(activeMs(a(), t()))]
    const out = outTokens(a())
    // A handful of tokens at the start of a turn is noise, not progress.
    if (out >= MIN_TOKENS_SHOWN) parts.push(`↓ ${fmtTokens(out)} token`)
    return ` (${parts.join(" · ")})`
  }
  const sub = () => {
    const n = next()
    if (n) return `Tiếp: ${n}`
    if (props.tips && a().tip && activeMs(a(), t()) >= TIP_AFTER_MS) return `Mẹo: ${a().tip}`
    return undefined
  }

  return (
    <box flexDirection="column" flexShrink={0} marginLeft={2} marginRight={2} paddingLeft={1} backgroundColor={color.bg}>
      <box flexDirection="row" height={1}>
        <text fg={glyphColor()} width={2} flexShrink={0} selectable={false}>
          {glyph()}
        </text>
        <Show
          when={a().retry}
          fallback={
            <text wrapMode="none" selectable={false}>
              <span style={{ fg: color.tx, bold: true }}>{`${truncate(verb(), Math.max(10, room() - 30))}…`}</span>
              <span style={{ fg: color.tx3 }}>{stats()}</span>
            </text>
          }
        >
          {(retry) => (
            <text fg={color.tham} wrapMode="none" selectable={false}>
              {truncate(retryLine(retry(), t()), room())}
            </text>
          )}
        </Show>
      </box>
      <Show when={sub()}>
        {(line) => (
          <text fg={color.tx3} wrapMode="none" selectable={false}>
            {`  ⎿ ${truncate(line(), room() - 4)}`}
          </text>
        )}
      </Show>
    </box>
  )
}
