import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import type { CommandInfo } from "./commands"
import { color } from "./theme"
import { truncate, width as cells } from "./ui/text"

/** At most this many rows are shown; the window follows the highlighted row. */
export const SUGGESTION_ROWS = 8

/** One row: a name column and a description. */
export interface SuggestionItem {
  label: string
  description: string
}

export const commandItem = (c: CommandInfo): SuggestionItem => ({ label: `/${c.name}${c.args ? ` ${c.args}` : ""}`, description: c.description })

/**
 * The "/" list above the prompt, after Claude Code's footer suggestions: one line per
 * command, a name column as wide as the longest name of *all* commands (so it does not
 * jump while filtering, capped at 40% of the width), the description cut with "…". The
 * `@` file list uses it too (`all` = what is shown, `hint` its own keys).
 *
 * The panel and every row are `flexShrink={0}`: when the screen is short, flexbox used to
 * squeeze this panel below its content height and rows were laid out on the same line —
 * "/new" drawn over "/sessions" read as "/newsions". The transcript above shrinks instead.
 */
export function Suggestions(props: { items: SuggestionItem[]; all: SuggestionItem[]; selected: number; hint?: string; noun?: string; note?: string }) {
  const dims = useTerminalDimensions()
  const start = createMemo(() =>
    Math.max(0, Math.min(props.selected - Math.floor(SUGGESTION_ROWS / 2), props.items.length - SUGGESTION_ROWS)),
  )
  const visible = createMemo(() => props.items.slice(start(), start() + SUGGESTION_ROWS))
  const hiddenBelow = () => Math.max(0, props.items.length - start() - SUGGESTION_ROWS)
  const inner = () => Math.max(20, dims().width - 8)
  const nameWidth = createMemo(() => Math.min(Math.max(...props.all.map((c) => cells(c.label))) + 2, Math.floor(inner() * (props.noun ? 0.7 : 0.4))))
  const descWidth = () => Math.max(0, inner() - 2 - nameWidth())

  return (
    <box flexDirection="column" flexShrink={0} marginLeft={2} marginRight={2} backgroundColor={color.panel} paddingLeft={1} paddingRight={1}>
      <For each={visible()}>
        {(c, i) => {
          const active = () => start() + i() === props.selected
          const name = () => truncate(c.label, nameWidth() - 1)
          return (
            <box flexDirection="row" flexShrink={0} height={1}>
              <text fg={active() ? color.tang : color.tx3} width={2} flexShrink={0}>
                {active() ? "❯ " : "  "}
              </text>
              <text flexGrow={1} flexShrink={1} overflow="hidden" wrapMode="none">
                <span style={{ fg: active() ? color.tang : color.tx2, bold: active() }}>
                  {name() + " ".repeat(Math.max(0, nameWidth() - cells(name())))}
                </span>
                <span style={{ fg: active() ? color.tx2 : color.tx3 }}>{truncate(c.description, descWidth())}</span>
              </text>
            </box>
          )
        }}
      </For>
      <Show when={props.note}>
        <text fg={color.tx3} flexShrink={0} height={1} wrapMode="none">
          {`  ${truncate(props.note!, inner() - 2)}`}
        </text>
      </Show>
      <text fg={color.tx3} flexShrink={0} height={1} wrapMode="none">
        {`  ${props.hint ?? "↑↓ chọn · enter chạy · tab điền · esc đóng"}${props.items.length > SUGGESTION_ROWS ? ` · ${props.selected + 1}/${props.items.length}${hiddenBelow() > 0 ? ` · còn ${hiddenBelow()} ${props.noun ?? "lệnh"}` : ""}` : ""}`}
      </text>
    </box>
  )
}

/** After "/name ": what the command expects, like Claude Code's argument hint. */
export function ArgumentHint(props: { command: CommandInfo }) {
  return (
    <box flexShrink={0} marginLeft={2} marginRight={2} paddingLeft={1} height={1}>
      <text wrapMode="none">
        <span style={{ fg: color.tang }}>{`/${props.command.name} `}</span>
        <span style={{ fg: color.tham }}>{props.command.args}</span>
        <span style={{ fg: color.tx3 }}>{`  ${truncate(props.command.description, 60)}`}</span>
      </text>
    </box>
  )
}
