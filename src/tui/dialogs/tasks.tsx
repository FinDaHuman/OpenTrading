import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { sidechainDir, type SidechainMeta } from "../../core/subagents/sidechain"
import { currentSession } from "../session"
import type { Runtime } from "../../core/runtime"
import { fmtSeconds, fmtTokens } from "../../core/subagents/result"
import type { SubagentView } from "../../core/subagents/types"
import { closeDialog, state } from "../state"
import { color } from "../theme"
import { useKeys } from "../ui/keys"
import { truncate } from "../ui/text"
import { DialogFrame } from "./frame"
import { Picker } from "./picker"

const STATUS: Record<string, string> = { queued: "chờ slot", running: "đang chạy", completed: "xong", failed: "lỗi", stopped: "đã dừng" }
const active = (a: SubagentView) => a.status === "queued" || a.status === "running"

function line(a: SubagentView) {
  const end = a.endedAt ?? Date.now()
  return `${STATUS[a.status]}${a.background ? " · nền" : ""} · ${a.toolCount} tool · ${fmtTokens(a.usage.input + a.usage.output)} token · ${fmtSeconds(end - (a.startedAt ?? a.createdAt))} · ${a.id}`
}

/**
 * Subagents of this session that are no longer in memory (a resumed session): their
 * .meta.json files next to the session.
 */
async function storedAgents(): Promise<SubagentView[]> {
  const dir = sidechainDir(currentSession().dir)
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".meta.json"))
  const metas = await Promise.all(
    files.map((f) =>
      readFile(path.join(dir, f), "utf8")
        .then((t) => JSON.parse(t) as SidechainMeta)
        .catch(() => undefined),
    ),
  )
  return metas
    .filter((m): m is SidechainMeta => !!m?.agentId)
    .map((m) => ({
      id: m.agentId,
      type: m.agentType,
      description: m.description,
      prompt: "",
      parentCallId: m.parentCallId,
      background: false,
      model: "",
      status: m.status,
      createdAt: Date.parse(m.createdAt) || 0,
      endedAt: Date.parse(m.updatedAt) || undefined,
      tools: [],
      toolCount: m.toolCount,
      usage: m.usage,
      text: "",
    }))
}

/**
 * /tasks (Claude Code's /tasks): this session's subagents, running first. Enter shows one
 * (brief, calls, result); x stops a running one, as stop_agent would.
 */
export function TasksDialog(props: { runtime: Runtime }) {
  const [open, setOpen] = createSignal<string>()
  const [highlighted, setHighlighted] = createSignal<string>()
  const [stored] = createResource(storedAgents)
  const agents = createMemo(() =>
    [...Object.values(state.agents), ...(stored() ?? []).filter((s) => !state.agents[s.id])].sort(
      (a, b) => Number(active(b)) - Number(active(a)) || b.createdAt - a.createdAt,
    ),
  )
  const detail = () => (open() ? agents().find((a) => a.id === open()) : undefined)

  useKeys((evt) => {
    if (evt.eventType === "release") return
    if (evt.name === "escape") return open() ? setOpen(undefined) : closeDialog()
    if (evt.name === "x" && evt.ctrl) {
      evt.preventDefault()
      const id = open() ?? highlighted()
      if (id) props.runtime.subagents.stop(id)
    }
  })

  return (
    <Show
      when={detail()}
      fallback={
        <DialogFrame title={`Subagent của phiên · ${agents().length}`} hint="enter xem · ctrl+x dừng subagent đang chạy · esc đóng">
          <Show when={agents().length > 0} fallback={<text fg={color.tx3}>Chưa có subagent nào trong phiên này.</text>}>
            <Picker
              items={agents().map((a) => ({
                label: `${a.type} (${truncate(a.description, 30)})`,
                group: active(a) ? "Đang chạy" : "Đã xong",
                hint: line(a),
                mark: active(a) ? "◆" : a.status === "completed" ? "●" : "✘",
                value: a.id,
              }))}
              onPick={(id) => setOpen(id)}
              onHighlight={(id) => setHighlighted(id)}
              rows={10}
            />
          </Show>
        </DialogFrame>
      }
    >
      {(a) => (
        <DialogFrame title={`Subagent ${a().id} · ${a().type}`} hint={active(a()) ? "ctrl+x dừng · esc quay lại" : "esc quay lại"}>
          <text fg={color.tx} wrapMode="word">
            {a().description}
          </text>
          <text fg={color.tx2}>{`${line(a())}${a().model ? ` · ${a().model}` : ""}`}</text>
          <Show when={a().error}>
            <text fg={color.giam} wrapMode="word">{`Lỗi: ${a().error}`}</text>
          </Show>
          <Show
            when={a().prompt}
            fallback={<text fg={color.tx3} marginTop={1}>{`Từ phiên trước: chi tiết trong ${sidechainDir(currentSession().dir)}`}</text>}
          >
            <text fg={color.tham} marginTop={1}>
              Yêu cầu:
            </text>
            <text fg={color.tx3} wrapMode="word">
              {a().prompt}
            </text>
          </Show>
          <Show when={a().tools.length > 0}>
            <text fg={color.tham} marginTop={1}>{`Tool (${a().toolCount}):`}</text>
            <For each={a().tools.slice(-8)}>
              {(t) => (
                <text fg={t.status === "error" ? color.giam : color.tx3} wrapMode="none">
                  {truncate(`${t.status === "running" ? "…" : t.status === "error" ? "✘" : "●"} ${t.label}${t.decision ? ` · ${t.decision}` : ""}`, 100)}
                </text>
              )}
            </For>
          </Show>
          <Show when={a().text}>
            <text fg={color.tham} marginTop={1}>
              Kết quả:
            </text>
            <text fg={color.tx3} wrapMode="word">
              {a().text}
            </text>
          </Show>
        </DialogFrame>
      )}
    </Show>
  )
}
