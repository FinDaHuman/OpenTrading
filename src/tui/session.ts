import type { ModelMessage } from "ai"
import { label } from "../core/agent"
import { promptVersion } from "../core/prompt/assemble"
import type { Runtime } from "../core/runtime"
import { listSessions, loadSession, Session } from "../core/session/store"
import { transcriptFromMessages } from "../core/session/transcript"
import { reconcile } from "solid-js/store"
import { NO_COMPACTION, providerName, pushLine, setState, state, type Line } from "./state"

/** The conversation being written. Replaced by /new, /clear and resume. */
let current = Session.create()

export const currentSession = () => current

/** Persist one finished turn (fire-and-forget: a disk error must not break the chat). */
export function recordTurn(messages: ModelMessage[], contextTokens?: number) {
  if (messages.length === 0) return
  current
    .appendTurn(messages, {
      cwd: process.cwd(),
      provider: state.provider,
      model: state.model,
      promptVersion: promptVersion(),
      skills: state.skills.map((s) => ({ name: s.name, version: s.version })),
      contextTokens,
    })
    .catch(saveFailed)
}

/** Persist a compaction, so --resume starts from the compacted history. */
export function recordCompact(entry: { trigger: "auto" | "manual"; before: number; after: number; messages: ModelMessage[] }) {
  current.appendCompact(entry).catch(saveFailed)
}

const saveFailed = (error: unknown) =>
  pushLine({ kind: "error", text: `Không lưu được phiên: ${error instanceof Error ? error.message : String(error)}` })

/** Subagent transcripts go next to the session being written. */
export function attachSubagents(runtime: Runtime) {
  runtime.subagents.attachSession({ id: current.id, dir: current.dir })
}

/** Start a fresh session (startup, /new, /clear). */
export async function startSession(runtime: Runtime, source: "startup" | "clear") {
  if (source === "clear") await runtime.hooks.emit({ type: "session-end", sessionId: current.id })
  current = Session.create()
  attachSubagents(runtime)
  setState("agents", reconcile({}))
  // A fresh conversation has not seen the market clock yet.
  setState({ lines: [], history: [], clock: undefined, ...NO_COMPACTION })
  await runtime.hooks.emit({ type: "session-start", sessionId: current.id, source })
}

/** Reopen a stored session: rebuild history and transcript, then keep appending to its file. */
export async function resumeSession(runtime: Runtime, id: string) {
  const loaded = await loadSession(id)
  await runtime.hooks.emit({ type: "session-end", sessionId: current.id })
  current = Session.continue(loaded.summary)
  attachSubagents(runtime)
  setState("agents", reconcile({}))

  const lines: Line[] = transcriptFromMessages(loaded.display).map((item): Line => {
    if (item.kind === "compact") return { kind: "compact", summary: item.text }
    if (item.kind === "tool") {
      return {
        kind: "tool",
        callId: item.callId,
        name: item.name,
        label: label(runtime.registry, item.name, item.input),
        status: item.ok ? "ok" : "error",
        output: item.output,
      }
    }
    return item.kind === "user" ? { kind: "user", text: item.text } : { kind: "assistant", text: item.text, done: true }
  })
  const notes: Line[] = [{ kind: "info", text: `Mở lại phiên "${loaded.summary.title}" · ${loaded.summary.turns} lượt` }]
  if (loaded.patched > 0) notes.push({ kind: "info", text: `${loaded.patched} lần gọi tool bị ngắt ở phiên trước đã được đánh dấu là lỗi.` })
  const saved = loaded.summary.provider && loaded.summary.model ? `${loaded.summary.provider}/${loaded.summary.model}` : undefined
  if (saved && saved !== `${state.provider}/${state.model}`) {
    notes.push({
      kind: "info",
      text: `Phiên này được tạo với ${providerName(loaded.summary.provider)} · ${loaded.summary.model}; đang dùng ${providerName(state.provider)} · ${state.model ?? "chưa chọn"}.`,
    })
  }

  // The clock snapshot is unknown after resume, so the next turn re-sends it.
  setState({ lines: [...notes, ...lines], history: loaded.messages, clock: undefined, ...NO_COMPACTION, contextTokens: loaded.contextTokens })
  await runtime.hooks.emit({ type: "session-start", sessionId: current.id, source: "resume" })
}

/** `--continue` → newest session; `--resume <id>` → that one (id prefix is enough). */
export async function resumeFromArgs(runtime: Runtime, target: string) {
  const id = target === "latest" ? (await listSessions())[0]?.id : target
  if (!id) return pushLine({ kind: "info", text: "Chưa có phiên nào để mở lại." })
  try {
    await resumeSession(runtime, id)
  } catch (error) {
    pushLine({ kind: "error", text: error instanceof Error ? error.message : String(error) })
  }
}
