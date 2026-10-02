import { useKeyboard } from "@opentui/solid"
import { For } from "solid-js"
import { COMMANDS } from "../commands"
import { closeDialog } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"

const KEYS = [
  ["enter", "gửi tin nhắn"],
  ["tab", "hoàn thành lệnh đang gõ"],
  ["esc", "dừng câu trả lời đang chạy / đóng hộp thoại"],
  ["ctrl+o", "mở rộng / thu gọn kết quả tool"],
  ["ctrl+c", "thoát"],
]

export function HelpDialog() {
  useKeyboard((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })
  return (
    <DialogFrame title="Trợ giúp" hint="esc đóng" width={68}>
      <text fg={color.tham}>Lệnh</text>
      <For each={COMMANDS}>
        {(c) => (
          <box flexDirection="row">
            <text fg={color.tang} width={18}>
              {`/${c.name}${c.args ? ` ${c.args}` : ""}`}
            </text>
            <text fg={color.tx2}>{c.description}</text>
          </box>
        )}
      </For>
      <text fg={color.tham} marginTop={1}>
        Phím tắt
      </text>
      <For each={KEYS}>
        {([k, d]) => (
          <box flexDirection="row">
            <text fg={color.san} width={18}>
              {k}
            </text>
            <text fg={color.tx2}>{d}</text>
          </box>
        )}
      </For>
      <text fg={color.tx3} marginTop={1}>
        Bản demo v0: chưa có dữ liệu thị trường, chưa có tool. Không phải tư vấn đầu tư.
      </text>
    </DialogFrame>
  )
}
