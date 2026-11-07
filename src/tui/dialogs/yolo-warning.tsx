import { useKeyboard } from "@opentui/solid"
import { createSignal, For } from "solid-js"
import type { PermissionGate } from "../../core/permission"
import { requestExit, setState } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"

/**
 * `ot --yolo` asks every time it opens (as Claude Code warns before its bypass mode): what the
 * mode skips, what still stops, and "no" exits. The gate keeps its configured mode until the
 * user says yes, so nothing runs unasked while this is open. Nothing is saved: the next launch
 * asks again.
 */

type Choice = "exit" | "accept"

const CHOICES: { value: Choice; label: string }[] = [
  { value: "exit", label: "Không, thoát" },
  { value: "accept", label: "Tôi chấp nhận" },
]

export const YOLO_EXPLAIN = [
  "Model sẽ ghi file, chạy lệnh shell và gọi tool ghi (MCP, web) mà KHÔNG hỏi bạn, kể cả trong subagent.",
  "Chỉ dùng trong thư mục hoặc máy ảo có thể khôi phục, không chứa dữ liệu quan trọng.",
  "Vẫn chặn hoặc vẫn hỏi: luật chặn (deny) và luật hỏi (ask) của bạn, file khoá/mật khẩu, thư mục cấu hình (.git, .opentrading, .ssh…), đường mạng và ghi ngoài workspace.",
  "Tiếp tục nghĩa là bạn chịu trách nhiệm về mọi việc model làm trong phiên này.",
]

export function answerYolo(gate: PermissionGate, choice: Choice) {
  setState("yoloWarning", false)
  if (choice === "exit") return requestExit()
  // A ▸▸ opt-in waiting behind (defaultMode "auto", never accepted) would ask next and its
  // "no" would drop the session out of ▸▸▸: the user just chose a mode beyond it.
  setState("autoOptIn", undefined)
  gate.setMode("bypass")
}

export function YoloWarningDialog(props: { gate: PermissionGate }) {
  // "Không, thoát" is the default: Enter alone never turns the mode on.
  const [selected, setSelected] = createSignal(0)
  const choose = (i: number) => answerYolo(props.gate, CHOICES[i]!.value)

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    evt.preventDefault()
    const n = CHOICES.length
    if (evt.name === "up") setSelected((i) => (i + n - 1) % n)
    else if (evt.name === "down") setSelected((i) => (i + 1) % n)
    else if (evt.name === "return") choose(selected())
    else if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) choose(0)
    else if (/^[1-2]$/.test(evt.name ?? "")) choose(Number(evt.name) - 1)
  })

  return (
    <DialogFrame title="CẢNH BÁO: OpenTrading đang chạy ở chế độ ▸▸▸ bỏ qua quyền (--yolo)" accent={color.giam} hint="↑↓ chọn · enter xác nhận · 1-2 chọn nhanh · esc thoát">
      <box flexDirection="column" paddingLeft={2} flexShrink={0}>
        <For each={YOLO_EXPLAIN}>
          {(line) => (
            <text fg={color.tx2} wrapMode="word" flexShrink={0}>
              {line}
            </text>
          )}
        </For>
      </box>
      <box flexDirection="column" marginTop={1} flexShrink={0}>
        <For each={CHOICES}>
          {(choice, i) => {
            const active = () => i() === selected()
            return (
              <box flexDirection="row" height={1} flexShrink={0}>
                <text fg={active() ? color.giam : color.tx3} width={5} flexShrink={0} selectable={false}>
                  {active() ? "❯ " : "  "}
                  <span style={{ fg: color.tx3 }}>{`${i() + 1}.`}</span>
                </text>
                <text fg={active() ? color.giam : color.tx} flexShrink={0}>
                  {choice.label}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </DialogFrame>
  )
}
