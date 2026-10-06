import { decodePasteBytes, stripAnsiSequences, type KeyBinding, type PasteEvent, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { color, promptStyle } from "../theme"

/**
 * Enter sends; Shift+Enter, Ctrl+J and Alt/Meta+Enter add a line (opencode, Claude Code).
 * OpenTUI's textarea defaults are the other way round (Enter = newline). Ctrl+Z / Ctrl+Y
 * undo and redo next to the built-in Ctrl+- / Ctrl+. (opencode adds Ctrl+Z on Windows).
 */
export const PROMPT_KEYS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "kpenter", meta: true, action: "newline" },
  { name: "linefeed", action: "newline" },
  // With the kitty keyboard protocol Ctrl+J arrives as ctrl+j, not as a linefeed byte.
  { name: "j", ctrl: true, action: "newline" },
  { name: "z", ctrl: true, action: "undo" },
  { name: "y", ctrl: true, action: "redo" },
]

/** A thin blinking bar, like a document editor, instead of the terminal's block. */
export const PROMPT_CURSOR = { style: "line", blinking: true } as const

/** Pasted text as the prompt keeps it: no escape sequences, "\n" line ends, tabs as 4 spaces. */
export const normalizePaste = (text: string) =>
  stripAnsiSequences(text).replace(/\r\n?/g, "\n").replaceAll("\t", "    ")

/** Tallest the prompt grows before it scrolls (opencode: max(6, a third of the screen)). */
export const promptMaxHeight = (rows: number) => Math.max(6, Math.floor(rows / 3))

/**
 * The message box: wraps long text onto new lines and grows with it, up to a third of the
 * screen. Hidden — never unmounted — while a dialog or prompt covers it, so the draft survives.
 */
export function PromptInput(props: {
  ref: (input: TextareaRenderable) => void
  visible: boolean
  focused: boolean
  busy: boolean
  placeholder: string
  onChange: (text: string) => void
  onSubmit: () => void
  /** Pasted text, already normalised; the caller decides between text, pill and image. */
  onPaste: (text: string) => void
}) {
  const dims = useTerminalDimensions()
  let input: TextareaRenderable | undefined
  return (
    <box
      visible={props.visible}
      marginLeft={2}
      marginRight={2}
      border={["top", "bottom"]}
      borderColor={props.busy ? color.tham : color.tang}
      backgroundColor={color.panel2}
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
    >
      {/* Not selectable: a drag starting on "›" must still count as a selection inside the prompt. */}
      <text fg={props.busy ? color.tham : color.tang} flexShrink={0} selectable={false}>
        {"› "}
      </text>
      <textarea
        ref={(r: TextareaRenderable) => {
          input = r
          props.ref(r)
          // opencode sets these once more after mount: the constructor default (block) can win.
          setTimeout(() => {
            if (!input || input.isDestroyed) return
            input.cursorStyle = PROMPT_CURSOR
            input.cursorColor = color.tx
          }, 0)
        }}
        flexGrow={1}
        minHeight={1}
        maxHeight={promptMaxHeight(dims().height)}
        wrapMode="word"
        focused={props.focused}
        placeholder={props.placeholder}
        textColor={color.tx}
        focusedTextColor={color.tx}
        backgroundColor={color.panel2}
        focusedBackgroundColor={color.panel2}
        placeholderColor={color.tx3}
        cursorColor={color.tx}
        cursorStyle={PROMPT_CURSOR}
        keyBindings={PROMPT_KEYS}
        // Styles the paste/image pills (extmark.paste).
        syntaxStyle={promptStyle()}
        // The Solid typing says string, the core passes {}: read the text from the renderable.
        onContentChange={() => props.onChange(input?.plainText ?? "")}
        onSubmit={() => props.onSubmit()}
        onPaste={(event: PasteEvent) => {
          // ConPTY (Windows Terminal) can paste CR-only line ends; tabs become spaces (Claude Code).
          event.preventDefault()
          props.onPaste(normalizePaste(decodePasteBytes(event.bytes)))
        }}
      />
    </box>
  )
}
