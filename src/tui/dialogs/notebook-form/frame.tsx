import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import type { FieldCount } from "../../../core/memory/notebook/form-model"
import { useKeys } from "../../ui/keys"
import { blocked, closeDialog, setState, state } from "../../state"
import { color } from "../../theme"
import { DialogFrame } from "../frame"
import { ButtonRow, ChoiceRow, FieldLabel, Lines, TextBox, type ChoiceOption } from "./fields"

/**
 * The frame every notebook form shares: title, "đang sửa từ bản N", fields, counts, warnings, buttons, and
 * the questions a save may need (warnings to accept, changes to review, a conflict). Keys: Tab / Shift+Tab
 * move, a number picks an option or a choice, Enter on a button presses it. Esc, and Ctrl+C (which the app
 * turns into `notebookFormAskLeave`), close at once when nothing changed and ask first otherwise.
 * The fields, notes and messages scroll; the title and the buttons always stay on screen, and the focused
 * field is scrolled into view, so a long form works in a short terminal.
 */

export interface FormField {
  id: string
  label: string
  kind: "line" | "text" | "choice"
  /** Text fields: the value at mount (the form remounts its fields to load another version). */
  initial?: string
  onChange?: (value: string) => void
  placeholder?: string
  /** Enter in a one-line field; by default it moves to the next field. */
  onEnter?: () => void
  options?: readonly ChoiceOption[]
  value?: string
  onPick?: (value: string) => void
  /** Shown, not focusable (the section of an entry being edited). */
  locked?: boolean
  showHints?: boolean
  count?: FieldCount
  hint?: string
}

export interface FormButton {
  id: string
  label: string
  enabled: boolean
  run: () => void
}

export interface StepChoice {
  label: string
  /** Omitted: back to the form. */
  run?: () => void
}

/** A question that takes the frame over until answered; the draft stays as it is. */
export interface FormStep {
  title: string
  lines?: readonly string[]
  body?: () => JSX.Element
  choices: readonly StepChoice[]
  /** The choice Enter picks (index); the first by default. */
  enterPicks?: number
  accent?: string
}

export function createFormUi() {
  const [step, setStep] = createSignal<FormStep>()
  const [error, setError] = createSignal<string>()
  const [generation, setGeneration] = createSignal(0)
  return {
    step,
    setStep,
    error,
    setError,
    generation,
    /** Remount the text fields, after the draft was replaced (another version loaded). */
    reload: () => setGeneration((g) => g + 1),
  }
}
export type FormUi = ReturnType<typeof createFormUi>

/**
 * Rows the scrolling part leaves for everything else on screen: the app's status lines, the dialog's rule,
 * title, subtitle, hint and margins, and the button row.
 */
const CHROME_ROWS = 16

const isEnter = (evt: KeyEvent) => evt.name === "return" || evt.name === "kpenter"
const digit = (evt: KeyEvent) => (/^[1-9]$/.test(evt.sequence ?? "") && !evt.ctrl && !evt.meta ? Number(evt.sequence) : 0)

export function FormFrame(props: {
  ui: FormUi
  title: string
  subtitle?: string
  /** Fixed lines above the fields (where a decision is kept, a renamed code). */
  notes?: readonly string[]
  fields: readonly FormField[]
  /** Lines under the fields: lists, limits in force, the reason the confirm button is off. */
  info?: readonly string[]
  /** Red lines: why the form cannot be confirmed now. */
  problems?: readonly string[]
  /** Yellow lines: warnings that do not block. */
  warnings?: readonly string[]
  buttons: readonly FormButton[]
  dirty: boolean
}) {
  const [focus, setFocus] = createSignal<string>()
  const [asking, setAsking] = createSignal(false)
  const focusable = createMemo(() => [
    ...props.fields.filter((f) => !f.locked).map((f) => f.id),
    ...props.buttons.map((b) => b.id),
  ])
  const focused = createMemo(() => {
    const ids = focusable()
    const at = focus()
    return at !== undefined && ids.includes(at) ? at : ids[0]
  })
  const move = (by: number) => {
    const ids = focusable()
    const at = Math.max(0, ids.indexOf(focused() ?? ""))
    setFocus(ids[(at + by + ids.length) % ids.length])
  }
  const typing = () => !props.ui.step() && !asking() && !blocked()
  const fieldIds = createMemo(() => props.fields.map((f) => f.id))
  const field = (id: string) => props.fields.find((f) => f.id === id)

  const dims = useTerminalDimensions()
  let scroll: ScrollBoxRenderable | undefined
  const rowId = (id: string) => `notebook-field-${id}`
  // After layout (positions are known only once the frame is laid out): the focused field into view.
  createEffect(() => {
    const at = focused()
    props.ui.generation()
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed || !at) return
      if (props.fields.some((f) => f.id === at)) scroll.scrollChildIntoView(rowId(at))
    }, 0)
  })

  createEffect(() => setState("notebookFormDirty", props.dirty))
  // Ctrl+C reaches the app first: on a changed form it sets this flag instead of closing.
  createEffect(() => {
    if (!state.notebookFormAskLeave) return
    setState("notebookFormAskLeave", false)
    setAsking(true)
  })
  onCleanup(() => setState({ notebookFormDirty: false, notebookFormAskLeave: false }))

  const leave = () => (props.dirty ? setAsking(true) : closeDialog())

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (asking()) {
      evt.preventDefault()
      // Enter keeps the draft: dropping it takes the explicit "1".
      if (digit(evt) === 1) return closeDialog()
      if (digit(evt) === 2 || isEnter(evt) || evt.name === "escape") return setAsking(false)
      return
    }
    const step = props.ui.step()
    if (step) {
      const n = digit(evt) || (isEnter(evt) ? (step.enterPicks ?? 0) + 1 : 0)
      if (n > 0 || evt.name === "escape") evt.preventDefault()
      const choice = evt.name === "escape" ? step.choices.at(-1) : step.choices[n - 1]
      if (!choice) return
      props.ui.setStep(undefined)
      return choice.run?.()
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      return move(evt.shift ? -1 : 1)
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      return leave()
    }
    const at = focused()
    const f = at ? field(at) : undefined
    if (f?.kind === "choice" && f.options && !f.locked) {
      const opts = f.options
      const now = opts.findIndex((o) => o.value === f.value)
      let pick = -1
      if (digit(evt) > 0 && digit(evt) <= opts.length) pick = digit(evt) - 1
      else if (evt.name === "right" || evt.name === "space") pick = (now + 1) % opts.length
      else if (evt.name === "left") pick = now <= 0 ? opts.length - 1 : now - 1
      if (pick >= 0) {
        evt.preventDefault()
        f.onPick?.(opts[pick]!.value)
      }
      return
    }
    const button = props.buttons.find((b) => b.id === at)
    if (button && isEnter(evt)) {
      evt.preventDefault()
      if (button.enabled) {
        props.ui.setError(undefined)
        button.run()
      }
    }
  })

  return (
    <DialogFrame
      title={props.title}
      subtitle={props.subtitle}
      accent={props.ui.step()?.accent}
      hint={
        asking() || props.ui.step()
          ? "số để chọn · esc: lựa chọn cuối"
          : "tab/shift+tab chuyển ô · số chọn ngăn · enter trên nút để bấm · esc đóng"
      }
    >
      <Switch>
        <Match when={asking()}>
          <text fg={color.tham}>Bỏ nội dung đang sửa?</text>
          <text fg={color.tx}>{"[1] Bỏ   [2] Sửa tiếp"}</text>
        </Match>
        <Match when={props.ui.step()}>
          {(step) => (
            <box flexDirection="column">
              <text fg={step().accent ?? color.tx} wrapMode="word">
                {step().title}
              </text>
              <Lines lines={step().lines ?? []} fg={color.tham} />
              {step().body?.()}
              <text fg={color.tx} marginTop={1} wrapMode="word">
                {step()
                  .choices.map((c, i) => `[${i + 1}] ${c.label}`)
                  .join("   ")}
              </text>
            </box>
          )}
        </Match>
        <Match when={true}>
          <scrollbox
            ref={(r: ScrollBoxRenderable) => (scroll = r)}
            // A fixed cap instead of shrinking: a shrinking child would squeeze the frame's title rows too.
            flexShrink={0}
            maxHeight={Math.max(4, dims().height - CHROME_ROWS)}
            scrollY
            backgroundColor={color.panel}
          >
          <Lines lines={props.notes ?? []} fg={color.tham} />
          <Show when={props.ui.generation() + 1} keyed>
            <For each={fieldIds()}>
              {(id) => {
                const f = () => field(id)
                return (
                  <Show when={f()}>
                    {(get) => (
                      <box id={rowId(id)} flexDirection="column" marginTop={get().kind === "choice" ? 1 : 0}>
                        <Show
                          when={get().kind === "choice"}
                          fallback={
                            <>
                              <FieldLabel label={get().label} focused={focused() === id} count={get().count} hint={get().hint} />
                              <box paddingLeft={4}>
                                <TextBox
                                  initial={get().initial ?? ""}
                                  multiline={get().kind === "text"}
                                  focused={typing() && focused() === id}
                                  placeholder={get().placeholder}
                                  onChange={(v) => get().onChange?.(v)}
                                  onEnter={() => (get().onEnter ? get().onEnter!() : move(1))}
                                />
                              </box>
                            </>
                          }
                        >
                          <ChoiceRow
                            label={get().label}
                            focused={focused() === id}
                            options={get().options ?? []}
                            value={get().value}
                            locked={get().locked}
                            showHints={get().showHints}
                          />
                        </Show>
                      </box>
                    )}
                  </Show>
                )
              }}
            </For>
          </Show>
          <box flexDirection="column" marginTop={1}>
            <Lines lines={props.info ?? []} />
            <Lines lines={props.problems ?? []} fg={color.giam} />
            <Lines lines={props.warnings ?? []} fg={color.tham} />
            <Show when={props.ui.error()}>{(e) => <Lines lines={[e()]} fg={color.giam} />}</Show>
          </box>
          </scrollbox>
          <box marginTop={1} flexShrink={0}>
            <ButtonRow buttons={props.buttons} focused={focused()} />
          </box>
        </Match>
      </Switch>
    </DialogFrame>
  )
}
