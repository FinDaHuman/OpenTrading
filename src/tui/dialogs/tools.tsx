import { useKeys } from "../ui/keys"
import { createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import { previewContext } from "../../core/agent"
import type { Runtime } from "../../core/runtime"
import { MAX_TOOLS_PER_REQUEST, type ToolRegistry } from "../../core/tools/registry"
import type { ToolDef } from "../../core/tools/types"
import { closeDialog, state } from "../state"
import { color } from "../theme"
import { BADGE_LEGEND, toolBadge, toolMark } from "../ui/badges"
import { ToolDetail } from "../ui/tool-detail"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

/** Where a tool comes from, as a heading: built-in, memory, or one MCP server. */
export function toolGroup(t: ToolDef) {
  const source = t.source ?? ""
  if (source === "mcp:resources") return "MCP · tài nguyên"
  if (source.startsWith("mcp:")) return `MCP · ${source.slice(4)}`
  if (source.startsWith("memory:")) return "Memory"
  return "Có sẵn"
}

const GROUP_ORDER = (g: string) => (g === "Có sẵn" ? 0 : g === "Memory" ? 1 : g.startsWith("MCP · tài nguyên") ? 3 : 2)

/** Every tool the model can call right now, grouped by source; enter shows one tool. */
export function ToolsDialog(props: { registry: ToolRegistry; runtime?: Runtime }) {
  const [tools, setTools] = createSignal(props.registry.list())
  // Tool search state for the current model: which tools go out by name only, which are loaded.
  const [search] = createResource(tools, () =>
    previewContext({
      input: "",
      skills: state.skills,
      sticky: state.activeSkills,
      prevClock: state.clock,
      history: state.history,
      registry: props.registry,
      memory: props.runtime?.memory,
    }).catch(() => undefined),
  )
  const deferred = () => new Set(search()?.deferred ?? [])
  const loaded = () => new Set(search()?.loaded ?? [])
  const [open, setOpen] = createSignal<string>()
  onCleanup(props.registry.onChange(() => setTools(props.registry.list())))

  const sorted = createMemo(() =>
    [...tools()].sort((a, b) => {
      const ga = toolGroup(a)
      const gb = toolGroup(b)
      return GROUP_ORDER(ga) - GROUP_ORDER(gb) || ga.localeCompare(gb) || a.name.localeCompare(b.name)
    }),
  )
  const detail = () => tools().find((t) => t.name === open())

  useKeys((evt) => {
    if (evt.eventType === "release" || evt.name !== "escape") return
    if (open()) setOpen(undefined)
    else closeDialog()
  })

  const over = () => tools().length - deferred().size - MAX_TOOLS_PER_REQUEST
  const subtitle = () => {
    if (over() > 0) return `Model nhận tối đa ${MAX_TOOLS_PER_REQUEST} tool mỗi lần; ${over()} tool của server xếp sau đang bị ẩn — lọc bằng enabledTools (/mcp)`
    if (deferred().size > 0) {
      const used = loaded().size > 0 ? ` · ${loaded().size} đã nạp` : ""
      return `${deferred().size} tool hoãn: model chỉ thấy tên, tự nạp bằng tool_search${used} · đổi trong /config`
    }
    return BADGE_LEGEND
  }
  const state_ = (t: ToolDef) => (deferred().has(t.name) ? "hoãn · " : loaded().has(t.name) ? "đã nạp · " : "")

  return (
    <Show
      when={detail()}
      fallback={
        <DialogFrame
          title={`Tool · ${tools().length}`}
          subtitle={subtitle()}
          hint="gõ để lọc · ↑↓ chọn · enter xem chi tiết · esc đóng"
        >
          <Picker
            items={sorted().map((t) => ({
              label: t.source?.startsWith("mcp:") && t.source !== "mcp:resources" ? (t.displayName ?? t.name).split(" · ").pop()! : t.name,
              hint: state_(t) + t.description.split("\n")[0],
              mark: toolMark(t).mark,
              markColor: toolMark(t).fg,
              right: toolBadge(t).text,
              rightColor: toolBadge(t).fg,
              group: toolGroup(t),
              value: t.name,
            }))}
            onPick={setOpen}
            rows={14}
          />
        </DialogFrame>
      }
    >
      {(t) => (
        <DialogFrame title="Chi tiết tool" hint="esc quay lại">
          <ToolDetail tool={t()} server={toolGroup(t())} />
        </DialogFrame>
      )}
    </Show>
  )
}
