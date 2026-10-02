import { useKeys } from "../ui/keys"
import { For, Show } from "solid-js"
import { closeDialog, pushLine, setState, state } from "../state"
import { color } from "../theme"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

const ACTIVATION: Record<string, string> = {
  auto: "model tự chọn",
  always: "luôn bật",
  manual: "bật tay",
}

/**
 * /skill <name>: pin a skill for the whole session ("sticky"): its instructions ride along
 * with every request until switched off. Always-on skills are already in every request.
 */
export function toggleSkill(name: string) {
  const skill = state.skills.find((s) => s.name === name)
  if (!skill) return pushLine({ kind: "error", text: `Không có skill "${name}". Gõ /skills để xem danh sách.` })
  if (skill.activation === "always") return pushLine({ kind: "info", text: `Skill ${name} luôn bật sẵn.` })
  const on = !state.activeSkills.includes(name)
  setState("activeSkills", (list) => (on ? [...list, name] : list.filter((n) => n !== name)))
  pushLine({ kind: "info", text: `${on ? "Bật" : "Tắt"} skill ${name} cho cả phiên` })
}

export function SkillsDialog() {
  useKeys((evt) => {
    if (evt.eventType !== "release" && evt.name === "escape") closeDialog()
  })
  return (
    <DialogFrame title={`Skills · ${state.skills.length}`} hint="enter bật/tắt cho cả phiên · esc đóng">
      <Show when={state.skills.length > 0} fallback={<text fg={color.tx3}>Chưa có skill nào.</text>}>
        <Picker
          items={state.skills.map((s) => ({
            label: s.name,
            hint: `${s.source} · ${ACTIVATION[s.activation]} · ${s.description}`,
            mark: s.activation === "always" || state.activeSkills.includes(s.name) ? "●" : "○",
            value: s.name,
          }))}
          onPick={toggleSkill}
          rows={10}
        />
      </Show>
      <Show when={state.skillProblems.length > 0}>
        <text fg={color.giam} marginTop={1}>{`Lỗi skill (${state.skillProblems.length}):`}</text>
        <For each={state.skillProblems}>
          {(p) => (
            <text fg={color.tx3} wrapMode="word">
              {`  ${p.file}: ${p.error}`}
            </text>
          )}
        </For>
      </Show>
    </DialogFrame>
  )
}
