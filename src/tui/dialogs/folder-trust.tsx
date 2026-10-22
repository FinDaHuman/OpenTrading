import { useKeyboard } from "@opentui/solid"
import { createSignal, For } from "solid-js"
import { FolderTrust } from "../../core/folder-trust"
import type { Runtime } from "../../core/runtime"
import { loadSkills, skillRoots } from "../../core/skills/loader"
import { shortPath } from "../home"
import { say } from "../notify"
import { setState, state } from "../state"
import { color } from "../theme"
import { reloadAgents } from "./agents"
import { DialogFrame } from "./frame"

/**
 * Opened in a folder whose `.opentrading/` holds skills or agents, not trusted yet (see
 * src/core/folder-trust.ts). Until the user answers, only bundled and personal skills/agents
 * are loaded. "Bỏ qua" is not saved: the next start asks again.
 */

type Choice = "trust" | "skip"

const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: "trust", label: "Tin cậy và nạp", hint: "lần sau không hỏi lại thư mục này" },
  { value: "skip", label: "Bỏ qua", hint: "chỉ dùng skill/agent có sẵn và của bạn" },
]

/** Also called by tests. */
export async function answerFolderTrust(runtime: Runtime, choice: Choice) {
  const extras = state.folderTrust
  setState("folderTrust", undefined)
  if (!extras) return
  if (choice === "skip") return void setState("projectSkipped", extras)
  // Home, a drive root…: trusted for this run only (Workspace swapped them for its own folder).
  await new FolderTrust().trust(runtime.mcp.cwd, !runtime.workspace.fallbackReason)
  setState({ projectAllowed: true, projectSkipped: undefined })
  const { skills, problems } = await loadSkills(skillRoots(runtime.mcp.cwd))
  setState({ skills, skillProblems: problems })
  await reloadAgents(runtime)
  say(`Đã nạp skill/agent của thư mục ${shortPath(runtime.mcp.cwd)}`, "success")
}

/** "3 skill, 1 agent" */
export function extrasText(e: { skills: number; agents: number }) {
  return [e.skills > 0 ? `${e.skills} skill` : "", e.agents > 0 ? `${e.agents} agent` : ""].filter(Boolean).join(", ")
}

export function FolderTrustDialog(props: { runtime: Runtime }) {
  const [selected, setSelected] = createSignal(0)
  const choose = (i: number) => void answerFolderTrust(props.runtime, CHOICES[i]!.value)

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    evt.preventDefault()
    const n = CHOICES.length
    if (evt.name === "up") setSelected((i) => (i + n - 1) % n)
    else if (evt.name === "down" || evt.name === "tab") setSelected((i) => (i + 1) % n)
    else if (evt.name === "return") choose(selected())
    else if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) choose(n - 1)
    else if (/^[1-2]$/.test(evt.name ?? "")) choose(Number(evt.name) - 1)
  })

  return (
    <DialogFrame title="Thư mục này có skill/agent riêng" accent={color.tham} hint="↑↓ chọn · enter xác nhận · 1-2 chọn nhanh · esc bỏ qua">
      <box flexDirection="column" paddingLeft={2} flexShrink={0}>
        <text fg={color.tx} wrapMode="word" flexShrink={0}>
          {`${shortPath(state.folderTrust?.dir ?? "")}: ${extrasText(state.folderTrust ?? { skills: 0, agents: 0 })}`}
        </text>
        <text fg={color.tx2} wrapMode="word" flexShrink={0}>
          Chúng trở thành chỉ dẫn cho model. Chỉ tin nếu bạn biết nguồn của thư mục này (repo tải về có thể cài chỉ dẫn xấu).
        </text>
      </box>
      <box flexDirection="column" marginTop={1} flexShrink={0}>
        <For each={CHOICES}>
          {(choice, i) => {
            const active = () => i() === selected()
            return (
              <box flexDirection="row" height={1} flexShrink={0}>
                <text fg={active() ? color.tang : color.tx3} width={5} flexShrink={0} selectable={false}>
                  {active() ? "❯ " : "  "}
                  <span style={{ fg: color.tx3 }}>{`${i() + 1}.`}</span>
                </text>
                <text fg={active() ? color.tang : color.tx} width={18} flexShrink={0}>
                  {choice.label}
                </text>
                <text fg={color.tx3} wrapMode="none">
                  {choice.hint}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </DialogFrame>
  )
}
