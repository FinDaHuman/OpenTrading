import { useKeyboard } from "@opentui/solid"
import { Show } from "solid-js"
import { closeDialog, pushLine, setState, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

export function toggleSkill(name: string) {
  const skill = state.skills.find((s) => s.name === name)
  if (!skill) return pushLine({ kind: "error", text: `Không có skill "${name}". Gõ /skills để xem danh sách.` })
  const on = !state.activeSkills.includes(name)
  setState("activeSkills", (list) => (on ? [...list, name] : list.filter((n) => n !== name)))
  pushLine({ kind: "info", text: `${on ? "Bật" : "Tắt"} skill ${name}` })
}

export function SkillsDialog() {
  useKeyboard((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })
  return (
    <DialogFrame title="Skills" hint="enter bật/tắt · esc đóng" width={76}>
      <Show when={state.skills.length > 0} fallback={<text fg={color.tx3}>Chưa có skill nào trong thư mục skills/.</text>}>
        <Picker
          items={state.skills.map((s) => ({
            label: s.name,
            hint: s.description,
            mark: state.activeSkills.includes(s.name) ? "●" : "○",
            value: s.name,
          }))}
          onPick={toggleSkill}
        />
      </Show>
    </DialogFrame>
  )
}
