import { useKeyboard } from "@opentui/solid"
import { createSignal, For } from "solid-js"
import { loadConfig, saveConfig } from "../../core/config"
import type { PermissionGate } from "../../core/permission"
import { MODE_LABEL } from "../../core/permission/mode"
import { say } from "../notify"
import { setState, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"

/**
 * The first switch to ▸▸ auto asks first (as Claude Code does): what the mode
 * does, what it costs, where it stops. The gate stays in its old mode until the user says
 * yes, so nothing is approved by the classifier while this is open. Nothing is written to
 * the transcript. Shift+Tab closes it without turning auto on and moves on (to ‖ chỉ đọc).
 */

type Choice = "on" | "default" | "back"

const CHOICES: { value: Choice; label: string; hint: (from: string) => string }[] = [
  { value: "on", label: "Bật", hint: () => "cho phiên này" },
  { value: "default", label: "Bật và đặt làm mặc định", hint: () => "các phiên sau mở ở ▸▸ tự động" },
  { value: "back", label: "Không, quay lại", hint: (from) => `giữ ${from}` },
]

/** What ▸▸ auto does, costs and where it stops; also shown in /permissions while in auto. */
export const AUTO_EXPLAIN = [
  "Agent làm liên tục, không hỏi từng bước. Mỗi lệnh shell, lần sửa file có sẵn, tool ghi hay trang web mới được một model duyệt trước (khoảng 1 request mỗi lần, thêm 1 khi bị nghi ngờ; đổi model duyệt ở /config).",
  "Đọc file và tạo file mới trong workspace không cần duyệt (vẫn /undo được). File khoá/mật khẩu, cấu hình OpenTrading, ghi ngoài workspace vẫn luôn hỏi bạn.",
  "Model duyệt có thể sai: đừng dùng cho việc nhạy cảm. Bị chặn 3 lần liên tiếp, hoặc model duyệt lỗi/hết quota, thì quay về hỏi bạn.",
]

/** Accept or decline; also used when the session opens with defaultMode "auto" not yet accepted. */
export async function answerAutoOptIn(gate: PermissionGate, choice: Choice) {
  const from = state.autoOptIn?.from ?? gate.mode
  setState("autoOptIn", undefined)
  if (choice === "back") return gate.setMode(from === "auto" ? "ask" : from)
  gate.setMode("auto")
  setState("autoAcknowledged", true)
  const config = await loadConfig()
  await saveConfig({ permissions: { ...config.permissions, autoAcknowledged: true, ...(choice === "default" ? { defaultMode: "auto" as const } : {}) } })
  if (choice === "default") say("Đã bật ▸▸ tự động và đặt làm mặc định cho các phiên sau", "success")
}

export function AutoOptInDialog(props: { gate: PermissionGate }) {
  const [selected, setSelected] = createSignal(0)
  const from = () => MODE_LABEL[state.autoOptIn?.from ?? "ask"]
  const choose = (i: number) => void answerAutoOptIn(props.gate, CHOICES[i]!.value)

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    // Shift+Tab (or Alt+M) keeps cycling: auto is skipped, the next mode is ‖ chỉ đọc.
    if ((evt.name === "tab" && evt.shift) || (evt.meta && evt.name === "m")) {
      evt.preventDefault()
      setState("autoOptIn", undefined)
      return props.gate.setMode("read-only")
    }
    evt.preventDefault()
    const n = CHOICES.length
    if (evt.name === "up") setSelected((i) => (i + n - 1) % n)
    else if (evt.name === "down") setSelected((i) => (i + 1) % n)
    else if (evt.name === "return") choose(selected())
    else if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) choose(n - 1)
    else if (/^[1-3]$/.test(evt.name ?? "")) choose(Number(evt.name) - 1)
  })

  return (
    <DialogFrame title="Bật chế độ ▸▸ tự động?" accent={color.tham} hint="↑↓ chọn · enter xác nhận · 1-3 chọn nhanh · shift+tab chế độ tiếp · esc quay lại">
      <box flexDirection="column" paddingLeft={2} flexShrink={0}>
        <For each={AUTO_EXPLAIN}>
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
                <text fg={active() ? color.tang : color.tx3} width={5} flexShrink={0} selectable={false}>
                  {active() ? "❯ " : "  "}
                  <span style={{ fg: color.tx3 }}>{`${i() + 1}.`}</span>
                </text>
                <text fg={active() ? color.tang : color.tx} width={26} flexShrink={0}>
                  {choice.label}
                </text>
                <text fg={color.tx3} wrapMode="none">
                  {choice.hint(from())}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </DialogFrame>
  )
}
