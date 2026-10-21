import { useKeys } from "../ui/keys"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
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

let saving = Promise.resolve()

/**
 * Remember the preferences; a failed write is said, not thrown (the switch itself worked).
 * Writes go one after another: two renames onto model.json at once can fail on Windows.
 */
function persist() {
  saving = saving.then(async () => {
    try {
      await saveModelPrefs(state.modelPrefs)
    } catch (error) {
      say(`Không lưu được danh sách model yêu thích: ${error instanceof Error ? error.message : String(error)}`, "warning")
    }
  })
  return saving
}

/** Resolves once every preference write started so far has finished (tests clean up after it). */
export const modelPrefsSaved = () => saving

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

  const [manualError, setManualError] = createSignal<string>()

  /**
   * Manual entry is `provider/model-id`, or just `model-id` for the current provider. Input
   * with no model id keeps the dialog open with the reason; nothing is saved.
   */
  function chooseManual(text: string) {
    const value = text.trim()
    if (!value) return setManualError("Nhập model id.")
    const slash = value.indexOf("/")
    const head = slash > 0 ? value.slice(0, slash).trim() : ""
    const connected = head && state.connected.includes(head)
    const model = (connected ? value.slice(slash + 1) : value).trim()
    // "groq/", "/" or "a/": no model id left to save.
    if (!model || model.startsWith("/") || model.endsWith("/")) {
      return setManualError(`Thiếu model id${connected ? ` sau "${head}/"` : ""}. Dạng provider/model-id.`)
    }
    setManualError(undefined)
    if (connected) return choose({ provider: head as ProviderId, model })
    if (state.provider) return choose({ provider: state.provider, model })
    setManualError(`Provider "${head || value}" chưa kết nối. Gõ /connect trước, hoặc dùng ${state.connected.join(", ")}.`)
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
          <Show when={manualError()}>
            <text fg={color.giam} marginTop={1} wrapMode="word">
              {manualError()}
            </text>
          </Show>
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
