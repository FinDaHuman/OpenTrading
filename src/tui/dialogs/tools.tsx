import { useKeys } from "../ui/keys"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { MAX_TOOLS_PER_REQUEST, type ToolRegistry } from "../../core/tools/registry"
import type { ToolDef } from "../../core/tools/types"
import { closeDialog } from "../state"
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
export function ToolsDialog(props: { registry: ToolRegistry }) {
  const [tools, setTools] = createSignal(props.registry.list())
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

  const over = () => tools().length - MAX_TOOLS_PER_REQUEST

  return (
    <Show
      when={detail()}
      fallback={
        <DialogFrame
          title={`Tool · ${tools().length}`}
          subtitle={
            over() > 0
              ? `Model nhận tối đa ${MAX_TOOLS_PER_REQUEST} tool mỗi lần; ${over()} tool của server xếp sau đang bị ẩn — lọc bằng enabledTools (/mcp)`
              : BADGE_LEGEND
          }
          hint="gõ để lọc · ↑↓ chọn · enter xem chi tiết · esc đóng"
        >
          <Picker
            items={sorted().map((t) => ({
              label: t.source?.startsWith("mcp:") && t.source !== "mcp:resources" ? (t.displayName ?? t.name).split(" · ").pop()! : t.name,
              hint: t.description.split("\n")[0],
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
