import type { KeyEvent, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { produce, reconcile } from "solid-js/store"
import { runAgent, summarizeConversation } from "../core/agent"
import {
  AUTO_COMPACT_SHARE,
  COMPACT_LEAN_TOKENS,
  DEFAULT_COMPACT_WINDOW,
  IMAGE_TOKENS,
  MAX_AUTO_FAILURES,
  compactHistory,
  compactPrompt,
  formatCompactSummary,
  isContextOverflow,
  pruneAttachmentsForRequest,
  shouldAutoCompact,
  tokensOf,
} from "../core/compact"
import { estimateTokens } from "../core/prompt/budget"
import { acceptsImageInput } from "../core/agent"
import { attachMentions, mentionText } from "../core/mentions"
import { FileIndex, INDEX_MISS_MS, matchPaths } from "../core/fs/file-index"
import { connectedProviders } from "../core/auth"
import { describeError } from "../core/chat"
import type { AgentEvent } from "../core/events"
import { loadConfig, saveConfig } from "../core/config"
import { loadCatalog } from "../core/catalog"
import type { Runtime } from "../core/runtime"
import { ensureProfile } from "../core/profile"
import { loadSkills } from "../core/skills/loader"
import { Background } from "./background"
import { ApprovalPrompt } from "./approval"
import { AskPrompt } from "./ask"
import { McpPanel, STATUS } from "./mcp/panel"
import { rank, truncate } from "./ui/text"
import { COMMANDS, parseCommand, parsePromptArgs, promptUsage, type CommandInfo } from "./commands"
import { ConfigDialog } from "./dialogs/config"
import { ConnectDialog } from "./dialogs/connect"
import { ContextDialog } from "./dialogs/context"
import { HelpDialog } from "./dialogs/help"
import { MemoryDialog } from "./dialogs/memory"
import { PermissionsDialog } from "./dialogs/permissions"
import { SessionsDialog } from "./dialogs/sessions"
import { ModelDialog } from "./dialogs/model"
import { SkillsDialog, toggleSkill } from "./dialogs/skills"
import { AgentsDialog, reloadAgents } from "./dialogs/agents"
import { TasksDialog } from "./dialogs/tasks"
import { focusWatchlist, WatchlistDialog } from "./dialogs/watchlist"
import { watchlistOps } from "../core/tools/watchlist/local"
import { noticesMessage, notificationText } from "../core/subagents/notification"
import { fmtSeconds, fmtTokens } from "../core/subagents/result"
import { ToolsDialog } from "./dialogs/tools"
import { Home } from "./home"
import { attachSubagents, currentSession, recordCompact, recordTurn, resumeFromArgs, startSession, transcriptOfCurrent } from "./session"
import { resolveExportPath, writeExport } from "../core/session/export"
import { cycleMode } from "../core/permission/mode"

import { armExit, type Queued, closeDialog, contextWindow, EXIT_WINDOW_MS, onExitRequest, providerName, pushLine, setState, state, type Line } from "./state"
import { flash, say } from "./notify"
import { ModeLine } from "./mode-line"
import { terminalAttention, type Attention } from "./attention"
import { ShortcutsPane } from "./shortcuts"
import { loadModelPrefs } from "../core/model-prefs"
import { AgentPanel, panelAgents } from "./agent-panel"
import { AutoOptInDialog } from "./dialogs/auto-optin"
import { announceMcp } from "./mcp/notices"
import { Toasts } from "./toast"
import { ActivityRow, activeMs, startActivity } from "./activity"
import { now, useNow } from "./ui/clock"
import { color, promptStyle } from "./theme"
import { cleanSelection, writeClipboard } from "./clipboard"
import { ArgumentHint, commandItem, Suggestions } from "./suggestions"
import { Transcript } from "./transcript"
import { scrollSetting, scrollTranscript } from "./scroll"
import { TodoPanel } from "./todo-panel"
import { PromptInput } from "./prompt/input"
import { addHistory, HistoryCursor, loadHistory, pastesFor, searchHistory } from "./prompt/history"
import { imagePath, MAX_IMAGE_BASE64, readClipboardImage, readImageFile, type PromptImage } from "./prompt/image"
import { isLargePaste, offsetSlice, offsetWidth, pasteLabel, PromptParts, type DraftSnapshot, type ExpandedPrompt } from "./prompt/parts"
import { editInEditor } from "./prompt/editor"
import { TODO_WRITE, TodoWriteInput } from "../core/tools/todos"

let abort: AbortController | undefined
/** /save skips OSC52 above this: megabytes of escape sequence can stall the terminal. */
const MAX_OSC52_CHARS = 100_000
/** Bumped by /clear so a stream that is still unwinding never touches the new transcript. */
let epoch = 0

/** /clear and /new: stop any running turn and start a fresh session. */
export async function clearTranscript(runtime: Runtime) {
  epoch++
  setState("queue", [])
  abort?.abort()
  runtime.subagents.stopAll()
  await startSession(runtime, "clear")
}

function lineIndex(predicate: (line: Line) => boolean) {
  for (let i = state.lines.length - 1; i >= 0; i--) if (predicate(state.lines[i]!)) return i
  return -1
}

/**
 * Compact the conversation (see core/compact.ts). Runs like a turn: esc stops it, /new
 * discards it. On failure the history is left as is (or only pruned).
 */
export async function compact(runtime: Runtime, trigger: "auto" | "manual", instructions?: string, projected?: number): Promise<boolean> {
  if (state.history.length === 0) {
    if (trigger === "manual") say("Chưa có hội thoại để nén.")
    return true
  }
  const mine = epoch
  const controller = new AbortController()
  abort = controller
  const window = contextWindow()
  setState({ streaming: true, compacting: true, activity: startActivity({ compacting: true }) })
  try {
    const result = await compactHistory(state.history, {
      // Auto: what the next request would hold, including the message being sent.
      contextTokens: projected ?? state.contextTokens,
      onSummarize: () =>
        pushLine({
          kind: "info",
          text: trigger === "auto" ? "Context gần đầy: đang tóm tắt phần đầu hội thoại (dùng 1 request)…" : "Đang tóm tắt hội thoại (dùng 1 request)…",
        }),
      window,
      manual: trigger === "manual",
      instructions,
      summarize: async (head, extra) => {
        // One request: <analysis> scratchpad then <summary> (Claude Code); lean when the head is huge.
        const lean = tokensOf(head) > COMPACT_LEAN_TOKENS
        const text = await summarizeConversation({
          head,
          prompt: compactPrompt(extra, lean ? "lean" : "full"),
          skills: state.skills,
          sticky: state.activeSkills,
          registry: runtime.registry,
          sessionId: currentSession().id,
          memory: runtime.memory,
          serverInstructions: () => runtime.mcp.instructions(),
          signal: controller.signal,
        })
        const summary = formatCompactSummary(text)
        if (summary === undefined) throw new Error("Bản tóm tắt bị cắt giữa chừng; hội thoại giữ nguyên.")
        return summary
      },
    })
    if (epoch !== mine) return false
    if (controller.signal.aborted) {
      pushLine({ kind: "info", text: "Đã dừng nén; hội thoại giữ nguyên." })
      return false
    }
    if (result.summary !== undefined || result.pruned > 0) {
      // The clock reminder lived in the dropped turns: send it again next turn.
      setState({ history: result.messages, contextTokens: result.after, clock: undefined })
      recordCompact({ trigger, before: result.before, after: result.after, messages: result.messages })
      pushLine({ kind: "compact", summary: result.summary, before: result.before, after: result.after, pruned: result.pruned })
    }
    if (result.error) {
      pushLine({ kind: "error", text: `Không tóm tắt được hội thoại: ${result.error}` })
      if (trigger === "auto") {
        setState("compactFailures", (n) => n + 1)
        if (state.compactFailures >= MAX_AUTO_FAILURES) {
          pushLine({ kind: "info", text: `Tự nén lỗi ${MAX_AUTO_FAILURES} lần liên tiếp nên đã tắt cho phiên này; gõ /compact để thử lại.` })
        }
      }
    } else setState("compactFailures", 0)
    // Still above the threshold: do not pay for another compaction until the context grows.
    setState("compactFloor", window && result.after >= window * AUTO_COMPACT_SHARE ? result.after : undefined)
  } finally {
    if (epoch === mine) setState({ streaming: false, compacting: false, activity: undefined })
    if (abort === controller) abort = undefined
  }
  return true
}

/** The turn being answered, so exit can wait for it to be saved. */
let inflight: Promise<void> | undefined

/** A message to send: the text for the model, what the transcript shows, pasted images. */
type Outgoing = { text: string; display?: string; images?: PromptImage[]; notice?: boolean }

/**
 * Background subagent results go to the model on their own turn when nothing else is
 * going on (Claude Code's task notifications). They wait while an answer runs, a prompt
 * owns the keyboard or messages are queued, and after a failed turn until the user sends
 * something (a 429 must not loop).
 */
export function deliverNotices(runtime: Runtime) {
  if (state.notices.length === 0 || state.noticeHold || state.streaming || state.compacting) return
  if (state.approval || state.question || inflight || state.queue.length > 0) return
  const texts = [...state.notices]
  setState("notices", [])
  void send(runtime, { text: noticesMessage(texts), notice: true })
}

function send(runtime: Runtime, message: string | Outgoing) {
  let msg: Outgoing = typeof message === "string" ? { text: message } : message
  // Undelivered subagent results ride in front of what the user typed.
  if (!msg.notice && state.notices.length > 0) {
    msg = { ...msg, display: msg.display ?? msg.text, text: `${noticesMessage(state.notices)}\n\n${msg.text}` }
    setState("notices", [])
  }
  if (!msg.notice) setState("noticeHold", false)
  const turn = (async () => {
    // Files @-attached turns ago: their content goes once it adds up (resent every request).
    const cleared = pruneAttachmentsForRequest(state.history, state.contextTokens)
    if (cleared) {
      setState({ history: cleared.messages, contextTokens: cleared.contextTokens })
      say(`Đã dọn nội dung ${cleared.pruned} file gắn ở các lượt cũ để tiết kiệm context.`, "info")
    }
    // Near the window: compact first, so this turn still fits.
    const config = await loadConfig()
    const projected =
      (state.contextTokens ?? tokensOf(state.history)) + estimateTokens(msg.text) + (msg.images?.length ?? 0) * IMAGE_TOKENS
    const auto = shouldAutoCompact({
      contextTokens: projected,
      window: contextWindow(),
      floor: state.compactFloor,
      failures: state.compactFailures,
      disabled: config.autoCompact === "off",
    })
    if (auto) await compact(runtime, "auto", undefined, projected)
    return sendTurn(runtime, msg)
  })()
  const settled = turn.then(
    (ok) => ok,
    () => false,
  )
  const done = settled.then(() => {})
  inflight = done
  return settled.then((ok) => {
    if (inflight === done) inflight = undefined
    afterTurn(runtime, ok)
  })
}

let returnQueue: ((items: Queued[]) => void) | undefined

/**
 * A turn ended. Messages typed meanwhile go next, one per turn; after a stop or an error
 * they return to the input instead, to be checked before sending (Claude Code).
 */
function afterTurn(runtime: Runtime, ok: boolean) {
  if (state.streaming) return
  if (!ok) setState("noticeHold", true)
  if (state.queue.length === 0) return deliverNotices(runtime)
  if (!ok) {
    const items = [...state.queue]
    setState("queue", [])
    return returnQueue?.(items)
  }
  const [next, ...rest] = state.queue
  setState("queue", rest)
  void send(runtime, next!)
}

/** The terminal side of the app (attention.ts), set while the app is mounted. */
let attention: Attention | undefined

/** How long a first x on a subagent panel row waits for the second one. */
const STOP_WINDOW_MS = 2000

/** Turns shorter than this end without a "✻ Xong sau …" line. */
const DONE_LINE_MS = 5000
/** How long streamed text is buffered before it reaches the transcript (one frame at 30 fps). */
const FLUSH_MS = 32

/**
 * Feed the working row: any event is a sign of life and ends a retry wait; deltas and tool
 * inputs estimate the output so far, and the provider's count replaces the estimate per step.
 */
function track(event: AgentEvent) {
  if (!state.activity) return
  setState(
    produce((s) => {
      const a = s.activity
      if (!a) return
      a.lastProgressAt = now()
      if (event.type !== "retry") a.retry = undefined
      switch (event.type) {
        case "text-delta":
          a.streamedOut += event.text.length / 4
          break
        case "tool-start":
          a.toolsRunning++
          a.streamedOut += (JSON.stringify(event.input ?? "")?.length ?? 0) / 4
          break
        case "tool-end":
          a.toolsRunning = Math.max(0, a.toolsRunning - 1)
          break
        case "step-usage":
          a.billedOut += event.outputTokens
          a.streamedOut = 0
          break
        case "retry":
          a.retry = { attempt: event.attempt, max: event.max, until: event.until, label: event.label }
          break
      }
    }),
  )
}

/** Files the message @-mentions, read for the model; images only for a model that sees them. */
function mentionsOf(runtime: Runtime, text: string) {
  if (!text.includes("@")) return undefined
  const target = state.provider && state.model ? { provider: state.catalog[state.provider]!, model: state.model } : undefined
  return attachMentions(text, {
    workspace: runtime.workspace,
    files: runtime.files,
    history: state.history,
    images: !!target?.provider && acceptsImageInput(target),
  })
}

/** One turn; true when it ran to the end (not stopped, no error, no /clear meanwhile). */
async function sendTurn(runtime: Runtime, msg: Outgoing): Promise<boolean> {
  // A notification turn already has its "◆ Subagent nền …" lines.
  if (!msg.notice) pushLine({ kind: "user", text: msg.display ?? msg.text })
  const userLine = msg.notice ? -1 : state.lines.length - 1
  const mine = epoch
  const live = () => epoch === mine
  let failed = false
  // Index of the assistant line currently receiving text; -1 after a tool call.
  let current = -1
  const edit = (index: number, fn: (line: any) => void) => {
    if (live() && index >= 0) setState(produce((s) => fn(s.lines[index])))
  }
  // Text deltas are buffered and written once per frame (opencode batches its events the same
  // way): one store write per token re-laid-out the answer for every token. Any other event
  // flushes first, so lines keep their order.
  let pending = ""
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = undefined
    const text = pending
    pending = ""
    if (!text || !live()) return
    track({ type: "text-delta", text })
    if (current < 0) {
      pushLine({ kind: "assistant", text: "", done: false })
      current = state.lines.length - 1
    }
    edit(current, (l) => (l.text += text))
  }
  const closeText = () => {
    flush()
    edit(current, (l) => (l.done = true))
    current = -1
  }

  // todo_write inputs by call id; the panel updates only once a call is accepted.
  const todoCalls = new Map<string, unknown>()

  const controller = new AbortController()
  abort = controller
  setState({ streaming: true, activity: startActivity() })
  try {
    // @-mentions in what the user typed (not in pasted text: code there is full of "@").
    const attached = msg.notice ? undefined : await mentionsOf(runtime, msg.display ?? msg.text)
    if (attached && attached.files.length > 0) edit(userLine, (l) => (l.files = attached.files))
    if (!live() || controller.signal.aborted) return false
    const turn = runAgent({
      history: state.history,
      input: msg.text,
      images: [...(msg.images ?? []), ...(attached?.images ?? [])],
      attachments: attached?.parts,
      skills: state.skills,
      sticky: state.activeSkills,
      prevClock: state.clock,
      registry: runtime.registry,
      signal: controller.signal,
      sessionId: currentSession().id,
      // A notification is harness text, not the user's: no user-prompt hooks on it.
      hooks: msg.notice ? undefined : runtime.hooks,
      memory: runtime.memory,
      serverInstructions: () => runtime.mcp.instructions(),
    })
    for await (const event of turn) {
      if (!live()) continue
      if (event.type === "text-delta") {
        pending += event.text
        flushTimer ??= setTimeout(flush, FLUSH_MS)
        continue
      }
      flush()
      track(event)
      switch (event.type) {
        case "tool-start":
          closeText()
          pushLine({ kind: "tool", callId: event.callId, name: event.name, label: event.label, status: "running", step: event.step })
          if (event.name === TODO_WRITE) todoCalls.set(event.callId, event.input)
          break
        case "tool-end":
          edit(
            lineIndex((l) => l.kind === "tool" && l.callId === event.callId),
            (l) => Object.assign(l, { status: event.ok ? "ok" : "error", output: event.output, durationMs: event.durationMs }),
          )
          if (event.ok && event.chart) {
            pushLine({ kind: "chart", data: event.chart })
            currentSession().noteChart(event.callId, event.chart)
          }
          if (event.ok && todoCalls.has(event.callId)) {
            const parsed = TodoWriteInput.safeParse(todoCalls.get(event.callId))
            if (parsed.success) setState("liveTodos", parsed.data.todos)
          }
          break
        case "notice":
          pushLine({ kind: "info", text: event.text })
          break
        case "error":
          failed = true
          pushLine({ kind: "error", text: event.message })
          if (isContextOverflow(event.message)) pushLine({ kind: "info", text: "Hội thoại có thể đã quá dài cho model này: gõ /compact để nén rồi hỏi lại." })
          break
        case "done":
          if (event.usage) setState("contextTokens", event.usage.contextTokens)
          if (event.messages.length > 0) {
            setState("history", (history) => [...history, ...event.messages])
            recordTurn(event.messages, event.usage?.contextTokens)
          }
          if (event.clock) setState("clock", event.clock)
          break
      }
    }
    flush()
    if (live() && controller.signal.aborted) pushLine({ kind: "info", text: "Đã dừng." })
  } catch (error) {
    // Setup problems (no provider, model or key) are thrown before the turn starts.
    failed = true
    flush()
    if (live()) pushLine({ kind: "error", text: describeError(error) })
  } finally {
    // After /clear the buffer belongs to nothing; never let its timer fire into a later turn.
    clearTimeout(flushTimer)
    if (!live()) pending = ""
    const worked = state.activity ? activeMs(state.activity, now()) : 0
    if (live()) {
      closeText()
      // Someone looking at another window hears that the answer (or the error) is in.
      if (!controller.signal.aborted && !msg.notice) {
        const last = state.lines.findLast((l) => l.kind === "assistant" || l.kind === "error")
        const text = last && "text" in last ? last.text.replace(/\s+/g, " ").trim().slice(0, 120) : ""
        attention?.attention(failed ? "error" : "done", failed ? `Lỗi: ${text}` : text || "Đã trả lời xong")
      }
      // A long turn that ran to the end says how long it took (Claude Code's "Worked for").
      if (!failed && !controller.signal.aborted && worked >= DONE_LINE_MS) {
        pushLine({ kind: "done", ms: worked, background: backgroundRunning() || undefined })
      }
      // Tools still marked running never got a result (aborted turn).
      setState(
        produce((s) => {
          for (const l of s.lines) if (l.kind === "tool" && l.status === "running") Object.assign(l, { status: "error", output: "Đã dừng." })
        }),
      )
    }
    // History now holds the accepted calls (or, after an abort, none of this turn's).
    setState("liveTodos", undefined)
    setState({ streaming: false, activity: undefined })
    if (abort === controller) abort = undefined
  }
  return live() && !failed && !controller.signal.aborted
}

export function App(props: {
  runtime: Runtime
  resume?: string
  /** Tests replace the final step (destroy the renderer, end the process). */
  onExit?: () => void
}) {
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  const [draft, setDraft] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  /**
   * Who owns the keyboard instead of the prompt: an approval or a question from the model.
   * Every rule that hides the prompt, closes dialogs or reroutes Esc goes through this.
   */
  const owner = () => state.approval ?? state.question ?? state.autoOptIn
  /** The subagent panel's rows (ticks once a second so finished agents leave). */
  const panelTick = useNow(1000)
  const panelList = createMemo(() => panelAgents(panelTick()))
  // The selected row stays on the list as it changes; an empty panel gives the keys back.
  createEffect(() => {
    const at = state.panelFocus
    if (at === undefined) return
    const n = panelList().length
    if (n === 0 || owner() || state.dialog) setState("panelFocus", undefined)
    else if (at >= n) setState("panelFocus", n - 1)
  })
  /** Draft at which Esc closed the "/" list; it reopens as soon as the draft changes. */
  const [dismissedFor, setDismissedFor] = createSignal<string>()
  let input: TextareaRenderable | undefined

  /**
   * Leave: stop the running answer and wait — under one 2 s deadline — for it to be saved,
   * the session-end hook and MCP servers to stop (no orphaned child process), then restore
   * the terminal.
   */
  const exit = async () => {
    if (state.exiting) return
    if (props.onExit) return props.onExit()
    setState("exiting", true)
    abort?.abort()
    props.runtime.subagents.stopAll()
    await Promise.race([
      Promise.all([
        inflight ?? Promise.resolve(),
        props.runtime.subagents.flush(),
        props.runtime.hooks.emit({ type: "session-end", sessionId: currentSession().id }),
        props.runtime.mcp.stop(),
      ]),
      new Promise((r) => setTimeout(r, 2000)),
    ])
    attention?.clear()
    renderer.destroy()
    process.exit(0)
  }
  onExitRequest(() => void exit())
  onCleanup(() => onExitRequest(undefined))

  /**
   * Copy what the mouse highlighted (opencode's copy-on-select); true when something was
   * copied. `keep` leaves the highlight in place.
   */
  function copySelection(keep = false) {
    const text = cleanSelection(renderer.getSelection()?.getSelectedText() ?? "")
    if (!keep) renderer.clearSelection()
    if (!text) return false
    writeClipboard(text, (t) => renderer.copyToClipboardOSC52(t))
    flash(`Đã copy ${[...text].length} ký tự`, 2000, "success")
    return true
  }
  // A finished drag copies at once — no keystroke needed, like Claude Code in a terminal.
  const onSelection = () => {
    // Text highlighted inside the prompt stays highlighted, so typing or Backspace
    // replaces it as in a document editor.
    const selected = renderer.getSelection()?.selectedRenderables ?? []
    copySelection(selected.length > 0 && selected.every((r) => r === input))
    // A click/drag moves focus to what was clicked; typing must still go to the prompt.
    if (!state.dialog && !owner()) input?.focus()
  }
  renderer.on("selection", onSelection)
  onCleanup(() => renderer.off("selection", onSelection))

  const offMcp = props.runtime.mcp.onChange((status) => {
    announceMcp(state.mcp, status)
    setState("mcp", status)
  })
  onCleanup(() => offMcp())

  // Tools with side effects ask first. A pending question takes over the keyboard: any open
  // dialog closes so its keys cannot also act on the prompt.
  props.runtime.permissions.interactive = true
  // Questions from the model (ask_user) take over the same way; approval goes first.
  props.runtime.questions.interactive = true
  // The terminal hears what the agent does: progress ring, program status, notifications.
  attention = terminalAttention(renderer, () => state.terminalNotify)
  const onFocus = () => attention?.focus(true)
  const onBlur = () => attention?.focus(false)
  renderer.on("focus", onFocus)
  renderer.on("blur", onBlur)
  createEffect(() => attention?.setBusy(state.approval ? "permission" : state.question ? "question" : state.streaming ? "working" : "idle"))
  onCleanup(() => {
    renderer.off("focus", onFocus)
    renderer.off("blur", onBlur)
    attention?.clear()
    attention = undefined
  })
  const offQuestion = props.runtime.questions.onChange((head) => {
    if (head) attention?.attention("question", "Model đang hỏi bạn một câu")
    setState("question", head)
    if (!head) deliverNotices(props.runtime)
  })
  const offPending = props.runtime.permissions.onPending((pending) => setState("approvals", pending))
  const subagents = props.runtime.subagents
  // Runs of a session no longer shown (/clear, /new) still report while they stop: ignore them.
  const offAgents = subagents.onChange((view) => {
    if (view.sessionId === currentSession().id) setState("agents", view.id, reconcile(view))
  })
  const offSlots = subagents.limiter.onChange(() => setState("agentSlots", subagents.limiter.stats()))
  const offCharts = subagents.onChart((chart, view, callId) => {
    if (view.sessionId !== currentSession().id) return
    pushLine({ kind: "chart", data: chart })
    currentSession().noteChart(callId, chart)
  })
  // A background subagent finished: a line now, its result to the model when idle.
  const offFinished = subagents.onFinished((view) => {
    if (view.sessionId !== currentSession().id) return
    const stats = `${view.toolCount} tool · ${fmtTokens(view.usage.input + view.usage.output)} token · ${fmtSeconds((view.endedAt ?? Date.now()) - (view.startedAt ?? view.createdAt))}`
    const status = { completed: "xong", failed: "lỗi", stopped: "đã dừng" }[view.status as string] ?? view.status
    pushLine({ kind: "agent-notice", agentId: view.id, status, text: `Subagent nền ${view.type} (${view.description}) · ${status} · ${stats}${view.error ? ` · ${view.error}` : ""}` })
    setState("notices", (n) => [...n, notificationText(view)])
    deliverNotices(props.runtime)
  })
  subagents.onPersistError = (error) =>
    pushLine({ kind: "error", text: `Không lưu được transcript của subagent: ${error instanceof Error ? error.message : String(error)}` })
  onCleanup(() => {
    offPending()
    offAgents()
    offSlots()
    offCharts()
    offFinished()
  })
  setState("permissionMode", props.runtime.permissions.mode)
  const offAuto = props.runtime.auto.onChange(() => setState("autoPausedUntil", props.runtime.auto.paused()))
  onCleanup(() => offAuto())
  const offMode = props.runtime.permissions.onModeChange((mode) => setState("permissionMode", mode))
  onCleanup(() => offMode())
  createEffect(
    on(
      () => [Boolean(state.approval || state.question), Boolean(state.activity)] as const,
      ([waiting, active]) => {
        const a = state.activity
        if (!active || !a) return
        if (waiting && a.pausedAt === undefined) setState("activity", "pausedAt", now())
        else if (!waiting && a.pausedAt !== undefined) setState("activity", { pausedMs: a.pausedMs + (now() - a.pausedAt), pausedAt: undefined })
      },
    ),
  )
  const offApproval = props.runtime.permissions.onChange((head) => {
    if (head) attention?.attention("approval", `Cần bạn duyệt: ${truncate(head.label, 80)}`)
    setState("approval", head)
    if (!head) queueMicrotask(() => deliverNotices(props.runtime))
  })
  onCleanup(() => {
    offApproval()
    offQuestion()
    props.runtime.questions.interactive = false
    props.runtime.questions.cancelAll()
    props.runtime.permissions.interactive = false
    props.runtime.permissions.denyAll()
  })

  onMount(async () => {
    void props.runtime.mcp.start()
    const [config, skillSet, catalog, modelPrefs] = await Promise.all([loadConfig(), loadSkills(), loadCatalog(), loadModelPrefs()])
    const connected = await connectedProviders()
    // A key from an env var counts as connected even before /connect is used.
    setState({
      provider: config.provider ?? connected[0],
      model: config.model,
      skills: skillSet.skills,
      skillProblems: skillSet.problems,
      catalog,
      connected,
      compactCap: config.compactWindow ?? DEFAULT_COMPACT_WINDOW,
      tips: config.ui?.tips !== false,
      terminalNotify: config.ui?.terminalNotify !== false,
      scroll: scrollSetting(config.ui),
      autoCompactOff: config.autoCompact === "off",
      autoAcknowledged: config.permissions?.autoAcknowledged === true,
      modelPrefs,
    })
    // Set to open in ▸▸ auto without ever having said yes (config or /config): ask now.
    if (config.permissions?.defaultMode === "auto" && !state.autoAcknowledged) setState("autoOptIn", { from: props.runtime.permissions.mode })
    attachSubagents(props.runtime)
    await reloadAgents(props.runtime)
    if (state.agentProblems.length > 0) {
      pushLine({ kind: "error", text: `${state.agentProblems.length} file subagent bị lỗi và không được nạp. Xem /agents.` })
    }
    if (config.subagents?.maxConcurrent) props.runtime.subagents.setMax(config.subagents.maxConcurrent)
    setState("agentSlots", props.runtime.subagents.limiter.stats())
    if (props.resume) await resumeFromArgs(props.runtime, props.resume)
    else await props.runtime.hooks.emit({ type: "session-start", sessionId: currentSession().id, source: "startup" })
    if (skillSet.problems.length > 0) {
      pushLine({ kind: "error", text: `${skillSet.problems.length} skill bị lỗi và không được nạp. Xem /skills.` })
    }
  })

  /** MCP prompts as `/server:prompt` commands, from every connected server. */
  const promptCommands = createMemo<(CommandInfo & { server: string; prompt: string })[]>(() =>
    state.mcp.flatMap((s) =>
      s.state === "connected"
        ? s.prompts.map((p) => ({
            name: `${s.name}:${p.name}`,
            args: promptUsage(p.arguments) || undefined,
            argsRequired: p.arguments.some((a) => a.required),
            description: p.description?.split("\n")[0] ?? `Prompt của MCP server ${s.name}`,
            server: s.name,
            prompt: p.name,
          }))
        : [],
    ),
  )

  const allCommands = createMemo<CommandInfo[]>(() => [...COMMANDS, ...promptCommands()])

  /**
   * The "/" list, Claude Code style: open while the draft is "/" + a command name (no
   * space yet), ranked (exact, prefix, substring, description), and closed by Esc until
   * the draft changes.
   */
  const suggestions = createMemo(() => {
    const d = draft()
    if (!d.startsWith("/") || /\s/.test(d) || d === dismissedFor()) return []
    return rank(allCommands(), d.slice(1), (c) => c.name, (c) => c.description)
  })
  const commandItems = createMemo(() => suggestions().map(commandItem))
  const allCommandItems = createMemo(() => allCommands().map(commandItem))

  /**
   * The `@` list (Claude Code, opencode): open while the word before the cursor starts with
   * `@`, files and folders of the workspace ranked against what follows, closed by Esc until
   * the draft changes.
   */
  const [cursor, setCursor] = createSignal(0)
  const fileIndex = new FileIndex(props.runtime.workspace.primary, props.runtime.workspace.env())
  const [indexed, setIndexed] = createSignal(0)
  const mention = createMemo(() => {
    const d = draft()
    if (d.startsWith("/") || d === dismissedFor()) return undefined
    const before = offsetSlice(d, 0, cursor())
    const m = /(^|\s)@("?)([^\s"]*)$/.exec(before)
    if (!m) return undefined
    return { query: m[3]!, start: offsetWidth(before) - offsetWidth(`@${m[2]}${m[3]}`), end: cursor() }
  })
  // Opening the list (re)builds a stale index in the background; the list fills in when it ends.
  createEffect(
    on(
      () => mention() !== undefined,
      (open) => {
        if (open) void fileIndex.refresh().then((rebuilt) => rebuilt && setIndexed((n) => n + 1))
      },
    ),
  )
  const fileMatches = createMemo(() => {
    const m = mention()
    indexed()
    return m ? matchPaths(fileIndex.current(), m.query, 50) : []
  })
  // Nothing matches: maybe the file was made a moment ago. Look again, once per query and at
  // most once a second (an "@FPT" that is no file must not rescan the folder on every key).
  let missed: string | undefined
  createEffect(() => {
    const m = mention()
    if (!m || fileMatches().length > 0 || m.query === missed) return
    missed = m.query
    void fileIndex.refreshAfter(INDEX_MISS_MS).then((rebuilt) => rebuilt && setIndexed((n) => n + 1))
  })
  const fileItems = createMemo(() => fileMatches().map((p) => ({ label: `@${p.rel}`, description: p.dir ? "thư mục" : "" })))
  const fileNote = () => (props.runtime.workspace.fallbackReason ? `tìm trong ${props.runtime.workspace.primary} (mở OpenTrading ở ${props.runtime.workspace.fallbackReason})` : undefined)

  /**
   * Put the highlighted path in place of the `@word`: a pill (one Backspace deletes it). Tab
   * on a folder opens it instead (`@dir/`, the list goes on inside it), as in opencode.
   */
  function pickFile(open: boolean) {
    const m = mention()
    const p = fileMatches()[selected()]
    if (!m || !p || !input) return
    input.setSelection(m.start, m.end)
    if (open && p.dir) {
      input.deleteSelection()
      input.insertText(`@${p.rel}`)
      return
    }
    parts.insert({ kind: "file", mention: mentionText(p.rel) })
  }

  /** After "/name " (with the space): the arguments the command takes, shown under the list's place. */
  const argHint = createMemo(() => {
    const m = /^\/(\S+) $/.exec(draft())
    if (!m) return undefined
    const c = allCommands().find((x) => x.name.toLowerCase() === m[1]!.toLowerCase())
    return c?.args ? c : undefined
  })

  /** `/mcp enable|disable|reconnect <name>` without opening the panel (as in Claude Code). */
  /** `/watchlist [tên]` opens the panel; `new|add|rm|rename|del …` edit the personal lists. */
  async function watchlistCommand(args: string) {
    const [sub = "", ...rest] = args.split(/\s+/).filter(Boolean)
    const home = props.runtime.home
    const usage = "Dùng: /watchlist new <tên> · add <tên> <mã…> · rm <tên> <mã…> · rename <tên> <tên mới> · del <tên>"
    try {
      switch (sub.toLowerCase()) {
        case "new":
          if (!rest[0]) return pushLine({ kind: "error", text: usage })
          return say(await watchlistOps.create(home, rest[0]), "success")
        case "add":
        case "rm":
          if (!rest[0] || rest.length < 2) return pushLine({ kind: "error", text: usage })
          return say(await (sub.toLowerCase() === "add" ? watchlistOps.add : watchlistOps.remove)(home, rest[0], rest.slice(1)), "success")
        case "rename":
          if (rest.length < 2) return pushLine({ kind: "error", text: usage })
          return say(await watchlistOps.rename(home, rest[0]!, rest[1]!), "success")
        case "del":
          if (!rest[0]) return pushLine({ kind: "error", text: usage })
          return say(await watchlistOps.delete(home, rest[0]), "success")
        default:
          focusWatchlist(sub || undefined)
          return setState("dialog", "watchlist")
      }
    } catch (error) {
      say(error instanceof Error ? error.message : String(error), "error")
    }
  }

  /** The conversation as Markdown, or undefined (with the reason shown) when there is none yet. */
  async function transcriptOrSay() {
    if (state.streaming) return void say("Đang trả lời; chờ xong rồi lưu hội thoại.", "warning")
    const transcript = await transcriptOfCurrent(props.runtime)
    if (!transcript) say("Chưa có lượt nào để lưu.")
    return transcript
  }

  /** `/save`: the whole conversation to the clipboard, like selecting everything and copying. */
  async function saveCommand() {
    try {
      const transcript = await transcriptOrSay()
      if (!transcript) return
      const { text } = transcript
      const sent = writeClipboard(text, (t) => renderer.copyToClipboardOSC52(t), { maxOsc52: MAX_OSC52_CHARS, timeoutMs: 15_000 })
      const size = `${transcript.turns} lượt, ${[...text].length} ký tự`
      if (await sent.native) return say(`Đã copy toàn bộ hội thoại vào clipboard (${size}).`, "success")
      if (sent.osc52) return say(`Đã gửi hội thoại cho terminal copy (OSC52, ${size}); nếu dán không ra, dùng /export.`, "info", 8000)
      say("Không copy được vào clipboard. Dùng /export để lưu ra file.", "error")
    } catch (error) {
      say(`Không lưu được hội thoại: ${error instanceof Error ? error.message : String(error)}`, "error")
    }
  }

  /** `/export [đường dẫn] [--force]`: the conversation as a Markdown file. */
  async function exportCommand(args: string) {
    try {
      const transcript = await transcriptOrSay()
      if (!transcript) return
      const { file, overwrite } = resolveExportPath(args, { cwd: process.cwd(), id: transcript.id })
      await writeExport(file, transcript.text, { overwrite })
      pushLine({ kind: "info", text: `✓ Đã lưu hội thoại (${transcript.turns} lượt): ${file}` })
    } catch (error) {
      pushLine({ kind: "error", text: `Không xuất được hội thoại: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  /** `/add-dir [thư mục] [--luu]`: add a workspace folder for this session (and keep it with --luu). */
  async function addDirCommand(args: string) {
    const workspace = props.runtime.workspace
    const keep = /(^|\s)--luu$/.test(args)
    const raw = args.replace(/(^|\s)--luu$/, "").trim()
    if (!raw) {
      return pushLine({
        kind: "info",
        text: `Workspace: ${workspace.roots().join(" · ")}${workspace.fallbackReason ? ` (mở ở ${workspace.fallbackReason} nên dùng thư mục riêng)` : ""}. Thêm thư mục: /add-dir <đường dẫn> [--luu]`,
      })
    }
    const added = workspace.add(raw)
    if ("error" in added) return say(added.error, "error")
    if (keep) {
      try {
        const config = await loadConfig()
        const dirs = [...new Set([...(config.workspace?.dirs ?? []), added.dir])]
        await saveConfig({ workspace: { ...config.workspace, dirs } })
      } catch (error) {
        return say(`Đã thêm ${added.dir} cho phiên này nhưng không lưu được cấu hình: ${error instanceof Error ? error.message : String(error)}`, "error")
      }
    }
    say(`Đã thêm ${added.dir} vào workspace${keep ? " (đã lưu cho các phiên sau)" : " cho phiên này (thêm --luu để giữ cho các phiên sau)"}.`, "success", 6000)
  }

  /** `/undo` lists this run's file changes; `/undo <n> [--force]` puts change n back. */
  async function undoCommand(args: string) {
    const history = props.runtime.history
    const m = args.match(/^(\d+)(\s+--force)?$/)
    if (!args.trim()) {
      const changes = history.list()
      if (changes.length === 0) return pushLine({ kind: "info", text: "Chưa có thay đổi file nào trong lần chạy này (chỉ write_file/edit_file mới hoàn tác được)." })
      const rows = changes.slice(0, 15).map((c) => `${c.n}. ${c.at.slice(11, 19)} ${c.tool} ${c.created ? "tạo" : "sửa"} ${c.path}${c.undone ? " (đã hoàn tác)" : ""}`)
      return pushLine({ kind: "info", text: ["Thay đổi file (mới nhất trước) — /undo <số> để hoàn tác:", ...rows].join("\n") })
    }
    if (!m) return pushLine({ kind: "error", text: "Dùng: /undo (xem danh sách) hoặc /undo <số> [--force]." })
    try {
      const result = await history.undo(Number(m[1]), !!m[2])
      if ("error" in result) return say(result.error, "error")
      props.runtime.files.forget(history.list().find((c) => c.n === Number(m[1]))!.path)
      say(result.ok, "success", 6000)
    } catch (error) {
      say(`Không hoàn tác được: ${error instanceof Error ? error.message : String(error)}`, "error")
    }
  }

  async function mcpCommand(args: string) {
    const [action, name] = args.split(/\s+/)
    const known = state.mcp.some((s) => s.name === name)
    if (!name || !known || !["enable", "disable", "reconnect"].includes(action ?? "")) {
      return pushLine({ kind: "error", text: "Dùng: /mcp enable|disable|reconnect <tên server> (hoặc /mcp để mở bảng quản lý)." })
    }
    try {
      if (action === "reconnect") await props.runtime.mcp.restart(name)
      else await props.runtime.mcp.setEnabled(name, action === "enable")
      const s = state.mcp.find((x) => x.name === name)
      say(`MCP "${name}": ${s ? STATUS[s.state].text : "?"}${s?.error ? ` — ${s.error}` : ""}`, s?.state === "failed" ? "error" : "success")
    } catch (error) {
      say(`/mcp ${action} ${name}: ${error instanceof Error ? error.message : String(error)}`, "error")
    }
  }

  /** Fetch an MCP prompt with the typed arguments and send it as the user's message. */
  async function runPrompt(command: { server: string; prompt: string; name: string }, rawArgs: string) {
    const info = state.mcp.find((s) => s.name === command.server)?.prompts.find((p) => p.name === command.prompt)
    if (!info) return say(`Không còn prompt /${command.name}.`, "error")
    const parsed = parsePromptArgs(info.arguments, rawArgs)
    if ("error" in parsed) return say(`/${command.name}: ${parsed.error}`, "error")
    try {
      const text = await props.runtime.mcp.getPrompt(command.server, command.prompt, parsed.values)
      if (!text.trim()) return say(`Prompt /${command.name} không có nội dung.`, "error")
      // What is sent in the user's name is shown in full as their message.
      pushLine({ kind: "info", text: `Prompt /${command.name} của server ${command.server}:` })
      // The classifier reads what the user typed as theirs and the server's template as harness text.
      props.runtime.auto.log.turn(`/${command.name} ${rawArgs}`.trim())
      props.runtime.auto.log.markHarness(text)
      void send(props.runtime, text)
    } catch (error) {
      say(`/${command.name}: ${error instanceof Error ? error.message : String(error)}`, "error")
    }
  }

  /** Pills in the prompt: `[Pasted text #1 +49 lines]`, `[Image #2]`, `@src/x.ts`. */
  const parts = new PromptParts(
    () => input,
    () => promptStyle(renderer.nativeScene).getStyleId("extmark.paste") ?? undefined,
    () => promptStyle(renderer.nativeScene).getStyleId("extmark.file") ?? undefined,
  )

  /**
   * Replace the draft; the cursor goes to the end (or the start, for an entry recalled with
   * ↑). `saved` turns known labels back into pills.
   */
  function setInput(value: string, cursor: "start" | "end" = "end", saved?: Omit<DraftSnapshot, "text">) {
    if (input) {
      input.setText(value)
      parts.restore(saved)
      if (cursor === "start") input.gotoBufferHome()
      else input.gotoBufferEnd()
      setCursor(input.cursorOffset)
    }
    setDraft(value)
    setSelected(0)
    if (value !== dismissedFor()) setDismissedFor(undefined)
  }
  /** Remember what is in the box (with the pastes behind its pills) before clearing it. */
  function rememberDraft() {
    const snap = parts.snapshot()
    addHistory(snap.text, snap.pastes)
  }

  /** Ctrl+V / Alt+V, or an empty paste (Windows Terminal with only an image copied). */
  async function pasteImage() {
    flash("Đang đọc ảnh từ clipboard…", 15_000)
    const image = await readClipboardImage()
    if (!image) return flash(`Không có ảnh trong clipboard · ${process.platform === "win32" ? "alt+v" : "ctrl+v"} để dán ảnh`, 3000, "warning")
    attachImage(image)
  }
  function attachImage(image: PromptImage) {
    if (image.data.length > MAX_IMAGE_BASE64) return flash("Ảnh quá lớn để gửi (tối đa 5 MB)", 4000, "error")
    parts.insert({ kind: "image", ...image })
    flash("Đã đính ảnh", 1500, "success")
  }
  /** A paste: an image path becomes `[Image #N]`, a long text `[Pasted text #N +X lines]`. */
  function onPaste(text: string) {
    if (!input) return
    if (!text.trim()) return void pasteImage()
    const file = imagePath(text)
    if (file) {
      void readImageFile(file).then((image) => (image ? attachImage(image) : input?.insertText(text)))
      return
    }
    if (isLargePaste(text)) return void parts.insert({ kind: "text", text })
    input.insertText(text)
  }

  /** ↑/↓ through earlier prompts (slash commands included), Claude Code style. */
  const recall = new HistoryCursor()
  void loadHistory()
  function showRecalled(text: string, cursor: "start" | "end", saved: Omit<DraftSnapshot, "text"> | undefined = { pastes: pastesFor(text) }) {
    setInput(text, cursor, saved)
    // A recalled "/model" must not open the "/" list: the next ↑ would move in the list
    // instead of going further back.
    setDismissedFor(text)
  }
  /**
   * ↑ moves up a line first; only when the cursor cannot go higher does it bring back the
   * previous prompt (the cursor then sits at its start, so another ↑ goes further back).
   */
  function historyKey(evt: KeyEvent, direction: "up" | "down") {
    if (!input || input.hasSelection()) return
    evt.preventDefault()
    // ↑ on an empty prompt first takes back the queued messages, to edit them.
    if (direction === "up" && !draft() && state.queue.length > 0) {
      const items = [...state.queue]
      setState("queue", [])
      return pullBack(items)
    }
    const before = input.cursorOffset
    if (direction === "up") input.moveCursorUp()
    else input.moveCursorDown()
    if (input.cursorOffset !== before) return
    const text = direction === "up" ? recall.up(input.plainText) : recall.down(input.plainText)
    if (text !== undefined) showRecalled(text, direction === "up" ? "start" : "end")
    // Past the newest entry, on the draft's last line: ↓ goes on into the subagent panel.
    else if (direction === "down" && panelList().length > 0) setState("panelFocus", 0)
  }

  /**
   * Ctrl+G: write the prompt in $EDITOR (Notepad by default on Windows). Pastes come out in
   * full; those left untouched go back into their pills.
   */
  async function openEditor() {
    const snap = parts.snapshot()
    const result = await editInEditor(parts.expand().text, renderer)
    input?.focus()
    if ("error" in result) return flash(result.error, 6000, "error")
    if (result.returnedAtOnce) {
      return flash('Trình soạn thảo đóng ngay (Notepad có thể đã mở thành tab) · đặt biến EDITOR, ví dụ "code --wait"', 6000, "warning")
    }
    let text = result.text
    for (const [id, content] of Object.entries(snap.pastes ?? {})) {
      const at = text.indexOf(content)
      if (at >= 0) text = text.slice(0, at) + pasteLabel(Number(id), content) + text.slice(at + content.length)
    }
    setInput(text, "end", snap)
  }

  /** Queued messages back into the box (joined by line breaks), ahead of any draft. */
  function pullBack(items: Queued[]) {
    const current = parts.snapshot()
    const all = [...items, ...(current.text.trim() ? [{ display: current.text, saved: current }] : [])]
    const saved = {
      pastes: Object.assign({}, ...all.map((i) => i.saved.pastes ?? {})),
      images: Object.assign({}, ...all.map((i) => i.saved.images ?? {})),
    }
    setInput(all.map((i) => i.display).join("\n"), "end", saved)
  }
  returnQueue = (items) => {
    pullBack(items)
    flash("Tin đang chờ đã được trả về ô nhập", 4000, "warning")
  }
  onCleanup(() => (returnQueue = undefined))

  /** Ctrl+S: put the draft aside (or bring it back); it also returns after the next send. */
  let stash: DraftSnapshot | undefined
  function toggleStash() {
    if (draft().trim()) {
      stash = parts.snapshot()
      setInput("")
      flash("Đã cất bản nháp · ctrl+s để lấy lại", 3000, "success")
    } else if (stash !== undefined) {
      setInput(stash.text, "end", stash)
      stash = undefined
    }
  }
  function restoreStash() {
    if (stash === undefined || draft()) return
    setInput(stash.text, "end", stash)
    stash = undefined
  }

  /** Esc twice on a draft clears it (saved to history first, so ↑ brings it back). */
  let escArmedAt = 0
  function escapeClear(evt: KeyEvent) {
    // Two quick presses can arrive in one read ("\x1b\x1b", parsed as alt+escape).
    if (evt.sequence === "\x1b\x1b" || Date.now() - escArmedAt <= EXIT_WINDOW_MS) {
      escArmedAt = 0
      rememberDraft()
      recall.reset()
      setInput("")
      return
    }
    escArmedAt = Date.now()
    flash("Esc lần nữa để xoá ô nhập", EXIT_WINDOW_MS)
  }

  /**
   * Ctrl+R: search earlier prompts as you type; the input shows the newest match. Ctrl+R
   * again goes to an older match, Enter sends it, Tab/Esc keep it in the input to edit,
   * Ctrl+C gives the draft back.
   */
  const [search, setSearch] = createSignal<{ query: string; skip: number; original: DraftSnapshot }>()
  const searchMatches = createMemo(() => {
    const s = search()
    return s ? searchHistory(s.query) : []
  })
  function showSearch(next: { query: string; skip: number; original: DraftSnapshot }) {
    setSearch(next)
    const match = searchMatches()[next.skip]
    if (match !== undefined) showRecalled(match, "end")
  }
  function searchKey(evt: KeyEvent) {
    const s = search()!
    evt.preventDefault()
    const end = () => {
      setSearch(undefined)
      recall.reset()
    }
    if (evt.ctrl && evt.name === "c") {
      end()
      return setInput(s.original.text, "end", s.original)
    }
    if (evt.ctrl && evt.name === "r") {
      if (s.skip + 1 < searchMatches().length) showSearch({ ...s, skip: s.skip + 1 })
      return
    }
    if (evt.name === "return" || evt.name === "kpenter") {
      end()
      return submit()
    }
    if (evt.name === "backspace") {
      if (!s.query) {
        end()
        return setInput(s.original.text, "end", s.original)
      }
      return showSearch({ ...s, query: s.query.slice(0, -1), skip: 0 })
    }
    if (!evt.ctrl && !evt.meta && evt.sequence && evt.sequence.length >= 1 && evt.sequence.charCodeAt(0) >= 32 && evt.sequence !== "\x7f") {
      return showSearch({ ...s, query: s.query + evt.sequence, skip: 0 })
    }
    // Tab, Esc, arrows, anything else: keep the match in the input and edit it there.
    end()
  }

  /**
   * Ctrl+C / Ctrl+D like Claude Code: the first press does the nearest useful thing and
   * says "press again to exit"; a second press within 800 ms exits. Ctrl+C with text
   * highlighted copies it instead. Ctrl+D only counts on an empty prompt.
   */
  function onQuitKey(name: "c" | "d") {
    if (name === "c" && renderer.hasSelection && copySelection()) return
    const key = name === "c" ? "Ctrl+C" : "Ctrl+D"
    if (name === "d" && (draft() || owner() || state.dialog)) return
    if (state.exitArmed === key) return void exit()
    if (name === "c") {
      // An approval or question answers Ctrl+C itself (like Esc: deny / skip).
      if (owner()) {
        // handled by the prompt's own keyboard hook
      } else if (state.dialog) closeDialog()
      else if (draft()) {
        // Cleared, not lost: ↑ brings it back (Codex, Claude Code).
        rememberDraft()
        recall.reset()
        setInput("")
      }
      else if (state.streaming) abort?.abort()
    }
    armExit(key)
  }

  /** Tab: put the highlighted command in the input ("/name ") without running it; the list closes. */
  function complete() {
    const c = suggestions()[selected()]
    if (c) setInput(`/${c.name} `)
  }

  /**
   * Enter. With the "/" list open it runs the highlighted command — or, when the command
   * cannot run without arguments, fills "/name " and waits (Claude Code). Otherwise a
   * "/…" line is a command (unknown ones are reported, never sent to the model) and
   * anything else is a message.
   */
  /** Enter in the prompt: what the box shows, with its pills expanded. With the `@` list open, it picks. */
  function submit() {
    if (fileMatches().length > 0) return pickFile(false)
    run(input?.plainText ?? draft(), parts.expand())
  }

  function run(value: string, expanded?: ExpandedPrompt) {
    const shown = value.trim()
    // What the model gets: pasted text put back in place of its pill.
    const text = (expanded?.text ?? value).trim()
    const images = expanded?.images ?? []
    const list = suggestions()
    const highlighted = list[selected()]
    recall.reset()
    if (highlighted && list.length > 0) {
      if (highlighted.argsRequired) return setInput(`/${highlighted.name} `)
      addHistory(`/${highlighted.name}`)
      setInput("")
      runCommand(highlighted.name.toLowerCase(), "")
      return restoreStash()
    }
    if (!text && images.length === 0) return setInput("")
    // Every line sent or run is remembered for ↑ — typos in a command name too, to fix them.
    addHistory(shown, expanded?.pastes)
    const cmd = parseCommand(text)
    if (!cmd) {
      if (text.startsWith("/")) return setInput("") // "/" alone or "/ text": nothing to run, nothing to send
      const target = state.provider && state.model ? { provider: state.catalog[state.provider]!, model: state.model } : undefined
      if (images.length > 0 && target?.provider && !acceptsImageInput(target)) {
        // Keep the draft: switch model or delete the image, then send again.
        return say(`Model ${state.model} không đọc được ảnh. Đổi model bằng /model, hoặc xoá ${images.length > 1 ? "các ảnh" : "ảnh"} khỏi ô nhập rồi gửi lại.`, "error")
      }
      const saved = expanded ? parts.snapshot() : {}
      setInput("")
      restoreStash()
      // Typed while an answer is streaming: sent when it ends (Claude Code), ↑ to edit it.
      if (state.streaming) return void setState("queue", (q) => [...q, { text, display: shown, images, saved }])
      void send(props.runtime, { text, display: shown, images })
      return
    }
    const known = allCommands().some((c) => c.name.toLowerCase() === cmd.name) || cmd.name === "quit"
    if (!known) {
      // Keep what was typed so it can be fixed.
      return say(`Không có lệnh /${cmd.name}. Gõ /help để xem các lệnh.`, "error")
    }
    setInput("")
    runCommand(cmd.name, cmd.args)
    restoreStash()
  }

  function runCommand(name: string, args: string) {
    const cmd = { name, args }
    const promptCmd = promptCommands().find((c) => c.name.toLowerCase() === cmd.name)
    if (promptCmd) {
      if (state.streaming) return say("Đang trả lời; chờ xong rồi chạy prompt.", "warning")
      return void runPrompt(promptCmd, cmd.args)
    }
    switch (cmd.name) {
      case "connect":
      case "model":
      case "skills":
      case "help":
      case "tools":
      case "context":
      case "sessions":
      case "permissions":
        // Rules edited by hand in config.json take effect from here on.
        void props.runtime.permissions.refreshRules()
        return setState("dialog", cmd.name)
      case "memory":
      case "config":
      case "agents":
      case "tasks":
        return setState("dialog", cmd.name)
      case "profile":
        return void ensureProfile().then(({ file, created }) =>
          pushLine({
            kind: "info",
            text: created
              ? `Đã tạo hồ sơ nhà đầu tư mẫu: ${file}. Mở file để sửa; OpenTrading đọc lại ở mỗi lượt hỏi.`
              : `Hồ sơ nhà đầu tư: ${file}. Sửa file này; thay đổi có hiệu lực từ lượt hỏi tiếp theo.`,
          }),
        )
      case "skill":
        return cmd.args ? toggleSkill(cmd.args) : setState("dialog", "skills")
      case "mcp":
        return cmd.args ? void mcpCommand(cmd.args) : setState("dialog", "mcp")
      case "watchlist":
        return void watchlistCommand(cmd.args)
      case "clear":
      case "new":
        return void clearTranscript(props.runtime)
      case "compact":
        if (state.streaming) return say("Đang trả lời; chờ xong rồi nén.", "warning")
        // Messages typed while it runs are queued: send them (or give them back) afterwards.
        return void compact(props.runtime, "manual", cmd.args || undefined).then((ok) => afterTurn(props.runtime, ok))
      case "save":
        return void saveCommand()
      case "export":
        return void exportCommand(cmd.args)
      case "add-dir":
        return void addDirCommand(cmd.args)
      case "undo":
        return void undoCommand(cmd.args)
      case "exit":
      case "quit":
        return void exit()
      default:
        say(`Không có lệnh /${cmd.name}. Gõ /help để xem các lệnh.`, "error")
    }
  }

  /** A first x on a panel row only asks; a second x on the same row within the window stops it. */
  let stopArmed: { id: string; at: number } | undefined

  /**
   * Keys while a panel row is selected: ↑↓ move (↑ on the first row goes back to the prompt),
   * enter opens the agent in /tasks, x twice (or ctrl+x, as in /tasks) stops it, esc goes back;
   * any other key goes back to the prompt, a typed character landing in it. Stopping asks twice
   * because a stray ↓ then a word starting with "x" must not throw away a running agent's work.
   */
  function panelKey(evt: KeyEvent) {
    const list = panelList()
    const at = Math.min(state.panelFocus ?? 0, list.length - 1)
    const agent = list[at]
    const plain = !evt.ctrl && !evt.meta
    const stopKey = evt.name === "x" && !evt.meta
    if (!stopKey) stopArmed = undefined
    if (evt.name === "up" || evt.name === "down" || evt.name === "return" || evt.name === "escape" || stopKey) evt.preventDefault()
    if (evt.name === "up") return setState("panelFocus", at <= 0 ? undefined : at - 1)
    if (evt.name === "down") return setState("panelFocus", Math.min(list.length - 1, at + 1))
    if (evt.name === "escape") return setState("panelFocus", undefined)
    if (evt.name === "return") {
      if (!agent) return setState("panelFocus", undefined)
      return setState({ panelFocus: undefined, tasksFocus: agent.id, dialog: "tasks" })
    }
    if (stopKey) {
      if (!agent || (agent.status !== "running" && agent.status !== "queued")) return
      const name = `${agent.type} (${truncate(agent.description, 40)})`
      const confirmed = evt.ctrl || (stopArmed?.id === agent.id && Date.now() - stopArmed.at <= STOP_WINDOW_MS)
      if (!confirmed) {
        stopArmed = { id: agent.id, at: Date.now() }
        return flash(`Nhấn x lần nữa để dừng ${name}`, STOP_WINDOW_MS, "warning")
      }
      stopArmed = undefined
      if (props.runtime.subagents.stop(agent.id)) say(`Đã dừng subagent ${name}`, "success")
      return
    }
    setState("panelFocus", undefined)
    if (plain && evt.sequence && evt.sequence.length === 1 && evt.sequence >= " ") {
      evt.preventDefault()
      input?.insertText(evt.sequence)
    }
  }

  useKeyboard((evt) => {
    if (evt.eventType === "release") return
    if (search() && !owner() && !state.dialog) return searchKey(evt)
    if (evt.ctrl && (evt.name === "c" || evt.name === "d")) return onQuitKey(evt.name)
    if (evt.ctrl && evt.name === "o") return void setState("expandTools", (v) => !v)
    if (evt.name === "escape" && renderer.hasSelection) {
      evt.preventDefault()
      input?.clearSelection()
      return renderer.clearSelection()
    }
    if (owner() || state.dialog) return
    if (state.panelFocus !== undefined) return panelKey(evt)
    // The chat scrolls from the keyboard too (opencode): PageUp/PageDown half a screen,
    // Ctrl+Home/Ctrl+End to the start/end (plain Home/End stay with the prompt).
    const move =
      evt.name === "pageup" ? "page-up" : evt.name === "pagedown" ? "page-down" : evt.ctrl && evt.name === "home" ? "top" : evt.ctrl && evt.name === "end" ? "bottom" : undefined
    if (move && scrollTranscript(move)) return evt.preventDefault()
    const n = suggestions().length
    // "?" on an empty prompt: the keys at a glance (Claude Code). Typed anywhere else it is text.
    // The textarea's own text: draft() follows it a moment later, so fast typing would lose a "?".
    if (evt.sequence === "?" && !evt.ctrl && !evt.meta && n === 0 && !(input?.plainText ?? draft())) {
      evt.preventDefault()
      return setState("dialog", "shortcuts")
    }
    // Esc closes the "/" or "@" list first (it stays closed until the draft changes) and never
    // also stops the running answer.
    if (evt.name === "escape" && (n > 0 || fileMatches().length > 0)) {
      evt.preventDefault()
      setDismissedFor(draft())
      return
    }
    if (evt.name === "escape" && state.streaming) return void abort?.abort()
    if (evt.name === "escape" && draft()) {
      evt.preventDefault()
      return escapeClear(evt)
    }
    if (evt.ctrl && evt.name === "r") {
      evt.preventDefault()
      return showSearch({ query: "", skip: 0, original: parts.snapshot() })
    }
    if (evt.ctrl && evt.name === "s") {
      evt.preventDefault()
      return toggleStash()
    }
    if (evt.ctrl && evt.name === "g") {
      evt.preventDefault()
      return void openEditor()
    }
    // Permission mode: Shift+Tab, or Alt+M where the terminal does not send Shift+Tab
    // (Claude Code defaultBindings.ts). Not while a prompt or dialog owns the keys (checked above).
    if ((evt.name === "tab" && evt.shift) || (evt.meta && evt.name === "m")) {
      evt.preventDefault()
      const next = cycleMode(props.runtime.permissions.mode)
      // The first time, auto waits for a yes in the opt-in dialog; the gate keeps its mode.
      if (next === "auto" && !state.autoAcknowledged) return void setState("autoOptIn", { from: props.runtime.permissions.mode })
      return props.runtime.permissions.setMode(next)
    }
    // Paste an image from the clipboard: Alt+V (Windows Terminal keeps Ctrl+V for its own
    // text paste, as in Claude Code), or Ctrl+V where the terminal passes the key through.
    if ((evt.meta || evt.ctrl) && evt.name === "v" && !evt.shift) {
      evt.preventDefault()
      return void pasteImage()
    }
    // The "@" list: ↑↓ choose, Tab fills (opens a folder), Enter picks (submit()).
    const k = fileMatches().length
    if (n === 0 && k > 0) {
      if (evt.name === "tab" && !evt.shift) {
        evt.preventDefault()
        return pickFile(true)
      }
      if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
        evt.preventDefault()
        return setSelected((i) => (i + k - 1) % k)
      }
      if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
        evt.preventDefault()
        return setSelected((i) => (i + 1) % k)
      }
    }
    // With the list closed, Tab does nothing special (no autofill) and the arrows walk
    // through the prompt history.
    if (n === 0) {
      const plain = !evt.ctrl && !evt.meta && !evt.shift
      // "\" then Enter: a new line, for terminals that send Shift+Enter as Enter (Claude Code).
      if (plain && evt.name === "return" && input) {
        const at = input.cursorOffset
        if (at > 0 && input.getTextRange(at - 1, at) === "\\") {
          evt.preventDefault()
          input.deleteCharBackward()
          input.newLine()
        }
        return
      }
      if ((plain && evt.name === "up") || (evt.ctrl && evt.name === "p")) return historyKey(evt, "up")
      if ((plain && evt.name === "down") || (evt.ctrl && evt.name === "n")) return historyKey(evt, "down")
      return
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      complete()
    } else if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setSelected((i) => (i + n - 1) % n)
    } else if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setSelected((i) => (i + 1) % n)
    }
  })

  return (
    <box width={dims().width} height={dims().height} backgroundColor={color.bg}>
      <Background quiet={state.lines.length > 0} />
      <box position="absolute" left={0} top={0} width="100%" height="100%" zIndex={1} flexDirection="column">
        {/* Tall panels below (/mcp, approval) shrink this area; clip it instead of letting
            flexbox squeeze rows on top of each other. */}
        <box flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" flexDirection="column">
          <Show when={state.lines.length > 0} fallback={<Show when={!state.dialog}>{<Home />}</Show>}>
            <Transcript />
          </Show>
        </box>

        <Show when={state.activity && !owner() && !state.dialog}>
          <ActivityRow tips={state.tips} />
        </Show>
        <Show when={!owner() && !state.dialog}>
          <TodoPanel />
        </Show>
        <Show when={suggestions().length > 0 && !owner() && !state.dialog}>
          <Suggestions items={commandItems()} all={allCommandItems()} selected={selected()} />
        </Show>
        <Show when={suggestions().length === 0 && fileItems().length > 0 && !owner() && !state.dialog}>
          <Suggestions items={fileItems()} all={fileItems()} selected={selected()} noun="mục" note={fileNote()} hint="↑↓ chọn · enter gắn file · tab điền (mở thư mục) · esc đóng" />
        </Show>
        <Show when={!owner() && !state.dialog && search()}>
          {(s) => (
            <box marginLeft={2} marginRight={2} paddingLeft={1} flexShrink={0} backgroundColor={color.bg}>
              <text fg={color.tx2} wrapMode="none">
                {`${searchMatches().length > 0 ? "tìm trong lịch sử" : "không thấy prompt nào khớp"}: ${s().query}`}
                <span style={{ fg: color.tx3 }}>{"   ctrl+r cũ hơn · enter gửi · tab/esc sửa · ctrl+c huỷ"}</span>
              </text>
            </box>
          )}
        </Show>
        {/* Messages waiting for the answer to finish (Claude Code shows them above the prompt). */}
        <Show when={!owner() && !state.dialog && state.queue.length > 0}>
          <box marginLeft={2} marginRight={2} paddingLeft={1} flexShrink={0} flexDirection="column" backgroundColor={color.bg}>
            <For each={state.queue}>
              {(item) => (
                <text fg={color.tx3} wrapMode="none">
                  {`(chờ) ${truncate(item.display.split("\n")[0] ?? "", Math.max(10, dims().width - 30))}`}
                </text>
              )}
            </For>
            <text fg={color.tx3} wrapMode="none">
              {"  gửi khi câu trả lời xong · ↑ để sửa"}
            </text>
          </box>
        </Show>
        <Show when={!owner() && !state.dialog && suggestions().length === 0 && argHint()}>
          {(c) => <ArgumentHint command={c()} />}
        </Show>

        {/* The approval prompt and /mcp take the input's place; the input is hidden, not
            unmounted, so a half-typed message survives. */}
        {/* Keyed: a new request starts with a fresh selection and no leftover note. */}
        <Show when={state.approval} keyed>
          {(request) => <ApprovalPrompt gate={props.runtime.permissions} request={request} subagents={props.runtime.subagents} />}
        </Show>
        {/* The ▸▸ auto opt-in gives way to an approval or a question (it is asked again later). */}
        <Show when={state.autoOptIn && !state.approval && !state.question}>
          <AutoOptInDialog gate={props.runtime.permissions} />
        </Show>
        {/* A question stays mounted (answers kept) while an approval covers it. */}
        <Show when={state.question} keyed>
          {(request) => (
            <box visible={!state.approval} flexShrink={0} flexDirection="column">
              <AskPrompt broker={props.runtime.questions} request={request} />
            </box>
          )}
        </Show>
        {/* Every dialog is a pane docked here, in place of the prompt (Claude Code style). It
            stays mounted — hidden and deaf to keys — while a prompt covers it, so a typed key,
            a pasted token or an OAuth login in progress survives. */}
        <box visible={!owner()} flexShrink={0} flexDirection="column">
          <Switch>
            <Match when={state.dialog === "mcp"}>
              <McpPanel mcp={props.runtime.mcp} cwd={props.runtime.mcp.cwd} />
            </Match>
            <Match when={state.dialog === "connect"}>
              <ConnectDialog />
            </Match>
            <Match when={state.dialog === "model"}>
              <ModelDialog />
            </Match>
            <Match when={state.dialog === "skills"}>
              <SkillsDialog />
            </Match>
            <Match when={state.dialog === "agents"}>
              <AgentsDialog runtime={props.runtime} />
            </Match>
            <Match when={state.dialog === "tasks"}>
              <TasksDialog runtime={props.runtime} />
            </Match>
            <Match when={state.dialog === "watchlist"}>
              <WatchlistDialog runtime={props.runtime} />
            </Match>
            <Match when={state.dialog === "help"}>
              <HelpDialog onRun={(command) => run(command)} />
            </Match>
            <Match when={state.dialog === "tools"}>
              <ToolsDialog registry={props.runtime.registry} runtime={props.runtime} />
            </Match>
            <Match when={state.dialog === "context"}>
              <ContextDialog runtime={props.runtime} />
            </Match>
            <Match when={state.dialog === "sessions"}>
              <SessionsDialog runtime={props.runtime} />
            </Match>
            <Match when={state.dialog === "config"}>
              <ConfigDialog runtime={props.runtime} />
            </Match>
            <Match when={state.dialog === "permissions"}>
              <PermissionsDialog mode={props.runtime.permissions.mode} workspace={props.runtime.workspace} auto={props.runtime.auto} onChanged={() => props.runtime.permissions.refreshRules()} />
            </Match>
            <Match when={state.dialog === "shortcuts"}>
              <ShortcutsPane onType={(text) => input?.insertText(text)} />
            </Match>
            <Match when={state.dialog === "memory"}>
              <MemoryDialog memory={props.runtime.memory} />
            </Match>
          </Switch>
        </box>

        <PromptInput
          ref={(r) => (input = r)}
          visible={!owner() && !state.dialog}
          focused={!state.dialog && !owner() && state.panelFocus === undefined}
          busy={state.streaming}
          placeholder={
            state.streaming ? "đang trả lời… esc để dừng · enter để xếp hàng tin tiếp" : "Hỏi về thị trường, hoặc gõ / để xem lệnh · ↑ lịch sử · ctrl+j xuống dòng"
          }
          onChange={(v) => {
            if (input) setCursor(input.cursorOffset)
            if (v === draft()) return
            setDraft(v)
            setSelected(0)
            // A dismissed list stays closed only until the draft changes.
            if (v !== dismissedFor()) setDismissedFor(undefined)
          }}
          onCursor={(at) => {
            if (at === cursor()) return
            setCursor(at)
            setSelected(0)
          }}
          onSubmit={submit}
          onPaste={onPaste}
        />

        <ModeLine
          hint={
            owner() || state.dialog
              ? undefined
              : state.panelFocus !== undefined
                ? "↑↓ chọn · enter xem · x ×2 dừng · esc về ô nhập"
                : state.streaming
                  ? "esc dừng"
                  : draft()
                    ? undefined
                    : "? phím tắt · / lệnh"
          }
        />
        <Show when={!owner() && !state.dialog}>
          <AgentPanel />
        </Show>
        <StatusBar />
      </box>
      <Toasts />

    </box>
  )
}

const BRAND = " ▲ OpenTrading "
/** The status bar warns this close (share of the window) to the auto-compaction threshold… */
const CONTEXT_WARN_LEFT = 0.15
/** …or, when nothing will compact by itself, from this share of the window on. */
const CONTEXT_LOW_SHARE = 0.8

const backgroundRunning = () =>
  Object.values(state.agents).filter((a) => a.background && (a.status === "running" || a.status === "queued")).length

/**
 * The bottom line: who answers (provider · model), MCP, skills on the left; a context
 * warning on the right when compaction is near. The mode, hints and notifications live on
 * the line under the prompt (mode-line.tsx).
 */
function StatusBar() {
  const target = () => ` ${state.provider ? `${providerName(state.provider)} · ${state.model ?? "chưa chọn model"}` : "chưa kết nối"} `
  const ready = () => state.mcp.filter((s) => s.state === "connected").length
  const attention = () => state.mcp.some((s) => s.state === "failed" || s.state === "untrusted")
  const contextShare = () => {
    const window = contextWindow()
    return window && state.contextTokens !== undefined ? Math.min(1, state.contextTokens / window) : undefined
  }
  /** Room left before auto-compaction (Claude Code's TokenWarning), shown only when it is near. */
  const ctx = (): { text: string; fg: string } | undefined => {
    const share = contextShare()
    if (share === undefined) return undefined
    // Nothing will compact by itself: turned off, given up after failures, held until the
    // context grows, or already past the threshold. Then only /compact helps.
    const manual = state.autoCompactOff || state.compactFailures >= MAX_AUTO_FAILURES || state.compactFloor !== undefined || share >= AUTO_COMPACT_SHARE
    if (manual) return share >= CONTEXT_LOW_SHARE ? { text: ` context còn ${Math.max(0, Math.round((1 - share) * 100))}% · /compact `, fg: color.giam } : undefined
    const left = AUTO_COMPACT_SHARE - share
    if (left > CONTEXT_WARN_LEFT) return undefined
    return { text: ` còn ${Math.max(0, Math.round(left * 100))}% tới tự nén `, fg: left <= 0.05 ? color.tham : color.tx3 }
  }
  return (
    <box flexDirection="row" height={1} flexShrink={0} backgroundColor={color.panel2} paddingLeft={2} paddingRight={2}>
      <text fg={color.bg} bg={color.tang} flexShrink={0} selectable={false}>
        {BRAND}
      </text>
      <text fg={color.tx2} flexShrink={1} wrapMode="none" selectable={false}>
        {target()}
      </text>
      <Show when={state.mcp.length > 0}>
        <text fg={attention() ? color.tham : color.san} flexShrink={0} selectable={false}>
          {` MCP ${ready()}/${state.mcp.length} `}
        </text>
      </Show>
      <Show when={state.activeSkills.length > 0}>
        <text fg={color.tran} flexShrink={1} wrapMode="none" selectable={false}>
          {` ✦ ${truncate(state.activeSkills.join(", "), 30)}`}
        </text>
      </Show>
      <box flexGrow={1} />
      <Show when={ctx()}>
        {(c) => (
          <text fg={c().fg} flexShrink={0} selectable={false}>
            {c().text}
          </text>
        )}
      </Show>
    </box>
  )
}
