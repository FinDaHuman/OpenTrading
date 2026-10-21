import type { ModelMessage } from "ai"
import { label, visibleUserText } from "../core/agent"
import { promptVersion } from "../core/prompt/assemble"
import type { Runtime } from "../core/runtime"
import { listSessions, loadSession, Session } from "../core/session/store"
import { formatTranscript } from "../core/session/export"
import { transcriptFromMessages } from "../core/session/transcript"
import { useResultSession } from "../core/tools/refs"
import { reconcile } from "solid-js/store"
import { NO_COMPACTION, providerName, pushLine, setState, state, type Line } from "./state"

/** The conversation being written. Replaced by /new, /clear and resume. */
let current = Session.create()

export const currentSession = () => current

/** Persist one finished turn (fire-and-forget: a disk error must not break the chat). */
export function recordTurn(messages: ModelMessage[], contextTokens?: number) {
  if (messages.length === 0) return
  const firstTurn = current.turns === 0
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
  // After the first turn, replace the 60-char fallback title with a generated
  // one (fire-and-forget; failures keep the fallback).
  if (firstTurn) void retitleOnce(current, messages)
}

/** One-shot title generation for a fresh session; never throws. */
async function retitleOnce(session: Session, messages: ModelMessage[]) {
  try {
    const { generateTitle } = await import("../core/session/title")
    // What the user typed (an image message is an array; reminders are left out).
    const first = messages.map(visibleUserText).find((t) => t.trim())
    const title = await generateTitle(first ?? "")
    // The session it was asked for, even if /new or /resume switched meanwhile.
    if (title) await session.setTitle(title)
  } catch {
    // keep the fallback title
  }
}

/** Persist a compaction, so --resume starts from the compacted history. */
export function recordCompact(entry: { trigger: "auto" | "manual"; before: number; after: number; messages: ModelMessage[] }) {
  current.appendCompact(entry).catch(saveFailed)
}

const saveFailed = (error: unknown) =>
  pushLine({ kind: "error", text: `Không lưu được phiên: ${error instanceof Error ? error.message : String(error)}` })

/**
 * The current conversation as Markdown (/save, /export), read back from its session file so
 * turns before a compaction are included. Undefined before the first turn is written.
 */
export async function transcriptOfCurrent(runtime: Runtime) {
  await current.flush()
  if (!current.file) return undefined
  const loaded = await loadSession(current.id)
  return {
    id: current.id,
    turns: loaded.summary.turns,
    text: formatTranscript(loaded, { label: (name, input) => label(runtime.registry, name, input) }),
  }
}

/**
 * Subagent transcripts go next to the session being written; data refs (`rN`) resolve in it.
 * `history`: a resumed conversation, whose refs new results must not reuse.
 */
export function attachSubagents(runtime: Runtime, history?: string) {
  runtime.subagents.attachSession({ id: current.id, dir: current.dir })
  runtime.desk.attachSession({ id: current.id, dir: current.dir })
  useResultSession(current.id, history)
}

/** Start a fresh session (startup, /new, /clear). */
export async function startSession(runtime: Runtime, source: "startup" | "clear") {
  if (source === "clear") await runtime.hooks.emit({ type: "session-end", sessionId: current.id })
  current = Session.create()
  attachSubagents(runtime)
  setState("agents", reconcile({}))
  setState("deskRuns", reconcile({}))
  setState({ notices: [], noticeHold: false })
  // A fresh conversation has not seen the market clock yet.
  setState({ lines: [], history: [], clock: undefined, ...NO_COMPACTION })
  runtime.auto.reset()
  await runtime.hooks.emit({ type: "session-start", sessionId: current.id, source })
}

/** Reopen a stored session: rebuild history and transcript, then keep appending to its file. */
export async function resumeSession(runtime: Runtime, id: string) {
  const loaded = await loadSession(id)
  await runtime.hooks.emit({ type: "session-end", sessionId: current.id })
  current = Session.continue(loaded.summary)
  attachSubagents(runtime, JSON.stringify(loaded.display))
  setState("agents", reconcile({}))
  setState("deskRuns", reconcile({}))
  setState({ notices: [], noticeHold: false })

  const lines: Line[] = transcriptFromMessages(loaded.display).flatMap((item): Line[] => {
    if (item.kind === "compact") return [{ kind: "compact", summary: item.text }]
    if (item.kind === "agent-notice") {
      return [{ kind: "agent-notice", agentId: item.agentId, status: item.status, text: `Subagent nền ${item.type} (${item.description}) · ${item.status} · ${item.stats}` }]
    }
    if (item.kind === "tool") {
      const row: Line = {
        kind: "tool",
        callId: item.callId,
        name: item.name,
        label: label(runtime.registry, item.name, item.input),
        status: item.ok ? "ok" : "error",
        output: item.output,
      }
      // The chart the user saw for this call (stored with the turn), right after its row.
      const chart = loaded.charts.get(item.callId)
      return chart ? [row, { kind: "chart", data: chart }] : [row]
    }
    return [item.kind === "user" ? { kind: "user", text: item.text, files: item.files } : { kind: "assistant", text: item.text, done: true }]
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

  // The auto-mode classifier reads the whole conversation, from before any /compact too.
  runtime.auto.reset(loaded.display, (name) => runtime.registry.get(name), visibleUserText)
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
