import { useKeyboard } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import type { DeskApprovalRequest, DeskApprovals } from "../../core/desk/approval"
import { DESK_SIZES, type DeskSize } from "../../core/desk/types"
import { EFFORT_LEVELS, type Effort } from "../../core/effort"
import { groupDigits } from "../../core/subagents/result"
import { color } from "../theme"
import { truncate } from "../ui/text"
import { DialogFrame } from "./frame"

/**
 * The card before a desk run (the user picked "gọn, chỉnh được", 21/10): what it will do,
 * what it costs at each size, and ◂ ▸ to change size and effort before saying yes.
 *
 *   Quy mô   ◂ small ▸   6 agent · ~36 request
 *   Effort   ◂ medium ▸  model: …
 *   ❯ Chạy / Chạy, không hỏi lại <playbook> / Xem tham số / Không
 */

const SIZE_LABEL: Record<DeskSize, string> = { small: "small", medium: "medium", large: "large", unrestricted: "không giới hạn" }
/** undefined = the default effort (config desk.effort, else as subagents). */
const EFFORTS: (Effort | undefined)[] = [undefined, ...EFFORT_LEVELS]

type Row = "size" | "effort" | "run" | "remember" | "args" | "no"
const ROWS: Row[] = ["size", "effort", "run", "remember", "args", "no"]
/** Enter this soon after the card appears is ignored: it was meant for the prompt. */
const GRACE_MS = 400

export function DeskApprovalCard(props: { request: DeskApprovalRequest; approvals: DeskApprovals }) {
  const r = () => props.request
  const [row, setRow] = createSignal<Row>("run")
  const [size, setSize] = createSignal<DeskSize>(r().size)
  const [effort, setEffort] = createSignal<Effort | undefined>(r().effort)
  const [showArgs, setShowArgs] = createSignal(false)
  const shownAt = Date.now()

  const estimate = () => r().estimates[size()]
  const over = () => estimate().requests > r().warnRequests || (r().maxRequests !== undefined && estimate().requests > r().maxRequests!)
  const answer = (run: boolean, remember = false) => props.approvals.answer({ run, size: size(), effort: effort(), remember })
  const cycle = <T,>(list: readonly T[], current: T, step: number) => list[(list.indexOf(current) + step + list.length) % list.length]!

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    evt.preventDefault()
    const at = ROWS.indexOf(row())
    if (evt.name === "up") return setRow(ROWS[(at + ROWS.length - 1) % ROWS.length]!)
    if (evt.name === "down" || evt.name === "tab") return setRow(ROWS[(at + 1) % ROWS.length]!)
    if (evt.name === "left" || evt.name === "right") {
      const step = evt.name === "left" ? -1 : 1
      if (row() === "size") setSize((s) => cycle(DESK_SIZES, s, step))
      if (row() === "effort") setEffort((e) => cycle(EFFORTS, e, step))
      return
    }
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) return answer(false)
    if (evt.name !== "return" || Date.now() - shownAt < GRACE_MS) return
    if (row() === "no") return answer(false)
    if (row() === "args") return setShowArgs((v) => !v)
    if (row() === "remember") return answer(true, true)
    return answer(true)
  })

  const pointer = (name: Row) => (row() === name ? "❯ " : "  ")
  const fg = (name: Row) => (row() === name ? color.tang : color.tx)

  return (
    <DialogFrame title={`ultradesk · ${r().playbook}`} accent={color.tham} hint="↑↓ chọn · ←→ đổi quy mô/effort · enter xác nhận · esc không chạy">
      <box flexDirection="column" flexShrink={0}>
        <text fg={color.tx} wrapMode="word">
          {r().summary}
        </text>
        <text fg={color.tx3} wrapMode="word">{`Phase: ${r().phases.join(" → ")}`}</text>
        <Show when={r().reason === "no-opt-in"}>
          <text fg={color.tx3} wrapMode="word">
            Model tự đề xuất chạy playbook này (bạn chưa gõ ultradesk hay bật /desk on).
          </text>
        </Show>
      </box>
      <box flexDirection="column" marginTop={1} flexShrink={0}>
        <text wrapMode="none" fg={fg("size")}>
          {`${pointer("size")}Quy mô   ◂ ${SIZE_LABEL[size()]} ▸`}
          <span style={{ fg: over() ? color.tham : color.tx3 }}>{`   ${estimate().agents} agent · ~${groupDigits(estimate().requests)} request`}</span>
        </text>
        <text wrapMode="none" fg={fg("effort")}>
          {`${pointer("effort")}Effort   ◂ ${effort() ?? "mặc định"} ▸`}
          <span style={{ fg: color.tx3 }}>{`   model: ${truncate(r().model, 40)}`}</span>
        </text>
        <Show when={over()}>
          <text fg={color.tham} wrapMode="word">
            {`  △ Run này có thể tốn tới ~${groupDigits(estimate().requests)} request${r().maxRequests !== undefined ? ` (trần mỗi run: ${groupDigits(r().maxRequests!)})` : ` (cảnh báo từ ${groupDigits(r().warnRequests)})`}. Gói miễn phí tính quota theo request mỗi ngày.`}
          </text>
        </Show>
      </box>
      <box flexDirection="column" marginTop={1} flexShrink={0}>
        <text fg={fg("run")}>{`${pointer("run")}Chạy`}</text>
        <text fg={fg("remember")}>{`${pointer("remember")}Chạy, không hỏi lại ${r().playbook}`}</text>
        <text fg={fg("args")}>{`${pointer("args")}${showArgs() ? "Ẩn tham số" : "Xem tham số"}`}</text>
        <Show when={showArgs()}>
          <For each={JSON.stringify(r().args, null, 2).split("\n").slice(0, 12)}>
            {(line) => (
              <text fg={color.tx3} wrapMode="none">
                {`    ${truncate(line, 90)}`}
              </text>
            )}
          </For>
        </Show>
        <text fg={fg("no")}>{`${pointer("no")}Không`}</text>
      </box>
    </DialogFrame>
  )
}
