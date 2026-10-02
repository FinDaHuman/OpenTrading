import { useKeyboard } from "@opentui/solid"
import { createResource } from "solid-js"
import { loadConfig, saveConfig } from "../../core/config"
import { configFile } from "../../core/paths"
import { createMemory, switchMemory, type Runtime } from "../../core/runtime"
import { closeDialog, pushLine } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

type Setting = "memory"

/** Settings that used to require editing ~/.opentrading/config.json by hand. Applied live. */
export function ConfigDialog(props: { runtime: Runtime }) {
  const [config, { refetch }] = createResource(loadConfig)

  useKeyboard((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  const memoryOn = () => props.runtime.memory.id !== "none"

  async function toggle(setting: Setting) {
    if (setting !== "memory") return
    const next = memoryOn() ? "none" : "sqlite"
    // Keep the other memory settings (limits, T3…) when only the provider changes.
    const current = (await loadConfig()).memory ?? {}
    await saveConfig({ memory: { ...current, provider: next } })
    switchMemory(props.runtime, createMemory(next, undefined, { ...current, provider: next }))
    pushLine({
      kind: "info",
      text:
        next === "sqlite"
          ? 'Đã bật memory (SQLite ở ~/.opentrading/opentrading.db). Gõ "Ghi nhớ: …" hoặc "Ghi chú <MÃ>: …" để lưu; ' +
            "xem, duyệt, xoá bằng /memory."
          : "Đã tắt memory. Các memory đã lưu vẫn còn trên đĩa và sẽ dùng lại khi bật.",
    })
    await refetch()
  }

  return (
    <DialogFrame title="Cài đặt" hint="enter đổi · esc đóng" width={80}>
      <Picker
        items={[
          {
            label: "Memory",
            hint: (config(), memoryOn()) ? "Bật · SQLite ở ~/.opentrading/opentrading.db" : "Tắt · enter để bật",
            mark: memoryOn() ? "●" : "○",
            value: "memory" as Setting,
          },
        ]}
        onPick={(s) => void toggle(s)}
        rows={4}
      />
      <text fg={color.tx3} marginTop={1}>{`File cấu hình: ${configFile()}`}</text>
    </DialogFrame>
  )
}
