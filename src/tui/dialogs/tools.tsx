import { useKeyboard } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import type { ToolRegistry } from "../../core/tools/registry"
import { closeDialog } from "../state"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

/** Every tool the model can call right now: built-in ones and those from MCP servers. */
export function ToolsDialog(props: { registry: ToolRegistry }) {
  const [tools, setTools] = createSignal(props.registry.list())
  onCleanup(props.registry.onChange(() => setTools(props.registry.list())))
  // Group MCP tools by server source so 130+ tools read as groups, not one flat wall.
  const order = new Map(["mcp:opentrading"].map((p, i) => [p, i]))

  useKeyboard((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  return (
    <DialogFrame title={`Tools · ${tools().length}`} width={86} hint="gõ để lọc · esc đóng">
      <Picker
        items={tools()
          .slice()
          .sort((a, b) => (order.get(a.source ?? "") ?? 99) - (order.get(b.source ?? "") ?? 99) || a.name.localeCompare(b.name))
          .map((t) => ({
            label: t.name,
            hint: `${t.source ?? "built-in"}${t.readOnly ? " · chỉ đọc" : ""} · ${t.description.split("\n")[0]!.slice(0, 40)}`,
            mark: t.readOnly ? "◇" : "◆",
            value: t.name,
          }))}
        onPick={() => {}}
        rows={12}
      />
    </DialogFrame>
  )
}
