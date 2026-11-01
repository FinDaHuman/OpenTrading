import type { ModelMessage } from "ai"
import { label, visibleUserText } from "../core/agent"
import { promptVersion } from "../core/prompt/assemble"
import { samePathKey } from "../core/fs/path-safety"
import type { Runtime } from "../core/runtime"
import { listSessions, loadSession, Session, type SaveReceipt } from "../core/session/store"
import { formatTranscript } from "../core/session/export"
import { transcriptFromMessages } from "../core/session/transcript"
import { useResultSession } from "../core/tools/refs"
import { reconcile } from "solid-js/store"
import { NO_COMPACTION, providerName, pushLine, setState, state, type Line } from "./state"

/**
 * Every Session object this process opened, by id: one per session, so one writer per file.
 * Leaving a session keeps its object (it may still be writing, a late title may still come);
 * reopening it reuses that object, and exit waits for all of them.
 */
const opened = new Map<string, Session>()
const track = (session: Session) => {
  opened.set(session.id, session)
  return session
}

/** The conversation being written. Replaced by /new, /clear and resume. */
let current = track(Session.create())

export const currentSession = () => current

/** A plain line of the transcript: what a save receipt turns into. */
type Notice = Extract<Line, { kind: "info" | "error" }>

/** Sessions whose title generation already ran (a first turn that failed to save is retried, not retitled). */
const retitled = new WeakSet<Session>()
/** Sessions already told they stopped saving: said once. */
const stopReported = new WeakSet<Session>()
/**
 * Per session, the turns the user was told are not saved yet (a failed write, or a write still
 * running when the session was left). Each is said "đã lưu bù" exactly once, by whichever
 * report comes first after it lands: one drain can write turns queued by other calls, and some
 * drains (the title's, /export's) have no report of their own.
 */
const toldUnsaved = new WeakMap<Session, Set<number>>()

/** How long switching sessions and exit wait for a session's writes. */
const SETTLE_MS = 2000

const sessionName = (session: Session) => session.title || session.id
const turnRange = (turns: number[]) => (turns.length === 1 ? `lượt ${turns[0]}` : `lượt ${turns[0]}–${turns[turns.length - 1]}`)
// Only the error's message: never the conversation's text.
const reason = (receipt: SaveReceipt) => receipt.error?.message ?? "lỗi không rõ"

function tellUnsaved(session: Session, turns: number[]) {
  const told = toldUnsaved.get(session) ?? new Set<number>()
  for (const turn of turns) told.add(turn)
  toldUnsaved.set(session, told)
}

/** Turns told unsaved that are on disk now (turns land in order), forgotten once returned. */
function caughtUp(session: Session, receipt: SaveReceipt) {
  const told = toldUnsaved.get(session)
  if (!told) return []
  const landed = [...told].filter((t) => t <= session.turns || receipt.saved.includes(t)).sort((a, b) => a - b)
  for (const turn of landed) told.delete(turn)
  return landed
}

/**
 * What to tell the user about one write. A session other than the current one (left by /new
 * or resume) is named; `named` forces that for a session being left.
 */
export function receiptLines(session: Session, receipt: SaveReceipt, opts: { named?: boolean } = {}): Notice[] {
  const isCurrent = session === current && !opts.named
  const named = (text: string) =>
    isCurrent ? text : `Phiên "${sessionName(session)}": ${text[0]!.toLowerCase()}${text.slice(1)}`
  // A session left behind has no next turn: it is retried on exit, or when it is reopened.
  const later = isCurrent ? "Sẽ thử lại ở lượt sau." : "Sẽ thử lại khi thoát hoặc khi mở lại phiên này."
  const out: Notice[] = []
  const landed = caughtUp(session, receipt)
  if (landed.length > 0) out.push({ kind: "info", text: named(`Đã lưu bù ${turnRange(landed)}.`) })
  if (receipt.stopped) {
    if (!stopReported.has(session)) {
      stopReported.add(session)
      // Names the session itself, current or not; a turn number only when a turn is what stopped.
      const from = receipt.pending.length > 0 ? ` từ lượt ${receipt.pending[0]}` : ""
      out.push({
        kind: "error",
        text:
          `Ngừng lưu phiên "${sessionName(session)}"${from}: không khôi phục được file sau lần ghi lỗi (${reason(receipt)}). ` +
          "Các lượt sau của phiên này không được lưu.",
      })
    }
    return out
  }
  if (receipt.pending.length > 0) {
    tellUnsaved(session, receipt.pending)
    out.push({ kind: "error", text: named(`Chưa lưu được ${turnRange(receipt.pending)}: ${reason(receipt)}. ${later}`) })
  } else if (receipt.pendingCompactions > 0) {
    out.push({ kind: "error", text: named(`Chưa lưu được bản nén hội thoại: ${reason(receipt)}. ${later}`) })
  }
  if (receipt.indexPending) {
    const retry = isCurrent ? "Sẽ thử lại." : later
    out.push({ kind: "error", text: named(`Đã lưu lượt nhưng chưa cập nhật được danh sách phiên: ${reason(receipt)}. ${retry}`) })
  }
  return out
}

/** Said when leaving a session (switch, exit, export) with something unsaved; undefined when all is saved. */
export function leavingLine(session: Session, receipt: SaveReceipt): Notice | undefined {
  const waiting = [
    ...(receipt.pending.length > 0 ? [`${receipt.pending.length} lượt`] : []),
    ...(receipt.pendingCompactions > 0 ? [`${receipt.pendingCompactions} bản nén hội thoại`] : []),
  ]
  const parts = [
    ...(waiting.length > 0 ? [`còn ${waiting.join(" và ")} chưa lưu được`] : []),
    ...(receipt.indexPending ? ["chưa vào được danh sách phiên (/sessions)"] : []),
  ]
  if (parts.length === 0 && receipt.stopped) parts.push("đã ngừng lưu sau lần ghi lỗi")
  if (parts.length === 0) return undefined
  return { kind: "error", text: `Phiên "${sessionName(session)}" ${parts.join("; ")}: ${reason(receipt)}.` }
}

/** Printed on exit when the session's writes did not finish within the wait. */
export const exitTimeoutText = (session: Session) =>
  `Phiên "${sessionName(session)}": chưa ghi xong trong ${SETTLE_MS / 1000} giây khi thoát; lượt cuối có thể chưa được lưu.`

const report = (session: Session, receipt: SaveReceipt) => {
  for (const line of receiptLines(session, receipt)) pushLine(line)
}

/**
 * Waits for a session's writes at most `ms`: a disk that hangs (a network drive, a synced
 * folder) must not freeze /new or exit. On timeout the session keeps writing into its own
 * file in the background; the turns not on disk yet count as told unsaved, so whichever report
 * comes after they land says so, and `onLate` gets the background write's receipt.
 */
export async function settleSession(
  session: Session,
  ms = SETTLE_MS,
  onLate: (receipt: SaveReceipt) => void = (r) => report(session, r),
): Promise<SaveReceipt | "timeout"> {
  const flushing = session.flush()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), ms)))
  try {
    const result = await Promise.race([flushing, timeout])
    if (result === "timeout") {
      tellUnsaved(
        session,
        Array.from({ length: session.lastTurn - session.turns }, (_, i) => session.turns + i + 1),
      )
      void flushing.then(onLate)
    }
    return result
  } finally {
    clearTimeout(timer)
  }
}

/**
 * For exit: settleSession on the current session and on every session opened in this run (one
 * left with a write still running goes on writing in the background); the lines to print for
 * those that stay unsaved.
 */
export async function settleForExit(ms = SETTLE_MS, session = current): Promise<string | undefined> {
  const sessions = [...new Set([session, ...opened.values()])]
  const lines = await Promise.all(
    sessions.map(async (s) => {
      const result = await settleSession(s, ms, () => {})
      return result === "timeout" ? exitTimeoutText(s) : leavingLine(s, result)?.text
    }),
  )
  return lines.filter((line) => line !== undefined).join("\n") || undefined
}

/** Persist one finished turn (fire-and-forget: a disk error must not break the chat; the receipt is reported). */
export function recordTurn(messages: ModelMessage[], contextTokens?: number) {
  if (messages.length === 0) return
  const session = current
  const firstTurn = session.turns === 0 && !retitled.has(session)
  void session
    .appendTurn(messages, {
      cwd: process.cwd(),
      provider: state.provider,
      model: state.model,
      promptVersion: promptVersion(),
      skills: state.skills.map((s) => ({ name: s.name, version: s.version })),
      contextTokens,
    })
    .then((receipt) => report(session, receipt))
  // After the first turn, replace the 60-char fallback title with a generated
  // one (fire-and-forget; failures keep the fallback).
  if (firstTurn) {
    retitled.add(session)
    void retitleOnce(session, messages)
  }
}

/** One-shot title generation for a fresh session; never throws. */
async function retitleOnce(session: Session, messages: ModelMessage[]) {
  try {
    const { generateTitle } = await import("../core/session/title")
    // What the user typed (an image message is an array; reminders are left out).
    const first = messages.map(visibleUserText).find((t) => t.trim())
    const title = await generateTitle(first ?? "")
    // The session it was asked for, even if /new or /resume switched meanwhile.
    // Its write also retries whatever waits, so its receipt is reported like any other.
    if (title) report(session, await session.setTitle(title))
  } catch {
    // keep the fallback title
  }
}

/** Persist a compaction, so --resume starts from the compacted history. */
export function recordCompact(entry: { trigger: "auto" | "manual"; before: number; after: number; messages: ModelMessage[] }) {
  const session = current
  void session.appendCompact(entry).then((receipt) => report(session, receipt))
}

/** Before switching away: wait (bounded) for the old session's writes; the lines to show after the switch. */
async function leave(session: Session, ms = SETTLE_MS): Promise<Notice[]> {
  const result = await settleSession(session, ms)
  if (result === "timeout") {
    return [{ kind: "info", text: `Phiên "${sessionName(session)}" chưa ghi xong; sẽ ghi tiếp ở nền và báo khi xong.` }]
  }
  // The failures are summed up by leavingLine; from the receipt come the catch-ups, and the
  // stop notice when the session stopped during this wait (it is said once, so here or never).
  const lines = receiptLines(session, result, { named: true }).filter((line) => line.kind === "info" || result.stopped)
  const unsaved = leavingLine(session, result)
  return unsaved ? [...lines, unsaved] : lines
}

/**
 * Throws when `session` must not be reopened now: the file read back would lack parts its
 * queue writes later, or it stopped saving (YC-018) and must not get a second writer.
 */
async function refuseUnsaved(session: Session, ms: number) {
  const settled = await settleSession(session, ms)
  if (settled !== "timeout" && settled.stopped) {
    throw new Error(
      `Phiên "${sessionName(session)}" đã ngừng lưu trong lần chạy này nên không mở lại được; ` +
        "phần đã lưu sẽ mở lại được sau khi khởi động lại OpenTrading.",
    )
  }
  const unsaved =
    settled === "timeout" ? `Phiên "${sessionName(session)}" chưa ghi xong.` : leavingLine(session, settled)?.text
  if (unsaved) throw new Error(`${unsaved} Mở lại bây giờ sẽ thiếu phần đó; thử lại sau.`)
}

/**
 * Leave `old` and read session `id` back. The target is checked first, so a wrong id or a
 * session that must not be reopened costs `old` nothing. Then `old` is left (its pending writes
 * land) before the file is read. A session opened earlier in this run reuses its object: one
 * writer per file, its turn numbers carry on. An error after `old` was left carries `left`, the
 * lines leaving it produced, for the caller to show.
 */
export async function openForResume(old: Session, id: string, ms = SETTLE_MS) {
  track(old)
  const matches = (s: { id: string }) => s.id === id || s.id.startsWith(id)
  const summary = (await listSessions()).find(matches)
  const live = opened.get(summary?.id ?? "") ?? [...opened.values()].find(matches)
  if (!summary && !live) throw new Error(`Không tìm thấy phiên "${id}". Gõ /sessions để xem danh sách.`)
  if (live && live !== old) await refuseUnsaved(live, ms)
  const left = await leave(old, ms)
  try {
    if (live === old) await refuseUnsaved(old, ms)
    const loaded = await loadSession(summary?.id ?? live!.id)
    return { session: live ?? track(Session.continue(loaded.summary)), loaded, left }
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { left })
  }
}

/**
 * The current conversation as Markdown (/save, /export), read back from its session file so
 * turns before a compaction are included. Undefined before the first turn is written.
 * `unsaved`: what the transcript lacks, said next to the result.
 */
export async function transcriptOfCurrent(runtime: Runtime, session = current) {
  const settled = await settleSession(session)
  const unsaved =
    settled === "timeout"
      ? `Phiên "${sessionName(session)}" chưa ghi xong trong ${SETTLE_MS / 1000} giây; bản lưu có thể thiếu lượt cuối.`
      : leavingLine(session, settled)?.text
  if (!session.file) {
    if (unsaved) throw new Error(unsaved)
    return undefined
  }
  const loaded = await loadSession(session.id).catch((error) => {
    // Not in the index yet (its line could not be written): say why, not "not found".
    throw unsaved ? new Error(unsaved) : error
  })
  return {
    id: session.id,
    turns: loaded.summary.turns,
    text: formatTranscript(loaded, { label: (name, input) => label(runtime.registry, name, input) }),
    unsaved,
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
  const left = source === "clear" ? await leave(current) : []
  current = track(Session.create())
  attachSubagents(runtime)
  setState("agents", reconcile({}))
  setState("deskRuns", reconcile({}))
  setState({ notices: [], noticeHold: false })
  // A fresh conversation has not seen the market clock yet.
  setState({ lines: left, history: [], clock: undefined, ...NO_COMPACTION })
  runtime.auto.reset()
  runtime.history.newConversation()
  await runtime.hooks.emit({ type: "session-start", sessionId: current.id, source })
}

/** Reopen a stored session: rebuild history and transcript, then keep appending to its file. */
export async function resumeSession(runtime: Runtime, id: string) {
  const target = await openForResume(current, id).catch((error) => {
    // Refused after the current session was left: what leaving it said is still shown.
    for (const line of (error as { left?: Notice[] }).left ?? []) pushLine(line)
    throw error
  })
  const { session, loaded, left } = target
  await runtime.hooks.emit({ type: "session-end", sessionId: current.id })
  current = session
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
  const notes: Line[] = [...left, { kind: "info", text: `Mở lại phiên "${loaded.summary.title}" · ${loaded.summary.turns} lượt` }]
  const from = loaded.meta?.cwd
  if (from && samePathKey(from) !== samePathKey(process.cwd())) {
    notes.push({ kind: "info", text: `Phiên này tạo ở ${from}; workspace bây giờ là thư mục đang mở (${runtime.workspace.primary}).` })
  }
  if (loaded.patched > 0) notes.push({ kind: "info", text: `${loaded.patched} lần gọi tool bị ngắt ở phiên trước đã được đánh dấu là lỗi.` })
  const saved = loaded.summary.provider && loaded.summary.model ? `${loaded.summary.provider}/${loaded.summary.model}` : undefined
  if (saved && saved !== `${state.provider}/${state.model}`) {
    notes.push({
      kind: "info",
      text: `Phiên này được tạo với ${providerName(loaded.summary.provider)} · ${loaded.summary.model}; đang dùng ${providerName(state.provider)} · ${state.model ?? "chưa chọn"}.`,
    })
  }

  // The auto-mode classifier reads the whole conversation, from before any /compact too.
  runtime.auto.reset(loaded.display, (name) => runtime.registry.get(name), visibleUserText, loaded.harness)
  runtime.history.newConversation()
  // The clock snapshot is unknown after resume, so the next turn re-sends it.
  setState({ lines: [...notes, ...lines], history: loaded.messages, clock: undefined, ...NO_COMPACTION, contextTokens: loaded.contextTokens })
  await runtime.hooks.emit({ type: "session-start", sessionId: current.id, source: "resume" })
}

/**
 * `--continue` → newest session opened in this folder (Claude Code keeps sessions per project);
 * `--resume <id>` → that one, from any folder (id prefix is enough).
 */
export async function resumeFromArgs(runtime: Runtime, target: string) {
  const id = target === "latest" ? (await listSessions({ cwd: process.cwd() }))[0]?.id : target
  if (!id) return pushLine({ kind: "info", text: "Chưa có phiên nào ở thư mục này để mở lại. /sessions → tab để xem phiên ở thư mục khác." })
  try {
    await resumeSession(runtime, id)
  } catch (error) {
    pushLine({ kind: "error", text: error instanceof Error ? error.message : String(error) })
  }
}
