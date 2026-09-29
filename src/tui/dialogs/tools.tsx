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

  useKeyboard((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })

  return (
    <DialogFrame title={`Tools · ${tools().length}`} width={86} hint="gõ để lọc · esc đóng">
      <Picker
        items={tools().map((t) => ({
          label: t.name,
          hint: `${t.source ?? "built-in"}${t.readOnly ? " · chỉ đọc" : ""} · ${t.description.split("\n")[0]!.slice(0, 50)}`,
          mark: t.readOnly ? "◇" : "◆",
          value: t.name,
        }))}
        onPick={() => {}}
        rows={12}
      />
    </DialogFrame>
  )
}
