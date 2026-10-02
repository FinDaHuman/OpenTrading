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
  // Cluster preset tools together so 130+ tools read as groups, not one flat wall.
  const order = new Map([...["market", "scan", "quant", "brief", "intel"]].map((p, i) => [p, i]))

  useKeyboard((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  return (
    <DialogFrame title={`Tools · ${tools().length}`} width={86} hint="gõ để lọc · esc đóng">
      <Picker
        items={tools()
          .slice()
          .sort((a, b) => (order.get(a.presets?.[0] ?? "") ?? 99) - (order.get(b.presets?.[0] ?? "") ?? 99) || a.name.localeCompare(b.name))
          .map((t) => ({
            label: t.name,
            hint: `${t.source ?? "built-in"}${t.presets?.length ? ` · ${t.presets.join("+")}` : ""}${t.readOnly ? " · chỉ đọc" : ""} · ${t.description.split("\n")[0]!.slice(0, 40)}`,
            mark: t.readOnly ? "◇" : "◆",
            value: t.name,
          }))}
        onPick={() => {}}
        rows={12}
      />
    </DialogFrame>
  )
}
