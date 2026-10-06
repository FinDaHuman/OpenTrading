import { useKeys } from "../ui/keys"
import { createResource } from "solid-js"
import { loadConfig, saveConfig } from "../../core/config"
import { configFile } from "../../core/paths"
import { createMemory, switchMemory, type Runtime } from "../../core/runtime"
import { closeDialog, pushLine } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

type Setting = "memory" | "toolSearch" | "autoCompact"

const TOOL_SEARCH_NEXT = { auto: "on", on: "off", off: "auto" } as const
const TOOL_SEARCH_HINT = {
  auto: "Tự động · hoãn tool MCP khi > 40 tool hoặc > 10% context; model nạp bằng tool_search",
  on: "Luôn hoãn tool MCP · model nạp bằng tool_search",
  off: "Tắt · gửi mọi tool (tối đa 128)",
} as const

/** Settings that used to require editing ~/.opentrading/config.json by hand. Applied live. */
export function ConfigDialog(props: { runtime: Runtime }) {
  const [config, { refetch }] = createResource(loadConfig)

  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  async function toggle(setting: Setting) {
    if (setting === "autoCompact") {
      await saveConfig({ autoCompact: config()?.autoCompact === "off" ? "auto" : "off" })
      await refetch()
      return
    }
    if (setting === "toolSearch") {
      const next = TOOL_SEARCH_NEXT[config()?.toolSearch ?? "auto"]
      await saveConfig({ toolSearch: next })
      await refetch()
      return
    }
    const next = props.runtime.memory.id === "file" ? "none" : "file"
    await saveConfig({ memory: { provider: next } })
    switchMemory(props.runtime, createMemory(next))
    pushLine({
      kind: "info",
      text:
        next === "file"
          ? "Đã bật memory (lưu file ở ~/.opentrading/memory). Nói \"Ghi nhớ: …\" để lưu; xem và duyệt bằng /memory."
          : "Đã tắt memory. Các memory đã lưu vẫn còn trên đĩa và sẽ dùng lại khi bật.",
    })
    await refetch()
  }

  return (
    <DialogFrame title="Cài đặt" hint="enter đổi · esc đóng">
      <Picker
        items={[
          {
            label: "Memory",
            hint:
              (config()?.memory?.provider ?? props.runtime.memory.id) === "file"
                ? "Bật · lưu file ở ~/.opentrading/memory"
                : "Tắt · enter để bật",
            mark: props.runtime.memory.id === "file" ? "●" : "○",
            value: "memory" as Setting,
          },
          {
            label: "Tìm tool",
            hint: TOOL_SEARCH_HINT[config()?.toolSearch ?? "auto"],
            mark: (config()?.toolSearch ?? "auto") === "off" ? "○" : "●",
            value: "toolSearch" as Setting,
          },
          {
            label: "Tự nén hội thoại",
            hint:
              config()?.autoCompact === "off"
                ? "Tắt · chỉ nén khi gõ /compact"
                : "Tự động · khi context tới 80%: dọn kết quả tool cũ, rồi tóm tắt nếu cần (1 request)",
            mark: config()?.autoCompact === "off" ? "○" : "●",
            value: "autoCompact" as Setting,
          },
        ]}
        onPick={(s) => void toggle(s)}
        rows={5}
      />
      <text fg={color.tx3} marginTop={1}>{`File cấu hình: ${configFile()}`}</text>
    </DialogFrame>
  )
}
