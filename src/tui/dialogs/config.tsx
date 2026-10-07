import { useKeys } from "../ui/keys"
import { createMemo, createResource, createSignal, Match, Switch } from "solid-js"
import { loadConfig, saveConfig } from "../../core/config"
import { configFile } from "../../core/paths"
import { chatModels } from "../../core/providers"
import { createMemory, switchMemory, type Runtime } from "../../core/runtime"
import { DEFAULT_MAX_CONCURRENT } from "../../core/subagents/manager"
import { blocked, closeDialog, providerName, pushLine, setState, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

type Setting = "memory" | "toolSearch" | "autoCompact" | "subagentMax" | "subagentModel"
type SubagentModel = { provider: string; model: string } | "inherit"

const TOOL_SEARCH_NEXT = { auto: "on", on: "off", off: "auto" } as const
const TOOL_SEARCH_HINT = {
  auto: "Tự động · hoãn tool MCP khi > 40 tool hoặc > 10% context; model nạp bằng tool_search",
  on: "Luôn hoãn tool MCP · model nạp bằng tool_search",
  off: "Tắt · gửi mọi tool (tối đa 128)",
} as const

/** Settings that used to require editing ~/.opentrading/config.json by hand. Applied live. */
export function ConfigDialog(props: { runtime: Runtime }) {
  const [config, { refetch }] = createResource(loadConfig)
  /** A setting with its own sub-view (number entry, model list); undefined = the list. */
  const [editing, setEditing] = createSignal<"subagentMax" | "subagentModel">()
  const [error, setError] = createSignal("")

  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") editing() ? setEditing(undefined) : closeDialog()
  })

  const maxConcurrent = () => config()?.subagents?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  const subagentModel = () => {
    const s = config()?.subagents
    return s?.model ? `${providerName(s.provider ?? state.provider)} · ${s.model}` : undefined
  }

  /** Models of connected providers that can call tools (a subagent without tools is useless). */
  const toolModels = createMemo(() =>
    state.connected.flatMap((id) => {
      const provider = state.catalog[id]
      if (!provider) return []
      return chatModels(provider)
        .filter((m) => m.tool_call !== false)
        .map((m) => ({
          label: m.name,
          hint: provider.name,
          mark: config()?.subagents?.provider === id && config()?.subagents?.model === m.id ? "●" : " ",
          value: { provider: id, model: m.id } as SubagentModel,
        }))
    }),
  )

  async function saveMax(text: string) {
    const n = Number(text.trim())
    if (!Number.isInteger(n) || n < 1) return setError("Nhập một số nguyên từ 1 trở lên.")
    const current = await loadConfig()
    await saveConfig({ subagents: { ...current.subagents, maxConcurrent: n } })
    props.runtime.subagents.setMax(n)
    setState("agentSlots", props.runtime.subagents.limiter.stats())
    setError("")
    setEditing(undefined)
    await refetch()
  }

  async function saveModel(choice: SubagentModel) {
    const current = await loadConfig()
    const { provider: _p, model: _m, ...rest } = current.subagents ?? {}
    await saveConfig({ subagents: choice === "inherit" ? rest : { ...rest, ...choice } })
    setEditing(undefined)
    await refetch()
  }

  async function toggle(setting: Setting) {
    if (setting === "subagentMax" || setting === "subagentModel") return setEditing(setting)
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
    <Switch>
      <Match when={editing() === "subagentMax"}>
        <DialogFrame title="Subagent chạy song song" hint="enter lưu · esc quay lại">
          <text fg={color.tx3}>{`Số subagent chạy cùng lúc (cả chạy nền), hiện tại ${maxConcurrent()}. Vượt quá thì xếp hàng chờ.`}</text>
          <text fg={color.tx3}>Gói miễn phí (ví dụ Gemini) giới hạn số request mỗi phút: nên để thấp.</text>
          <input
            focused={!blocked()}
            placeholder={String(maxConcurrent())}
            textColor={color.tx}
            focusedTextColor={color.tx}
            backgroundColor={color.panel2}
            focusedBackgroundColor={color.panel2}
            onSubmit={(v: unknown) => typeof v === "string" && void saveMax(v)}
          />
          <text fg={color.giam}>{error()}</text>
        </DialogFrame>
      </Match>
      <Match when={editing() === "subagentModel"}>
        <DialogFrame title="Model cho subagent" hint="enter chọn · esc quay lại">
          <Picker
            items={[
              { label: "Theo model của phiên (mặc định)", mark: subagentModel() ? " " : "●", value: "inherit" as SubagentModel },
              ...toolModels(),
            ]}
            onPick={(c) => void saveModel(c)}
            rows={12}
            placeholder="gõ tên model để lọc… (chỉ model gọi được tool)"
          />
        </DialogFrame>
      </Match>
      <Match when={true}>
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
              {
                label: "Subagent chạy song song",
                hint: `${maxConcurrent()} cùng lúc (cả chạy nền) · vượt thì xếp hàng · enter để đổi`,
                mark: "●",
                value: "subagentMax" as Setting,
              },
              {
                label: "Model cho subagent",
                hint: subagentModel() ?? "Theo model của phiên · enter để chọn model khác (vd. rẻ hơn)",
                mark: subagentModel() ? "●" : "○",
                value: "subagentModel" as Setting,
              },
            ]}
            onPick={(s) => void toggle(s)}
            rows={7}
          />
          <text fg={color.tx3} marginTop={1}>{`File cấu hình: ${configFile()}`}</text>
        </DialogFrame>
      </Match>
    </Switch>
  )
}
