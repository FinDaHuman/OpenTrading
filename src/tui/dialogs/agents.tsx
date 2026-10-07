import { createMemo, createSignal, For, Show } from "solid-js"
import { loadAgents } from "../../core/agents/loader"
import { toolFilter, toolSummary } from "../../core/agents/resolve"
import type { AgentDefinition } from "../../core/agents/schema"
import { setAgents, type Runtime } from "../../core/runtime"
import { EXCLUDED_TOOLS } from "../../core/subagents/manager"
import { closeDialog, providerName, setState, state } from "../state"
import { color } from "../theme"
import { useKeys } from "../ui/keys"
import { truncate } from "../ui/text"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

const SOURCE: Record<string, string> = { bundled: "Có sẵn", user: "Người dùng", project: "Dự án" }
const ORDER = ["bundled", "user", "project"]

/** Load agent types and re-register spawn_subagent so its description lists them. */
export async function reloadAgents(runtime: Runtime) {
  const { agents, problems } = await loadAgents()
  setState({ agentDefs: agents, agentProblems: problems })
  setAgents(runtime, agents)
  return agents.length
}

/** Tools this type would get right now (current registry, minus what subagents never get). */
function resolvedTools(runtime: Runtime, def: AgentDefinition) {
  const keep = toolFilter(def)
  return runtime.registry
    .list()
    .filter((t) => !EXCLUDED_TOOLS.has(t.name) && !t.source?.startsWith("memory:") && keep(t))
    .map((t) => t.name)
}

const modelOf = (def: AgentDefinition) =>
  def.model ? `${def.provider ? `${providerName(def.provider)} · ` : ""}${def.model}` : def.provider ? providerName(def.provider) : "model mặc định"

/**
 * /agents (Claude Code's agent list): types by source, which wins on a name clash, and
 * a detail view with the tools the type resolves to now. Files are edited by hand.
 */
export function AgentsDialog(props: { runtime: Runtime }) {
  const [open, setOpen] = createSignal<string>()
  const [note, setNote] = createSignal("")
  const detail = createMemo(() => state.agentDefs.find((a) => a.name === open()))

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") return open() ? setOpen(undefined) : closeDialog()
    if (evt.name === "r" && evt.ctrl) {
      evt.preventDefault()
      void reloadAgents(props.runtime).then((n) => setNote(`Đã nạp lại ${n} loại subagent.`))
    }
  })

  return (
    <Show
      when={detail()}
      fallback={
        <DialogFrame title={`Subagent · ${state.agentDefs.length} loại`} hint="enter xem chi tiết · ctrl+r nạp lại · esc đóng">
          <Picker
            items={[...state.agentDefs].sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source)).map((a) => ({
              label: a.name,
              group: SOURCE[a.source],
              hint: `${a.overrides ? `ghi đè ${SOURCE[a.overrides]!.toLowerCase()} · ` : ""}${modelOf(a)} · tool: ${toolSummary(a)} · ${a.maxSteps ?? 8} bước · ${a.description}`,
              mark: "●",
              value: a.name,
            }))}
            onPick={(name) => setOpen(name)}
            rows={10}
          />
          <text fg={color.tx3} marginTop={1} wrapMode="word">
            Thêm loại mới: file .opentrading/agents/&lt;tên&gt;.md (dự án) hoặc ~/.opentrading/agents/&lt;tên&gt;.md, frontmatter name, description, tools, model, maxSteps; phần thân là chỉ dẫn riêng.
          </text>
          <Show when={note()}>
            <text fg={color.tang}>{note()}</text>
          </Show>
          <Show when={state.agentProblems.length > 0}>
            <text fg={color.giam} marginTop={1}>{`Lỗi file agent (${state.agentProblems.length}):`}</text>
            <For each={state.agentProblems}>{(p) => <text fg={color.tx3} wrapMode="word">{`  ${p.file}: ${p.error}`}</text>}</For>
          </Show>
        </DialogFrame>
      }
    >
      {(def) => {
        const tools = () => resolvedTools(props.runtime, def())
        return (
          <DialogFrame title={`Subagent · ${def().name}`} hint="esc quay lại">
            <text fg={color.tx} wrapMode="word">
              {def().description}
            </text>
            <text fg={color.tx2} marginTop={1}>{`Nguồn: ${SOURCE[def().source]}${def().overrides ? ` (ghi đè bản ${SOURCE[def().overrides!]!.toLowerCase()})` : ""}`}</text>
            <text fg={color.tx2} wrapMode="none">{truncate(`File: ${def().file}`, 100)}</text>
            <text fg={color.tx2}>{`Model: ${modelOf(def())} · tối đa ${def().maxSteps ?? 8} bước`}</text>
            <text fg={color.tx2} wrapMode="word">{`Tool khai báo: ${toolSummary(def())}`}</text>
            <text fg={color.tx2} wrapMode="word">{`Tool hiện có (${tools().length}): ${tools().join(", ") || "không có — subagent loại này sẽ không chạy được"}`}</text>
            <Show when={def().body}>
              <text fg={color.tham} marginTop={1}>
                Chỉ dẫn riêng:
              </text>
              <text fg={color.tx3} wrapMode="word">
                {def().body}
              </text>
            </Show>
          </DialogFrame>
        )
      }}
    </Show>
  )
}
