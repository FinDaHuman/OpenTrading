import { decodePasteBytes, type KeyBinding, type PasteEvent, type TextareaRenderable } from "@opentui/core"
import { For, Show } from "solid-js"
import type { FieldCount } from "../../../core/memory/notebook/form-model"
import { normalizePaste, PROMPT_CURSOR } from "../../prompt/input"
import { color } from "../../theme"

/**
 * The pieces a notebook form is built from. Text goes into OpenTUI textareas, never through the chat
 * prompt, so nothing typed here reaches the prompt history. A one-line field takes Enter as "next field";
 * a multi-line field takes Enter as a new line. Neither ever saves: only the confirm button does.
 */

/** 1500 → "1.500", as Vietnamese writes thousands. */
export const formatCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")

export const countText = (c: FieldCount) => `${formatCount(c.count)}/${formatCount(c.max)}`

const ONE_LINE_KEYS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "linefeed", action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
]

export function TextBox(props: {
  /** Read once, at mount: the form remounts its fields to load another version. */
  initial: string
  multiline: boolean
  focused: boolean
  placeholder?: string
  onChange: (value: string) => void
  /** Enter in a one-line field. */
  onEnter?: () => void
}) {
  let box: TextareaRenderable | undefined
  return (
    <textarea
      ref={(r: TextareaRenderable) => {
        box = r
        r.setText(props.initial)
        r.gotoBufferEnd()
        setTimeout(() => {
          if (!box || box.isDestroyed) return
          box.cursorStyle = PROMPT_CURSOR
          box.cursorColor = color.tx
        }, 0)
      }}
      minHeight={1}
      maxHeight={props.multiline ? 6 : 3}
      wrapMode="word"
      focused={props.focused}
      placeholder={props.placeholder ?? ""}
      textColor={color.tx}
      focusedTextColor={color.tx}
      backgroundColor={color.panel2}
      focusedBackgroundColor={color.panel2}
      placeholderColor={color.tx3}
      cursorColor={color.tx}
      keyBindings={props.multiline ? undefined : ONE_LINE_KEYS}
      onContentChange={() => props.onChange(box?.plainText ?? "")}
      onSubmit={() => props.onEnter?.()}
      onPaste={(event: PasteEvent) => {
        // Same normalising as the chat prompt (CR-only line ends from ConPTY, tabs), but straight into the field.
        event.preventDefault()
        box?.insertText(normalizePaste(decodePasteBytes(event.bytes)))
      }}
    />
  )
}

/** A field's heading: its label, its count against the limit (red when over), and a hint. */
export function FieldLabel(props: { label: string; focused: boolean; count?: FieldCount; hint?: string }) {
  return (
    <text wrapMode="none">
      <span style={{ fg: props.focused ? color.tang : color.tx2, bold: props.focused }}>
        {(props.focused ? "› " : "  ") + props.label}
      </span>
      <Show when={props.count}>
        {(c) => <span style={{ fg: c().over ? color.giam : color.tx3 }}>{`  ${countText(c())}`}</span>}
      </Show>
      <Show when={props.hint}>
        <span style={{ fg: color.tx3 }}>{`  ${props.hint}`}</span>
      </Show>
    </text>
  )
}

export interface ChoiceOption {
  value: string
  label: string
  /** What the choice means, shown under it (the sorting criteria of /nho). */
  hint?: string
}

/** Options on one line; ←/→, space or the option's number picks. Nothing is chosen until the user picks. */
export function ChoiceRow(props: {
  label: string
  focused: boolean
  options: readonly ChoiceOption[]
  value: string | undefined
  locked?: boolean
  showHints?: boolean
}) {
  return (
    <box flexDirection="column">
      <FieldLabel
        label={props.label}
        focused={props.focused}
        hint={props.locked ? "(không đổi được khi sửa)" : props.focused ? "←/→ hoặc số để chọn" : undefined}
      />
      <Show
        when={props.showHints}
        fallback={
          <text fg={color.tx} wrapMode="word">
            {"    " + props.options.map((o, i) => `${props.value === o.value ? "(•)" : "( )"} ${i + 1}. ${o.label}`).join("   ")}
          </text>
        }
      >
        <For each={props.options}>
          {(o, i) => (
            <text fg={props.value === o.value ? color.tx : color.tx2} wrapMode="word">
              {`    ${props.value === o.value ? "(•)" : "( )"} ${i() + 1}. ${o.label}${o.hint ? ` — ${o.hint}` : ""}`}
            </text>
          )}
        </For>
      </Show>
    </box>
  )
}

export function ButtonRow(props: { buttons: readonly { id: string; label: string; enabled: boolean }[]; focused?: string }) {
  return (
    <text wrapMode="none">
      <For each={props.buttons}>
        {(b) => (
          <span
            style={{
              fg: !b.enabled ? color.tx3 : props.focused === b.id ? color.panel : color.tang,
              bg: props.focused === b.id && b.enabled ? color.tang : undefined,
              bold: props.focused === b.id,
            }}
          >
            {`[ ${b.label} ]  `}
          </span>
        )}
      </For>
    </text>
  )
}

/** Lines of plain text, each wrapped; for notes, lists and warnings. */
export function Lines(props: { lines: readonly string[]; fg?: string }) {
  return (
    <For each={props.lines}>
      {(line) => (
        <text fg={props.fg ?? color.tx2} wrapMode="word">
          {line}
        </text>
      )}
    </For>
  )
}
