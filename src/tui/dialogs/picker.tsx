import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { color } from "../theme"

export interface PickerItem<T> {
  label: string
  hint?: string
  mark?: string
  value: T
}

/** Filterable list: type to filter, ↑↓ / pgup / pgdn to move, enter to pick. */
export function Picker<T>(props: {
  items: PickerItem<T>[]
  onPick: (value: T) => void
  placeholder?: string
  rows?: number
  initialFilter?: string
}) {
  const [filter, setFilter] = createSignal(props.initialFilter ?? "")
  const [index, setIndex] = createSignal(0)
  const rows = () => props.rows ?? 10

  const visible = createMemo(() => {
    const q = filter().toLowerCase()
    return q ? props.items.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(q)) : props.items
  })
  const clamp = (i: number) => Math.max(0, Math.min(visible().length - 1, i))
  const start = createMemo(() => Math.max(0, Math.min(index() - Math.floor(rows() / 2), visible().length - rows())))
  const page = createMemo(() => visible().slice(start(), start() + rows()))

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "up") setIndex((i) => clamp(i - 1))
    else if (evt.name === "down") setIndex((i) => clamp(i + 1))
    else if (evt.name === "pageup") setIndex((i) => clamp(i - rows()))
    else if (evt.name === "pagedown") setIndex((i) => clamp(i + rows()))
  })

  return (
    <box flexDirection="column">
      <box flexDirection="row" marginBottom={1}>
        <text fg={color.tang}>{"⌕ "}</text>
        <input
          flexGrow={1}
          focused
          value={props.initialFilter ?? ""}
          placeholder={props.placeholder ?? "gõ để lọc…"}
          textColor={color.tx}
          focusedTextColor={color.tx}
          backgroundColor={color.panel}
          focusedBackgroundColor={color.panel}
          onInput={(v) => {
            setFilter(v)
            setIndex(0)
          }}
          onSubmit={() => {
            const item = visible()[index()]
            if (item) props.onPick(item.value)
          }}
        />
      </box>
      <Show when={visible().length > 0} fallback={<text fg={color.tx3}>Không có kết quả.</text>}>
        <For each={page()}>
          {(item, i) => {
            const selected = () => start() + i() === index()
            return (
              <box flexDirection="row" backgroundColor={selected() ? color.rule : undefined}>
                <text fg={selected() ? color.tang : color.tx3}>{selected() ? "▸ " : "  "}</text>
                <text fg={color.tang} width={2}>
                  {item.mark ?? " "}
                </text>
                <text fg={selected() ? color.tx : color.tx2} flexShrink={0}>
                  {item.label}
                </text>
                <Show when={item.hint}>
                  <text fg={color.tx3} marginLeft={2}>
                    {item.hint}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={visible().length > rows()}>
          <text fg={color.tx3}>
            {`  ${index() + 1}/${visible().length}`}
          </text>
        </Show>
      </Show>
    </box>
  )
}
