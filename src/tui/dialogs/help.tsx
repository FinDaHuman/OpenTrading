import { useKeys } from "../ui/keys"
import { createMemo } from "solid-js"
import { COMMANDS } from "../commands"
import { closeDialog, state } from "../state"
import { color } from "../theme"
import { promptUsage } from "../commands"
import { DialogFrame } from "./frame"
import { Picker, type PickerItem } from "./picker"

const KEYS: [string, string][] = [
  ["enter", "gửi tin nhắn · chạy lệnh đang chọn trong danh sách /"],
  ["tab", "điền lệnh đang chọn vào ô nhập (không chạy)"],
  ["↑ ↓", "chọn trong danh sách / và các bảng"],
  ["esc", "đóng danh sách / · đóng bảng · dừng câu trả lời đang chạy"],
  ["ctrl+o", "mở rộng / thu gọn kết quả tool"],
  ["kéo chuột", "bôi đen để copy (tự copy khi thả chuột) · giữ shift để dùng chọn chữ của terminal"],
  ["ctrl+c", "copy phần đang bôi đen · xoá ô nhập / dừng câu trả lời · bấm 2 lần để thoát"],
  ["ctrl+d", "bấm 2 lần khi ô nhập trống để thoát"],
]

type Entry = { kind: "command"; name: string } | { kind: "key" }

/** Commands (built-in and MCP prompts) and keys in one filterable list; enter runs a command. */
export function HelpDialog(props: { onRun: (command: string) => void }) {
  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  const items = createMemo<PickerItem<Entry>[]>(() => [
    ...COMMANDS.map((c) => ({
      label: `/${c.name}${c.args ? ` ${c.args}` : ""}`,
      hint: c.description,
      group: "Lệnh",
      value: { kind: "command" as const, name: c.name },
    })),
    ...state.mcp.flatMap((s) =>
      s.state === "connected"
        ? s.prompts.map((p) => ({
            label: `/${s.name}:${p.name}${p.arguments.length ? ` ${promptUsage(p.arguments)}` : ""}`,
            hint: p.description?.split("\n")[0] ?? `Prompt của MCP server ${s.name}`,
            group: "Lệnh từ MCP server",
            value: { kind: "command" as const, name: `${s.name}:${p.name}` },
          }))
        : [],
    ),
    ...KEYS.map(([key, description]) => ({
      label: key,
      hint: description,
      markColor: color.san,
      group: "Phím tắt",
      value: { kind: "key" as const },
    })),
  ])

  return (
    <DialogFrame
      title="Trợ giúp"
      subtitle="OpenTrading · harness AI phân tích chứng khoán Việt Nam · không phải tư vấn đầu tư"
      hint="gõ để lọc · ↑↓ chọn · enter chạy lệnh · esc đóng"
    >
      <Picker
        items={items()}
        onPick={(entry) => {
          if (entry.kind !== "command") return
          closeDialog()
          props.onRun(`/${entry.name}`)
        }}
        rows={16}
      />
    </DialogFrame>
  )
}
