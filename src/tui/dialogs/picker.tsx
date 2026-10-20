import { useTerminalDimensions } from "@opentui/solid"
import { useKeys } from "../ui/keys"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import type { KeyEvent } from "@opentui/core"
import { blocked } from "../state"
import { color } from "../theme"
import { pad, rank, truncate, width as cells } from "../ui/text"

export interface PickerItem<T> {
  label: string
  hint?: string
  /** One-cell glyph before the label (◇ ◆ ● …). */
  mark?: string
  markColor?: string
  /** Fixed column after the description (e.g. a "[ghi]" label), padded so it lines up. */
  right?: string
  rightColor?: string
  /** Items with the same group are shown under one heading (in the order given). */
  group?: string
  /** A shortcut row (favourites, recent): hidden while filtering, its item is listed anyway. */
  shortcut?: boolean
  value: T
}

/** Rows a list may use: a short terminal must still show the prompt and the panel frame. */
export function listRows(terminalHeight: number, wanted = 12) {
  return Math.max(4, Math.min(wanted, terminalHeight - 14))
}

/**
 * Filterable list. Every row is exactly one line — the lesson from opencode's
 * dialog-select: fixed cells never shrink, the label is padded to a shared column, and the
 * description is cut with "…" to the room that is left, so nothing wraps mid-word and
 * the columns stay straight. Type to filter (accent-insensitive), ↑↓ (wrapping) /
 * pgup / pgdn to move, enter to pick.
 */
export function Picker<T>(props: {
  items: PickerItem<T>[]
  onPick: (value: T) => void
  placeholder?: string
  rows?: number
  initialFilter?: string
  /** Called when the highlighted item changes (for previews). */
  onHighlight?: (value: T | undefined) => void
  /** Row identity: the highlight stays on the same row when the list changes (ctrl+f…). */
  itemKey?: (item: PickerItem<T>) => string
  /** Extra keys; return true when handled. Runs before the picker's own. */
  onKey?: (evt: KeyEvent, highlighted: T | undefined) => boolean | void
  /** ←/→ jump to the previous/next group while the filter is empty. */
  groupJump?: boolean
}) {
  const dims = useTerminalDimensions()
  const [filter, setFilter] = createSignal(props.initialFilter ?? "")
  const [index, setIndex] = createSignal(0)
  const rows = () => listRows(dims().height, props.rows ?? 12)

  const visible = createMemo(() =>
    rank(
      filter() ? props.items.filter((i) => !i.shortcut) : props.items,
      filter(),
      (i) => i.label,
      (i) => `${i.hint ?? ""} ${i.group ?? ""}`,
    ),
  )
  // Keep the highlight on the same row when the items change under it (a favourite toggled).
  let highlightedKey: string | undefined
  let seenFilter = filter()
  createEffect(
    on(visible, (list) => {
      // Typing moves to the best match (onInput); only a change of the items keeps the row.
      if (filter() !== seenFilter) return void (seenFilter = filter())
      if (!props.itemKey || highlightedKey === undefined) return
      const at = list.findIndex((i) => props.itemKey!(i) === highlightedKey)
      setIndex(at >= 0 ? at : Math.max(0, Math.min(index(), list.length - 1)))
    }),
  )
  createEffect(() => {
    const item = visible()[index()]
    highlightedKey = item && props.itemKey ? props.itemKey(item) : undefined
  })
  /** Index of the first item of each group, in order (only while not filtering). */
  const groupStarts = () => {
    const starts: number[] = []
    visible().forEach((item, i) => {
      if (i === 0 || item.group !== visible()[i - 1]!.group) starts.push(i)
    })
    return starts
  }
  const clamp = (i: number) => Math.max(0, Math.min(visible().length - 1, i))
  const wrap = (i: number) => (visible().length === 0 ? 0 : (i + visible().length) % visible().length)

  /** Display lines: group headings (only while not filtering) and items. */
  const lines = createMemo(() => {
    const out: ({ heading: string } | { item: PickerItem<T>; at: number })[] = []
    let group: string | undefined
    visible().forEach((item, at) => {
      if (!filter() && item.group !== undefined && item.group !== group) {
        group = item.group
        out.push({ heading: item.group })
      }
      out.push({ item, at })
    })
    return out
  })
  const windowed = createMemo(() => {
    const all = lines()
    const selectedLine = all.findIndex((l) => "item" in l && l.at === index())
    const start = Math.max(0, Math.min(selectedLine - Math.floor(rows() / 2), all.length - rows()))
    return all.slice(start, start + rows())
  })

  // Column math: pane = terminal width − 4 (padding); row = gutter 2 + mark 2 + label + gap 2 + hint + right.
  const inner = () => Math.max(20, dims().width - 4)
  const labelWidth = createMemo(() => {
    const longest = Math.max(0, ...props.items.map((i) => cells(i.label)))
    return Math.min(longest, Math.max(12, Math.floor(inner() * 0.4)))
  })
  const rightWidth = createMemo(() => Math.max(0, ...props.items.map((i) => (i.right ? cells(i.right) + 2 : 0))))
  const hintWidth = () => Math.max(0, inner() - 4 - labelWidth() - 2 - rightWidth())

  const highlight = (i: number) => {
    setIndex(i)
    props.onHighlight?.(visible()[i]?.value)
  }

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (props.onKey?.(evt, visible()[index()]?.value)) return
    if (props.groupJump && !filter() && (evt.name === "left" || evt.name === "right")) {
      evt.preventDefault()
      const starts = groupStarts()
      const current = starts.findLast((s) => s <= index()) ?? 0
      const target = evt.name === "right" ? starts.find((s) => s > index()) : starts.findLast((s) => s < current)
      if (target !== undefined) highlight(target)
      return
    }
    if (evt.name === "up") highlight(wrap(index() - 1))
    else if (evt.name === "down") highlight(wrap(index() + 1))
    else if (evt.name === "pageup") highlight(clamp(index() - rows()))
    else if (evt.name === "pagedown") highlight(clamp(index() + rows()))
  })

  return (
    <box flexDirection="column">
      <box flexDirection="row" marginBottom={1} height={1} flexShrink={0}>
        <text fg={color.tang} flexShrink={0}>
          {"› "}
        </text>
        <input
          flexGrow={1}
          focused={!blocked()}
          value={props.initialFilter ?? ""}
          placeholder={props.placeholder ?? "gõ để lọc…"}
          textColor={color.tx}
          focusedTextColor={color.tx}
          backgroundColor={color.panel}
          focusedBackgroundColor={color.panel}
          onInput={(v) => {
            setFilter(v)
            highlight(0)
          }}
          onSubmit={() => {
            const item = visible()[index()]
            if (item) props.onPick(item.value)
          }}
        />
      </box>
      <Show when={visible().length > 0} fallback={<text fg={color.tx3}>Không có kết quả.</text>}>
        <For each={windowed()}>
          {(line) =>
            "heading" in line ? (
              <text fg={color.tx2} height={1} wrapMode="none">
                <span style={{ bold: true }}>{`  ${line.heading}`}</span>
              </text>
            ) : (
              (() => {
                const selected = () => line.at === index()
                const item = line.item
                const label = () => truncate(item.label, labelWidth())
                return (
                  <box flexDirection="row" height={1} flexShrink={0} backgroundColor={selected() ? color.rule : undefined}>
                    <text fg={color.tang} width={2} flexShrink={0} selectable={false}>
                      {selected() ? "❯ " : "  "}
                    </text>
                    <text fg={item.markColor ?? color.tang} width={2} flexShrink={0} selectable={false}>
                      {item.mark ?? " "}
                    </text>
                    <text flexGrow={1} flexShrink={1} overflow="hidden" wrapMode="none">
                      <span style={{ fg: selected() ? color.tx : color.tx2, bold: selected() }}>
                        {label() + " ".repeat(Math.max(0, labelWidth() - cells(label())))}
                      </span>
                      <span style={{ fg: color.tx3 }}>{item.hint ? `  ${truncate(item.hint, hintWidth())}` : ""}</span>
                    </text>
                    <Show when={rightWidth() > 0}>
                      <text fg={item.rightColor ?? color.tx3} flexShrink={0} wrapMode="none" selectable={false}>
                        {`  ${pad(item.right ?? "", rightWidth() - 2)}`}
                      </text>
                    </Show>
                  </box>
                )
              })()
            )
          }
        </For>
        <Show when={visible().length > rows()}>
          <text fg={color.tx3} height={1}>
            {`  ${index() + 1}/${visible().length}`}
          </text>
        </Show>
      </Show>
    </box>
  )
}
