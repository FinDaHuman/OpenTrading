import { createMemo, For, Show } from "solid-js"
import type { CommandInfo } from "./commands"
import { color } from "./theme"

/** At most this many rows are shown; the window follows the highlighted row. */
export const SUGGESTION_ROWS = 8

/**
 * Slash-command suggestions above the prompt.
 *
 * The panel and every row are `flexShrink={0}`: when the screen is short, flexbox used to
 * squeeze this panel below its content height and rows were laid out on the same line —
 * "/new" drawn over "/sessions" read as "/newsions". Now the transcript above shrinks
 * instead, and the list is capped to a scrolling window.
 */
export function Suggestions(props: { items: CommandInfo[]; selected: number }) {
  const start = createMemo(() =>
    Math.max(0, Math.min(props.selected - Math.floor(SUGGESTION_ROWS / 2), props.items.length - SUGGESTION_ROWS)),
  )
  const visible = createMemo(() => props.items.slice(start(), start() + SUGGESTION_ROWS))
  const hiddenAbove = () => start()
  const hiddenBelow = () => Math.max(0, props.items.length - start() - SUGGESTION_ROWS)

  return (
    <box flexDirection="column" flexShrink={0} marginLeft={3} marginRight={3} backgroundColor={color.panel} paddingLeft={1}>
      <For each={visible()}>
        {(c, i) => {
          const active = () => start() + i() === props.selected
          return (
            <box flexDirection="row" flexShrink={0} height={1} backgroundColor={active() ? color.rule : color.panel}>
              <text fg={color.tang} width={18} flexShrink={0} wrapMode="none">
                {`${active() ? "▸" : " "} /${c.name}${c.args ? ` ${c.args}` : ""}`}
              </text>
              <text fg={color.tx3} flexGrow={1} flexShrink={1} wrapMode="none">
                {c.description}
              </text>
              <text fg={color.tx3} flexShrink={0} wrapMode="none">
                {active() ? " tab ↹ " : ""}
              </text>
            </box>
          )
        }}
      </For>
      <Show when={hiddenAbove() + hiddenBelow() > 0}>
        <text fg={color.tx3} flexShrink={0} height={1}>
          {`  ↑↓ ${props.selected + 1}/${props.items.length}${hiddenBelow() > 0 ? ` · còn ${hiddenBelow()} lệnh bên dưới` : ""}`}
        </text>
      </Show>
    </box>
  )
}
