import { useKeys } from "../ui/keys"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import type { CatalogProvider } from "../../core/catalog"
import { saveConfig } from "../../core/config"
import { EFFORT_SYMBOL, effectiveEffort, effortDetail, supportedEfforts, type Effort } from "../../core/effort"
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

/** A model as effort.ts needs it; undefined when its provider is not in the catalog. */
function targetOf(ref: ModelRef): { provider: CatalogProvider; model: string } | undefined {
  const provider = state.catalog[ref.provider] as CatalogProvider | undefined
  return provider ? { provider, model: ref.model } : undefined
}

type Level = Effort | "auto"

/**
 * The effort step of /model: auto and the levels this model takes. The row the saved effort
 * runs as is highlighted; enter on it before moving keeps the saved value (a saved max stays
 * max on a model that stops at high, as Claude Code's picker writes only once the user moved).
 */
function EffortStep(props: { model: ModelRef; onPick: (effort?: { level: Effort | undefined }) => void }) {
  const target = targetOf(props.model)!
  const levels = supportedEfforts(target)
  const runs = effectiveEffort(target, state.effort)
  const preset: Level = runs ?? "auto"
  let moved = false
  const now = (level: Level) => {
    if (level !== preset) return undefined
    return state.effort && runs !== state.effort ? `đang dùng · ${state.effort} chạy như ${runs} với model này` : "đang dùng"
  }
  const items = (["auto", ...levels] as Level[]).map((level) => ({
    label: level,
    mark: level === "auto" ? " " : EFFORT_SYMBOL[level],
    hint: [now(level), level === "auto" ? "để provider tự chọn" : undefined, level === "xhigh" || level === "max" ? "tốn quota nhanh hơn" : undefined].filter(Boolean).join(" · "),
    right: level === "auto" ? "mặc định của model" : effortDetail(target, level),
    value: level,
  }))
  return (
    <DialogFrame title={`Effort cho ${props.model.model}`} hint="enter lưu model + effort · esc quay lại">
      <Picker<Level>
        items={items}
        onPick={(level) => props.onPick(!moved && level === preset ? undefined : { level: level === "auto" ? undefined : level })}
        onHighlight={() => (moved = true)}
        rows={6}
        placeholder="gõ để lọc…"
        itemKey={(item) => item.value}
        initialKey={preset}
      />
      <text fg={color.tx3} marginTop={1} wrapMode="word">
        Effort cao: model nghĩ lâu hơn, trả lời chậm hơn, tốn token/quota hơn. Đổi sau bằng /effort hoặc ctrl+t; tắt bước này trong /config.
      </text>
    </DialogFrame>
  )
}

/**
 * /model, after opencode's model dialog: ★ favourites, recent models, then each connected
 * provider under its own heading. ctrl+f stars the highlighted model, ←/→ jump between
 * groups, typing filters across all of them (shortcut groups hide meanwhile). Enter on a
 * model with effort levels goes on to {@link EffortStep}; esc there comes back to the list.
 */
export function ModelDialog() {
  const [manual, setManual] = createSignal(false)
  const initialFilter = state.modelFilter
  setState("modelFilter", "")

  const current = () => (state.provider && state.model ? { provider: state.provider, model: state.model } : undefined)
  const items = createMemo(() => modelChoices({ prefs: state.modelPrefs, current: current() }))

  // The list as it was when a model went on to the effort step: esc there comes back to it.
  let listFilter = initialFilter
  let listKey: string | undefined
  const [effortFor, setEffortFor] = createSignal<ModelRef>()

  /**
   * A model with more than one effort level goes on to the effort step first (Codex's
   * reasoning popup; config `ui.askEffort` turns it off); nothing is saved until then.
   */
  function choose(choice: Choice) {
    if (choice === "manual") return setManual(true)
    if (choice.unavailable) return say(`Không dùng được ${choice.model}: ${choice.unavailable}. ctrl+f để bỏ khỏi yêu thích.`, "error")
    const ref: ModelRef = { provider: choice.provider, model: choice.model }
    const target = targetOf(ref)
    if (state.askEffort && target && supportedEfforts(target).length > 1) return setEffortFor(ref)
    return apply(ref)
  }

  /** Switch to `ref`; `effort` only when the user picked a level (undefined = auto). */
  async function apply(ref: ModelRef, effort?: { level: Effort | undefined }) {
    await saveConfig(effort ? { ...ref, effort: effort.level } : ref)
    setState({ provider: ref.provider, model: ref.model, modelPrefs: withRecent(state.modelPrefs, ref), ...(effort ? { effort: effort.level } : {}) })
    void persist()
    const target = targetOf(ref)
    const levels = target ? supportedEfforts(target) : []
    const runs = target && levels.length > 0 ? ` · effort ${effectiveEffort(target, state.effort) ?? "auto"}` : ""
    say(`Model: ${providerName(ref.provider)} · ${ref.model}${runs}`, "success")
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
    if (evt.eventType === "release" || evt.name !== "escape") return
    if (effortFor()) setEffortFor(undefined)
    else if (manual()) setManual(false)
    else closeDialog()
  })

  return (
    <Switch>
      <Match when={state.connected.length === 0}>
        <DialogFrame title="Chọn model" hint="esc đóng">
          <text fg={color.tham}>Chưa kết nối provider nào. Gõ /connect trước.</text>
        </DialogFrame>
      </Match>
      <Match when={effortFor()}>
        {(ref) => <EffortStep model={ref()} onPick={(effort) => void apply(ref(), effort)} />}
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
            onPick={(c) => {
              const item = items().find((i) => i.value === c)
              listKey = item ? choiceKey(item) : "manual"
              void choose(c)
            }}
            rows={14}
            initialFilter={listFilter}
            onFilter={(text) => (listFilter = text)}
            initialKey={listKey}
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
