import { useKeys } from "../ui/keys"
import { createMemo, createSignal, Match, Switch } from "solid-js"
import { saveConfig } from "../../core/config"
import { saveModelPrefs, sameModel, toggleFavorite, withRecent, type ModelRef } from "../../core/model-prefs"
import type { ProviderId } from "../../core/providers"
import { say } from "../notify"
import { blocked, closeDialog, providerName, setState, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { choiceKey, modelChoices, type ModelChoice } from "./model-choices"
import { Picker } from "./picker"

type Choice = ModelChoice | "manual"

/** Remember the preferences; a failed write is said, not thrown (the switch itself worked). */
async function persist() {
  try {
    await saveModelPrefs(state.modelPrefs)
  } catch (error) {
    say(`Không lưu được danh sách model yêu thích: ${error instanceof Error ? error.message : String(error)}`, "warning")
  }
}

/**
 * /model, after opencode's model dialog: ★ favourites, recent models, then each connected
 * provider under its own heading. ctrl+f stars the highlighted model, ←/→ jump between
 * groups, typing filters across all of them (shortcut groups hide meanwhile).
 */
export function ModelDialog() {
  const [manual, setManual] = createSignal(false)
  const initialFilter = state.modelFilter
  setState("modelFilter", "")

  const current = () => (state.provider && state.model ? { provider: state.provider, model: state.model } : undefined)
  const items = createMemo(() => modelChoices({ prefs: state.modelPrefs, current: current() }))

  async function choose(choice: Choice) {
    if (choice === "manual") return setManual(true)
    if (choice.unavailable) return say(`Không dùng được ${choice.model}: ${choice.unavailable}. ctrl+f để bỏ khỏi yêu thích.`, "error")
    const ref: ModelRef = { provider: choice.provider, model: choice.model }
    await saveConfig(ref)
    setState({ provider: ref.provider, model: ref.model, modelPrefs: withRecent(state.modelPrefs, ref) })
    void persist()
    say(`Model: ${providerName(ref.provider)} · ${ref.model}`, "success")
    closeDialog()
  }

  function star(ref: ModelRef) {
    const on = !state.modelPrefs.favorite.some((f) => sameModel(f, ref))
    setState("modelPrefs", toggleFavorite(state.modelPrefs, ref))
    void persist()
    say(on ? `Đã thêm ${ref.model} vào yêu thích` : `Đã bỏ ${ref.model} khỏi yêu thích`, "success", 2500)
  }

  /** Manual entry is `provider/model-id`, or just `model-id` for the current provider. */
  function chooseManual(text: string) {
    const value = text.trim()
    if (!value) return
    const slash = value.indexOf("/")
    const head = slash > 0 ? value.slice(0, slash) : ""
    if (head && state.connected.includes(head)) return choose({ provider: head as ProviderId, model: value.slice(slash + 1) })
    if (state.provider) return choose({ provider: state.provider, model: value })
  }

  useKeys((evt) => {
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
            focused={!blocked()}
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
        <DialogFrame title={`Chọn model · ${state.connected.length} provider`} hint="ctrl+f yêu thích · ←/→ nhảy nhóm · enter chọn · esc đóng">
          <Picker<Choice>
            items={[...items(), { label: "+ Nhập model id thủ công", group: "Khác", value: "manual" as Choice }]}
            onPick={(c) => void choose(c)}
            rows={14}
            initialFilter={initialFilter}
            placeholder="gõ tên model hoặc provider để lọc…"
            itemKey={(item) => (item.value === "manual" ? "manual" : choiceKey(item as never))}
            groupJump
            onKey={(evt, highlighted) => {
              // ctrl+f would move the filter's cursor (emacs forward-char): it stars instead.
              if (evt.eventType === "release" || !(evt.ctrl && evt.name === "f")) return false
              evt.preventDefault()
              if (highlighted && highlighted !== "manual") star({ provider: highlighted.provider, model: highlighted.model })
              return true
            }}
          />
        </DialogFrame>
      </Match>
    </Switch>
  )
}
