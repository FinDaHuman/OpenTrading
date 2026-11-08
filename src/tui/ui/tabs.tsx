import { For } from "solid-js"
import { color } from "../theme"

export interface Tab<T extends string> {
  id: T
  label: string
}

/**
 * A dialog's tab row, Claude Code's Settings style: the dialog's name in bold, then the tabs, the selected
 * one on the accent colour. The dialog owns the keys (←/→/tab) and says so in its hint line.
 *
 *   Memory   Gợi ý (2)  [Sổ ghi nhớ]  Cài đặt
 */
export function TabRow<T extends string>(props: { title: string; tabs: Tab<T>[]; selected: T }) {
  return (
    <text fg={color.tang} wrapMode="none">
      <span style={{ bold: true }}>{props.title}</span>
      {"  "}
      <For each={props.tabs}>
        {(tab) =>
          tab.id === props.selected ? (
            <span style={{ fg: color.panel, bg: color.tang, bold: true }}>{` ${tab.label} `}</span>
          ) : (
            <span style={{ fg: color.tx2 }}>{` ${tab.label} `}</span>
          )
        }
      </For>
    </text>
  )
}

/** The next tab after a ←/→/tab/shift+tab press, wrapping; undefined for any other key. */
export function nextTab<T extends string>(tabs: readonly T[], current: T, key: { name: string; shift?: boolean }): T | undefined {
  const step = key.name === "right" || (key.name === "tab" && !key.shift) ? 1 : key.name === "left" || (key.name === "tab" && key.shift) ? -1 : 0
  if (!step) return undefined
  const at = Math.max(0, tabs.indexOf(current))
  return tabs[(at + step + tabs.length) % tabs.length]
}
