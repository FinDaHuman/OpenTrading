import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, Match, Switch } from "solid-js"
import { saveConfig } from "../../core/config"
import { chatModels, type ProviderId } from "../../core/providers"
import { closeDialog, providerName, pushLine, setState, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

type Choice = { provider: ProviderId; model: string } | "manual"

function contextLabel(tokens?: number) {
  if (!tokens) return ""
  return tokens >= 1_000_000 ? ` · ${Math.round(tokens / 100_000) / 10}M` : ` · ${Math.round(tokens / 1000)}k`
}

export function ModelDialog() {
  const [manual, setManual] = createSignal(false)
  const initialFilter = state.modelFilter
  setState("modelFilter", "")

  // Models from every connected provider, current provider first.
  const items = createMemo(() => {
    const order = [...state.connected].sort((a, b) => Number(b === state.provider) - Number(a === state.provider))
    return order.flatMap((id) => {
      const provider = state.catalog[id]
      if (!provider) return []
      return chatModels(provider).map((m) => ({
        label: m.name,
        hint: `${provider.name}${contextLabel(m.limit?.context)}`,
        mark: id === state.provider && m.id === state.model ? "●" : " ",
        value: { provider: id, model: m.id } as Choice,
      }))
    })
  })

  async function choose(choice: Choice) {
    if (choice === "manual") return setManual(true)
    await saveConfig(choice)
    setState({ provider: choice.provider, model: choice.model })
    pushLine({ kind: "info", text: `Model: ${providerName(choice.provider)} · ${choice.model}` })
    closeDialog()
  }

  /** Manual entry is `provider/model-id`, or just `model-id` for the current provider. */
  function chooseManual(text: string) {
    const value = text.trim()
    if (!value) return
    const slash = value.indexOf("/")
    const head = slash > 0 ? value.slice(0, slash) : ""
    if (head && state.connected.includes(head)) return choose({ provider: head, model: value.slice(slash + 1) })
    if (state.provider) return choose({ provider: state.provider, model: value })
  }

  useKeyboard((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") manual() ? setManual(false) : closeDialog()
  })

  return (
    <Switch>
      <Match when={state.connected.length === 0}>
        <DialogFrame title="Chọn model" hint="esc đóng">
          <text fg={color.tham}>Chưa kết nối provider nào. Gõ /connect trước.</text>
        </DialogFrame>
      </Match>
      <Match when={manual()}>
        <DialogFrame title="Nhập model id" hint="enter lưu · esc quay lại">
          <text fg={color.tx3}>{`Dạng provider/model, ví dụ ${state.connected[0]}/<model-id>`}</text>
          <input
            focused
            placeholder="provider/model-id"
            textColor={color.tx}
            focusedTextColor={color.tx}
            backgroundColor={color.panel2}
            focusedBackgroundColor={color.panel2}
            onSubmit={(v: unknown) => typeof v === "string" && chooseManual(v)}
          />
        </DialogFrame>
      </Match>
      <Match when={true}>
        <DialogFrame title={`Chọn model · ${state.connected.length} provider`} width={80}>
          <Picker
            items={[...items(), { label: "+ Nhập model id thủ công", value: "manual" as Choice }]}
            onPick={choose}
            rows={14}
            initialFilter={initialFilter}
            placeholder="gõ tên model hoặc provider để lọc…"
          />
        </DialogFrame>
      </Match>
    </Switch>
  )
}
