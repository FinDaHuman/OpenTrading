import { useTerminalDimensions } from "@opentui/solid"
import { For } from "solid-js"
import { DialogFrame } from "./dialogs/frame"
import { closeDialog } from "./state"
import { color } from "./theme"
import { useKeys } from "./ui/keys"
import { pad, truncate, width as cells } from "./ui/text"

/**
 * "?" on an empty prompt: the keys at a glance, in three columns (Claude Code's
 * PromptInputHelpMenu). Any key closes it; a typed character goes on into the prompt.
 */

const PASTE_IMAGE = process.platform === "win32" ? "alt+v" : "ctrl+v"

export const SHORTCUTS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Soạn",
    keys: [
      ["/", "lệnh"],
      ["@", "gắn file"],
      ["↑ ↓", "câu đã hỏi"],
      ["ctrl+r", "tìm câu cũ"],
      ["ctrl+j", "xuống dòng"],
      ["ctrl+g", "soạn trong editor"],
      [PASTE_IMAGE, "dán ảnh"],
      ["ctrl+s", "cất / lấy bản nháp"],
    ],
  },
  {
    title: "Khi agent làm",
    keys: [
      ["esc", "dừng"],
      ["enter", "xếp hàng tin tiếp"],
      ["↓", "quản lý subagent"],
      ["ctrl+o", "xem chi tiết"],
      ["shift+tab", "đổi chế độ quyền"],
      ["ctrl+t", "đổi effort"],
    ],
  },
  {
    title: "Khác",
    keys: [
      ["pgup/dn", "cuộn chat"],
      ["ctrl+end", "cuối chat"],
      ["esc ×2", "xoá ô nhập"],
      ["ctrl+c ×2", "thoát"],
      ["/help", "mọi lệnh"],
      ["/model", "đổi model"],
      ["/config", "cài đặt"],
    ],
  },
]

export function ShortcutsPane(props: { onType: (text: string) => void }) {
  const dims = useTerminalDimensions()
  const column = () => Math.max(20, Math.floor((dims().width - 6) / 3))
  const keyWidth = (keys: [string, string][]) => Math.max(...keys.map(([k]) => cells(k)))

  useKeys((evt) => {
    if (evt.eventType === "release") return
    evt.preventDefault()
    closeDialog()
    const typed = evt.sequence
    if (!evt.ctrl && !evt.meta && typed && typed.length === 1 && typed >= " " && typed !== "?") props.onType(typed)
  })

  return (
    <DialogFrame title="Phím tắt" hint="phím bất kỳ để đóng">
      <box flexDirection="row" flexShrink={0}>
        <For each={SHORTCUTS}>
          {(group) => (
            <box flexDirection="column" width={column()} flexShrink={0}>
              <text fg={color.tx2} wrapMode="none">
                <span style={{ bold: true }}>{group.title}</span>
              </text>
              <For each={group.keys}>
                {([key, what]) => (
                  <text wrapMode="none">
                    <span style={{ fg: color.tx }}>{pad(key, keyWidth(group.keys))}</span>
                    <span style={{ fg: color.tx3 }}>{`  ${truncate(what, Math.max(6, column() - keyWidth(group.keys) - 3))}`}</span>
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </box>
    </DialogFrame>
  )
}
