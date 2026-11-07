import type { Card, CardOutcome, CardState } from "../memory/cards/types"
import { stripImages } from "../tools/registry"
import { isCompactMarker } from "../compact-marker"
import { splitNotices } from "../subagents/notification"
import { appendFile, mkdir, open, readFile, stat, truncate } from "node:fs/promises"
import path from "node:path"
import type { ModelMessage } from "ai"
import { samePathKey } from "../fs/path-safety"
import { dataDir } from "../paths"
import type { ChartData } from "../tools/chart/data"
import { memoryLines } from "../memory/notebook/history-blocks"
import type { RedactionCheck } from "../memory/redaction/check"
import { applyCheck, applyRedactLines, mergeItems, type Redaction, type RedactItem } from "../memory/redaction/redact"

/**
 * Session transcripts as append-only JSONL, one file per session (the Claude Code / Codex
 * approach): crash-safe, human-readable, and the file is only created once a real turn
 * happens. `index.jsonl` lists sessions for the picker; the last record per id wins. No line
 * reported saved is ever changed; the one exception is a failed append, cut back to where it
 * started (or, when that fails too, the file takes no more writes).
 *
 *   ~/.opentrading/sessions/2026/09/20260930-101500-a1b2.jsonl
 *   ~/.opentrading/sessions/index.jsonl
 */

export const SESSION_FORMAT = 1

export type SessionEntry =
  | {
      type: "meta"
      format: number
      id: string
      createdAt: string
      cwd: string
      /** Hash of prompts/*.md at creation, to tell which prompt version produced a session. */
      promptVersion?: string
      skills?: { name: string; version?: string }[]
    }
  | { type: "message"; ts: string; message: ModelMessage }
  | {
      type: "turn_end"
      ts: string
      /** The turn's number, given when it was queued (a turn written late keeps it). Absent before format 006. */
      turn?: number
      provider?: string
      model?: string
      contextTokens?: number
      /** The stop gate sent the model back (loop/stop-gate.ts); absent when it never did. */
      recoveries?: { kind: string; attempt: number }[]
      /** The turn ended without an answer. */
      unanswered?: boolean
      /** Items left open when the model answered (the list was retired, items unconfirmed). */
      retiredTodos?: number
      /** Tools whose data the turn did not get (loop/failures.ts). */
      dataGaps?: string[]
    }
  /**
   * The history was compacted: `messages` replaces everything before it for the model. The
   * earlier `message` entries stay in the file, so the transcript can still show them.
   */
  | { type: "compact"; ts: string; trigger: "auto" | "manual"; before: number; after: number; messages: ModelMessage[] }
  /**
   * A chart drawn for a tool call: the model only got a summary (and a `from_call` chart's
   * input holds just a ref), so the picture is kept here for the transcript on resume.
   */
  | { type: "chart"; ts: string; callId: string; data: ChartData }
  /** A user turn's text that the harness wrote (an MCP prompt's template): not the user's words for auto mode. */
  | { type: "harness"; ts: string; text: string }
  /**
   * Memory items the user deleted: every block of these items and versions written before this line is
   * masked when the file is read. Appended, never a change to an earlier line; holds no memory content.
   * A build that does not know the type skips it (and does not mask).
   */
  | { type: "redact"; ts: string; items: RedactItem[] }
  /**
   * A suggestion card (spec 007): the model never sees it. The line that creates it carries the card and
   * `state: "pending"`, written with its turn; each change of state is another line with the id. The last
   * line of an id wins. A build that does not know the type skips it.
   */
  | ({ type: "card"; ts: string; id: string; state: CardState; saved?: CardOutcome["saved"] } & Partial<Omit<Card, "id">>)

export interface SessionSummary {
  id: string
  /** Path relative to the sessions directory. */
  file: string
  title: string
  createdAt: string
  updatedAt: string
  provider?: string
  model?: string
  turns: number
  /** Folder OpenTrading was opened in. Index lines written before it existed lack it (read from the meta line). */
  cwd?: string
}

/**
 * An index line that can be listed: id, file and both dates are strings (they are sorted and
 * sliced), a missing title or turn count gets a default. Anything else is skipped, so one bad
 * line never takes the whole /sessions list down.
 */
function asSummary(value: unknown): SessionSummary | undefined {
  if (!value || typeof value !== "object") return undefined
  const s = value as Record<string, unknown>
  const text = (v: unknown) => typeof v === "string" && v.length > 0
  if (!text(s.id) || !text(s.file) || !text(s.createdAt) || !text(s.updatedAt)) return undefined
  return { ...(s as unknown as SessionSummary), title: typeof s.title === "string" ? s.title : "", turns: typeof s.turns === "number" ? s.turns : 0 }
}

const ROLES = new Set(["system", "user", "assistant", "tool"])

/**
 * A stored message the loader can hand on: a known role, and content that is text or a list of
 * typed parts (tool results always a list). A structural check only, on purpose: the AI SDK's
 * own schema would also reject older but valid shapes (image parts before SDK v7).
 */
export function isStoredMessage(value: unknown): value is ModelMessage {
  if (!value || typeof value !== "object") return false
  const { role, content } = value as { role?: unknown; content?: unknown }
  if (typeof role !== "string" || !ROLES.has(role)) return false
  if (typeof content === "string") return role !== "tool"
  return Array.isArray(content) && content.every((p) => !!p && typeof p === "object" && typeof (p as { type?: unknown }).type === "string")
}

export const sessionsDir = () => path.join(dataDir(), "sessions")
const indexFile = () => path.join(sessionsDir(), "index.jsonl")

export function newSessionId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

/** Plain user text: string content, or text parts that are not reminder blocks. */
function userText(message: ModelMessage) {
  if (message.role !== "user") return ""
  if (typeof message.content === "string") return splitNotices(message.content).rest
  return message.content
    .filter((p) => p.type === "text" && !p.text.trimStart().startsWith("<nhac_nho>"))
    .map((p) => splitNotices((p as { text: string }).text).rest)
    .join(" ")
}

export interface SessionInfo {
  cwd: string
  promptVersion?: string
  skills?: { name: string; version?: string }[]
}

/**
 * The disk operations the session writer uses, gathered so tests can make one of them fail
 * (a full disk, a file another process holds on Windows) on any OS.
 */
export const sessionFiles = {
  append: (file: string, text: string) => appendFile(file, text, "utf8"),
  /** 0 when the file does not exist yet. */
  size: (file: string) =>
    stat(file).then(
      (s) => s.size,
      (error) => {
        if ((error as { code?: string }).code === "ENOENT") return 0
        throw error
      },
    ),
  async lastByte(file: string, size: number): Promise<number | undefined> {
    return (await sessionFiles.readRange(file, size - 1, size))[0]
  },
  /** Bytes [start, end) of the file (fewer when it is shorter). */
  async readRange(file: string, start: number, end: number): Promise<Buffer> {
    const handle = await open(file, "r")
    try {
      const buffer = Buffer.alloc(end - start)
      const { bytesRead } = await handle.read(buffer, 0, end - start, start)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  },
  truncate: (file: string, size: number) => truncate(file, size),
  mkdir: async (dir: string) => {
    await mkdir(dir, { recursive: true })
  },
}

/** What a write call achieved. Writes never reject: the TUI reports from this instead. */
export interface SaveReceipt {
  /** Turns this call wrote, including earlier ones it caught up on. */
  saved: number[]
  /** Turns still waiting, oldest first. */
  pending: number[]
  /** Compactions still waiting. */
  pendingCompactions: number
  /** Redact lines still waiting. */
  pendingRedactions: number
  /** The index line could not be written; retried on the next write. */
  indexPending: boolean
  /**
   * A failed write could not be cut back (truncating failed, or the file had lines from another
   * writer after ours): nothing more goes into this file.
   */
  stopped: boolean
  /** The latest attempt's error, when anything is still pending or stopped. */
  error?: Error
}

/** What one turn's turn_end entry records. */
export interface TurnInfo {
  provider?: string
  model?: string
  contextTokens?: number
  /** The stop gate sent the model back (loop/stop-gate.ts); absent when it never did. */
  recoveries?: { kind: string; attempt: number }[]
  /** The turn ended without an answer. */
  unanswered?: boolean
  /** Items left open when the model answered (the list was retired, items unconfirmed). */
  retiredTodos?: number
  dataGaps?: string[]
}

/**
 * One write waiting in a session's queue: a turn or a compaction, its lines built when it was
 * queued. A turn keeps its first user text (the fallback title), not its messages.
 */
type Part =
  | { kind: "turn"; turn: number; ts: string; firstText: string; info: SessionInfo & TurnInfo; lines: SessionEntry[] }
  | { kind: "compact"; lines: SessionEntry[] }
  | { kind: "redact"; lines: SessionEntry[] }
  | { kind: "card"; lines: SessionEntry[] }

/** A failed append could not be cut back: the file may end in a partial write we cannot remove. */
class StoppedError extends Error {
  constructor(readonly cause: Error) {
    super(cause.message)
  }
}

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

/**
 * A read right after a failed write, retried briefly: the same moment a scanner or sync client
 * holds the file for the write tends to hold it for the read too. Undefined when it kept failing.
 */
async function retried<T>(read: () => Promise<T>): Promise<T | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read()
    } catch {
      if (attempt >= 3) return undefined
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)))
    }
  }
}

/**
 * After a failed append: remove what of it landed, but only when the bytes after `size` are a
 * prefix of what we sent. Another writer's lines there (a second window on the same session)
 * are never cut; the file then takes no more writes from us. A size we cannot read is the same:
 * we cannot tell what landed, so we cut nothing.
 */
async function cutBack(file: string, size: number, body: string, error: Error) {
  const after = await retried(() => sessionFiles.size(file))
  if (after === size) return
  if (after === undefined) throw new StoppedError(new Error(`${error.message}; không đọc lại được file phiên để cắt`))
  const sent = Buffer.from(body, "utf8")
  const tail = after > size ? await retried(() => sessionFiles.readRange(file, size, after)) : undefined
  if (after > size && !tail) throw new StoppedError(new Error(`${error.message}; không đọc lại được file phiên để cắt`))
  if (!tail || tail.length > sent.length || !tail.equals(sent.subarray(0, tail.length))) {
    throw new StoppedError(new Error(`${error.message}; file phiên có dữ liệu ghi xen từ nơi khác nên không cắt`))
  }
  try {
    await sessionFiles.truncate(file, size)
  } catch (truncateError) {
    throw new StoppedError(asError(truncateError))
  }
}

/**
 * Append `text` as whole lines. A file left ending mid-line (a crash during an earlier write)
 * gets a newline first, so the torn line stays alone and unreadable instead of swallowing the
 * first line of this write. With `truncateOnError`, a failed append is cut back to the size
 * before it, so no line that was never reported saved stays in the file.
 */
async function appendLines(file: string, text: string, truncateOnError: boolean) {
  await sessionFiles.mkdir(path.dirname(file))
  const size = await sessionFiles.size(file)
  const torn = size > 0 && (await sessionFiles.lastByte(file, size)) !== 0x0a
  const body = torn ? "\n" + text : text
  try {
    await sessionFiles.append(file, body)
  } catch (error) {
    if (truncateOnError) await cutBack(file, size, body, asError(error))
    throw error
  }
}

export class Session {
  /** Turns on disk. */
  turns: number
  title: string
  private createdAt: string
  /** Turns queued so far (on disk or waiting): the next turn's number is this plus one. */
  private queuedTurns: number
  private queue: Part[] = []
  /** The writes, one after another; never rejects, so a failed write never blocks the next. */
  private chain: Promise<unknown> = Promise.resolve()
  /**
   * Requests to (re)write the index line (a turn landed, the title changed) and the latest one
   * a written line covers. Counted, not a flag: a title that arrives while a line is being
   * written must not be cleared by that older line.
   */
  private indexWanted = 0
  private indexWritten = 0
  private get indexPending() {
    return this.indexWanted > this.indexWritten
  }
  /** What the index line says besides the counts, from the last turn on disk. */
  private indexInfo: { updatedAt: string; provider?: string; model?: string; cwd: string } | undefined
  private stopped = false
  private lastError: Error | undefined

  private constructor(
    readonly id: string,
    /** Relative path; undefined until the first turn is on disk. */
    public file: string | undefined,
    summary?: SessionSummary,
    createdAt = new Date(),
    lastTurn?: number,
  ) {
    // The file's count wins over a lagging index; the index wins when the file's turn_end lines are unreadable.
    this.turns = Math.max(lastTurn ?? 0, summary?.turns ?? 0)
    this.queuedTurns = this.turns
    this.title = summary?.title ?? ""
    // The folder (YYYY/MM) must agree with the id's timestamp, so both come from one clock.
    this.createdAt = summary?.createdAt ?? createdAt.toISOString()
  }

  static create(now = new Date()) {
    return new Session(newSessionId(now), undefined, undefined, now)
  }

  /**
   * Keep appending to an existing session file after resume. `lastTurn` is the file's own count
   * (LoadedSession.lastTurn): the index line can lag behind it when its write failed.
   */
  static continue(summary: SessionSummary, lastTurn?: number) {
    return new Session(summary.id, summary.file, summary, undefined, lastTurn)
  }

  /** Replace the fallback title with a generated one, written to the index right away. */
  setTitle(title: string): Promise<SaveReceipt> {
    const clean = title.trim()
    if (!clean) return Promise.resolve(this.receipt([]))
    this.title = clean
    // Always queued, even while the first index line is being written: that line may already
    // carry the fallback title. Before any turn landed there is nothing to write yet, and the
    // first turn's index line uses this title.
    this.indexWanted++
    // Also writes whatever else waits: the receipt says so, like any other write.
    return this.drain()
  }

  /** Something is still to be written: a turn, a compaction or a redact line queued, or the index line. */
  get hasPending(): boolean {
    return this.queue.length > 0 || this.indexWaiting
  }

  /** Number of the last turn queued, on disk or waiting. */
  get lastTurn() {
    return this.queuedTurns
  }

  get path() {
    return this.file ? path.join(sessionsDir(), this.file) : undefined
  }

  /** Folder for this session's side files (subagent transcripts); exists before the first turn is written. */
  get dir() {
    return path.join(sessionsDir(), this.createdAt.slice(0, 4), this.createdAt.slice(5, 7), this.id)
  }

  private pendingCharts: { callId: string; data: ChartData }[] = []
  private pendingHarness: string[] = []
  private pendingCards: Card[] = []

  /** The number the next queued turn gets (a card made this turn is named after it). */
  get nextTurn() {
    return this.queuedTurns + 1
  }

  /** A suggestion card the current turn ended with; written with the turn, before turn_end (spec 007). */
  noteCard(card: Card) {
    this.pendingCards.push(card)
  }

  /** A card was saved or dismissed: one more line with its id, after whatever waits. */
  appendCardState(id: string, state: CardState, saved?: CardOutcome["saved"]): Promise<SaveReceipt> {
    if (!this.file && this.queuedTurns === 0) return Promise.resolve(this.receipt([]))
    const line: SessionEntry = { type: "card", ts: new Date().toISOString(), id, state, ...(saved ? { saved } : {}) }
    this.queue.push({ kind: "card", lines: this.stopped ? [] : [line] })
    return this.drain()
  }

  /** The next turn's user text came from the harness; written with that turn. */
  noteHarness(text: string) {
    this.pendingHarness.push(text)
  }

  /** A chart drawn during the current turn; written with the turn. */
  noteChart(callId: string, data: ChartData) {
    this.pendingCharts.push({ callId, data })
  }

  /** Record a compaction. Nothing to do before any turn was queued (nothing to compact). */
  appendCompact(entry: Omit<Extract<SessionEntry, { type: "compact" }>, "type" | "ts">): Promise<SaveReceipt> {
    if (!this.file && this.queuedTurns === 0) return Promise.resolve(this.receipt([]))
    const ts = new Date().toISOString()
    const line: SessionEntry = { type: "compact", ts, ...entry, messages: stripImages(entry.messages) }
    // A stopped session never writes again: count the compaction, keep none of its content.
    this.queue.push({ kind: "compact", lines: this.stopped ? [] : [line] })
    return this.drain()
  }

  /**
   * Record that these memory items were deleted. Queued after whatever waits, so the line always
   * follows the turns whose blocks it masks, a turn still waiting to be written included.
   */
  appendRedaction(items: RedactItem[]): Promise<SaveReceipt> {
    if (items.length === 0 || (!this.file && this.queuedTurns === 0)) return Promise.resolve(this.receipt([]))
    const line: SessionEntry = { type: "redact", ts: new Date().toISOString(), items }
    // A stopped session never writes again: count the line, keep nothing of it.
    this.queue.push({ kind: "redact", lines: this.stopped ? [] : [line] })
    return this.drain()
  }

  /** Writes whatever is waiting; resolves when the attempt is over. */
  flush(): Promise<SaveReceipt> {
    return this.drain()
  }

  /** Queue one completed turn and write the queue. Turns are written in order, each once. */
  appendTurn(messages: ModelMessage[], info: SessionInfo & TurnInfo): Promise<SaveReceipt> {
    const ts = new Date().toISOString()
    const lines: SessionEntry[] = []
    // Screenshots would bloat the file by megabytes per turn; keep a text placeholder.
    for (const message of stripImages(messages)) lines.push({ type: "message", ts, message })
    for (const chart of this.pendingCharts.splice(0)) lines.push({ type: "chart", ts, ...chart })
    for (const text of this.pendingHarness.splice(0)) lines.push({ type: "harness", ts, text })
    for (const card of this.pendingCards.splice(0)) lines.push({ type: "card", ts, ...card, state: "pending" })
    const turn = ++this.queuedTurns
    lines.push({
      type: "turn_end",
      ts,
      turn,
      provider: info.provider,
      model: info.model,
      contextTokens: info.contextTokens,
      ...(info.recoveries ? { recoveries: info.recoveries } : {}),
      ...(info.unanswered ? { unanswered: true } : {}),
      ...(info.retiredTodos ? { retiredTodos: info.retiredTodos } : {}),
      ...(info.dataGaps ? { dataGaps: info.dataGaps } : {}),
    })
    const firstText = messages.map(userText).find((t) => t.trim()) ?? ""
    // A stopped session never writes again: keep the turn's number for the receipt, not its content.
    this.queue.push({ kind: "turn", turn, ts, firstText, info, lines: this.stopped ? [] : lines })
    return this.drain()
  }

  private drain(): Promise<SaveReceipt> {
    const run = this.chain.then(() => this.write())
    this.chain = run.catch(() => {})
    return run.catch((error) => this.receipt([], asError(error)))
  }

  /** An index line that could be written but is not yet (none can be before a turn landed). */
  private get indexWaiting() {
    return this.indexPending && this.file !== undefined && this.indexInfo !== undefined
  }

  private receipt(saved: number[], error?: Error): SaveReceipt {
    const pending = this.queue.flatMap((p) => (p.kind === "turn" ? [p.turn] : []))
    // Counted by kind: a redact line waiting is not a compaction waiting.
    const count = (kind: Part["kind"]) => this.queue.filter((p) => p.kind === kind).length
    const failing = this.stopped || this.indexWaiting || this.queue.length > 0
    return {
      saved,
      pending,
      pendingCompactions: count("compact"),
      pendingRedactions: count("redact"),
      indexPending: this.indexWaiting,
      stopped: this.stopped,
      error: failing ? (error ?? this.lastError) : undefined,
    }
  }

  private async write(): Promise<SaveReceipt> {
    const saved: number[] = []
    let error: Error | undefined
    // Once a failed write could not be cut back, appending more would build on a partial line.
    while (!this.stopped && this.queue.length > 0) {
      const part = this.queue[0]!
      const lines = [...part.lines]
      const file = this.file ?? path.join(this.createdAt.slice(0, 4), this.createdAt.slice(5, 7), `${this.id}.jsonl`)
      // The meta line goes with the first write that succeeds, so the file always starts with it.
      if (!this.file && part.kind === "turn") {
        const { info } = part
        lines.unshift({
          type: "meta",
          format: SESSION_FORMAT,
          id: this.id,
          createdAt: this.createdAt,
          cwd: info.cwd,
          promptVersion: info.promptVersion,
          skills: info.skills,
        })
      }
      try {
        await appendLines(path.join(sessionsDir(), file), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", true)
      } catch (caught) {
        if (caught instanceof StoppedError) {
          this.stopped = true
          error = caught.cause
          for (const waiting of this.queue) waiting.lines = []
        } else error = asError(caught)
        break
      }
      this.file = file
      this.queue.shift()
      if (part.kind === "turn") {
        this.turns++
        saved.push(part.turn)
        if (!this.title) this.title = part.firstText.replace(/\s+/g, " ").trim().slice(0, 60) || "(không tiêu đề)"
        const { provider, model, cwd } = part.info
        this.indexInfo = { updatedAt: part.ts, provider, model, cwd }
        this.indexWanted++
      }
    }
    // Written even when a later part failed, so the turns already on disk show in /sessions.
    if (this.indexPending && this.file && this.indexInfo) {
      const covers = this.indexWanted
      const summary: SessionSummary = {
        id: this.id,
        file: this.file.split(path.sep).join("/"),
        title: this.title,
        createdAt: this.createdAt,
        ...this.indexInfo,
        turns: this.turns,
      }
      try {
        // Not cut back on failure: a duplicate index line is harmless (the last one per id wins).
        // Limit: two windows appending to index.jsonl at once, A may read the last byte while B
        // is mid-line and put a newline into B's line. That line heals on B's next turn, since
        // every turn writes its index line again.
        await appendLines(indexFile(), JSON.stringify(summary) + "\n", false)
        this.indexWritten = covers
      } catch (caught) {
        error ??= asError(caught)
      }
    }
    if (error) this.lastError = error
    // Nothing left failing: an old error must not show up in a later receipt.
    else if (!this.stopped && !this.indexWaiting && this.queue.length === 0) this.lastError = undefined
    return this.receipt(saved, error)
  }
}

/** The folder in a session file's meta line (its first line), for index lines older than `cwd`. */
async function cwdFromMeta(file: string): Promise<string | undefined> {
  try {
    const head = await Bun.file(path.join(sessionsDir(), file)).slice(0, 8192).text()
    const end = head.indexOf("\n")
    const entry = JSON.parse(end >= 0 ? head.slice(0, end) : head) as SessionEntry
    return entry.type === "meta" && typeof entry.cwd === "string" ? entry.cwd : undefined
  } catch {
    return undefined
  }
}

/**
 * Newest first. Malformed index lines and sessions whose file is gone are skipped. With `cwd`,
 * only sessions opened in that folder (same path rules as the workspace: case-insensitive on
 * Windows and macOS), like Claude Code's per-project sessions.
 */
export async function listSessions(opts: { cwd?: string } = {}): Promise<SessionSummary[]> {
  const all = await allSessions()
  if (opts.cwd === undefined) return all
  const key = samePathKey(opts.cwd)
  return all.filter((s) => s.cwd !== undefined && samePathKey(s.cwd) === key)
}

async function allSessions(): Promise<SessionSummary[]> {
  const text = await readFile(indexFile(), "utf8").catch(() => "")
  const byId = new Map<string, SessionSummary>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const summary = asSummary(JSON.parse(line))
      if (!summary) continue
      // Re-insert so the map's order is the order of the last write.
      byId.delete(summary.id)
      byId.set(summary.id, summary)
    } catch {
      // a torn last line after a crash: ignore
    }
  }
  // Two writes in the same millisecond tie on updatedAt: the one written later (later in the
  // index) comes first, since the sort is stable over the reversed write order.
  const all = [...byId.values()].reverse().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const exists = await Promise.all(all.map((s) => Bun.file(path.join(sessionsDir(), s.file)).exists()))
  const kept = all.filter((_, i) => exists[i])
  return Promise.all(kept.map(async (s) => (s.cwd !== undefined ? s : { ...s, cwd: await cwdFromMeta(s.file) })))
}

export interface LoadedSession {
  summary: SessionSummary
  meta?: Extract<SessionEntry, { type: "meta" }>
  /** History for the model: from the last compaction on. */
  messages: ModelMessage[]
  /** Everything for the transcript, with each compaction's marker and summary where it happened. */
  display: ModelMessage[]
  /** Charts drawn per tool call id. */
  charts: Map<string, ChartData>
  /** User turn texts the harness wrote (ActionLog.markHarness on resume). */
  harness: string[]
  /** Context size after the last turn or compaction, if recorded. */
  contextTokens?: number
  /** Tool calls that had no result and were closed with an "interrupted" result. */
  patched: number
  /** The last turn's number from the file's own turn_end lines (the index line may lag behind). */
  lastTurn: number
  /**
   * The session's suggestion cards, last state each, in file order. `at`: how many `display` messages come
   * before the card (the card follows its turn's answer).
   */
  cards: LoadedCard[]
  redaction: {
    /** Redact lines in the file that were applied. */
    fromFile: number
    /** Items the store confirmed deleted that no line masked yet: the caller may record them (resume does). */
    confirmed: RedactItem[]
    /** Blocks held in `display` (no store, unreadable, content differs); `messages` keeps them. */
    temporary?: Redaction["temporary"]
  }
}

export interface LoadedCard {
  card: Card
  state: CardState
  saved?: CardOutcome["saved"]
  at: number
}

const CARD_KINDS = new Set(["constraint", "style", "lesson"])
const CARD_STATES = new Set(["pending", "saved", "dismissed"])

const isRedactItem = (value: unknown): value is RedactItem => {
  const i = value as Record<string, unknown> | null
  if (!i || typeof i !== "object") return false
  const versions = Array.isArray(i.versions) && i.versions.length > 0 && i.versions.every(Number.isInteger)
  if (i.kind === "lesson") return versions && Number.isInteger(i.id)
  return i.kind === "thesis" && versions && typeof i.name === "string"
}

/**
 * Read a session back. Unreadable lines (e.g. a write cut by a crash) are skipped. Each redact line
 * masks the blocks before it, where it stands (a compaction's history counts from the compact line).
 * With `check`, the store is asked once about the blocks left: blocks of items it confirms deleted are
 * masked in both lists; blocks it cannot vouch for are held in `display` only, since `messages` goes back
 * into a live session whose every request is checked again. Reading never writes.
 */
export async function loadSession(id: string, opts: { check?: RedactionCheck } = {}): Promise<LoadedSession> {
  const summary = (await listSessions()).find((s) => s.id === id || s.id.startsWith(id))
  if (!summary) throw new Error(`Không tìm thấy phiên "${id}". Gõ /sessions để xem danh sách.`)
  const text = await readFile(path.join(sessionsDir(), summary.file), "utf8")
  let meta: LoadedSession["meta"]
  let raw: ModelMessage[] = []
  let shown: ModelMessage[] = []
  let contextTokens: number | undefined
  const charts = new Map<string, ChartData>()
  const harness: string[] = []
  let lastTurn = 0
  let fromFile = 0
  const cards = new Map<string, LoadedCard & { after?: ModelMessage }>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as SessionEntry
      if (entry.type === "meta") meta = entry
      else if (entry.type === "message") {
        // A damaged message is dropped alone; the rest of the session still loads.
        if (!isStoredMessage(entry.message)) continue
        raw.push(entry.message)
        shown.push(entry.message)
      } else if (entry.type === "compact" && Array.isArray(entry.messages)) {
        entry.messages = entry.messages.filter(isStoredMessage)
        raw = [...entry.messages]
        // The marker and summary (absent when only tool results were pruned).
        if (entry.messages[0] && isCompactMarker(entry.messages[0])) shown.push(...entry.messages.slice(0, 2))
        contextTokens = entry.after
      } else if (entry.type === "turn_end") {
        // A line with its number says it; an older one is the previous number plus one.
        lastTurn = Number.isInteger(entry.turn) && entry.turn! > 0 ? entry.turn! : lastTurn + 1
        if (entry.contextTokens !== undefined) contextTokens = entry.contextTokens
      } else if (entry.type === "chart" && entry.callId && entry.data) charts.set(entry.callId, entry.data)
      else if (entry.type === "harness" && typeof entry.text === "string") harness.push(entry.text)
      else if (entry.type === "card" && typeof entry.id === "string" && CARD_STATES.has(entry.state)) {
        const known = cards.get(entry.id)
        if (known) {
          known.state = entry.state
          if (entry.saved) known.saved = entry.saved
        } else if (CARD_KINDS.has(entry.kind ?? "") && Number.isInteger(entry.turn)) {
          const { type: _t, ts: _ts, state, saved, ...card } = entry
          cards.set(entry.id, { card: card as Card, state, saved, at: shown.length, after: shown.at(-1) })
        }
      }
      else if (entry.type === "redact" && Array.isArray(entry.items) && entry.items.length > 0 && entry.items.every(isRedactItem)) {
        raw = applyRedactLines(raw, entry.items)
        shown = applyRedactLines(shown, entry.items)
        fromFile++
      }
    } catch {
      // skip
    }
  }
  const redaction: LoadedSession["redaction"] = { fromFile, confirmed: [] }
  const rawBlocks = opts.check ? memoryLines(raw).blocks : []
  const shownBlocks = opts.check ? memoryLines(shown).blocks : []
  if (opts.check && rawBlocks.length + shownBlocks.length > 0) {
    // One look at the store for both lists; each list is masked with its own block objects.
    const result = await opts.check.check([...rawBlocks, ...shownBlocks])
    const model = applyCheck(raw, rawBlocks, result)
    const view = applyCheck(shown, shownBlocks, result)
    raw = model.kept
    shown = view.sent
    redaction.confirmed = mergeItems(model.record, view.record)
    const temporary = model.temporary ?? view.temporary
    if (temporary) redaction.temporary = temporary
  }
  const { messages, patched } = closeDanglingToolCalls(raw)
  const display = closeDanglingToolCalls(shown).messages
  // Closing dangling calls may insert results: a card stays after the message it followed.
  const placed = [...cards.values()].map(({ after, ...c }) => {
    const i = after ? display.indexOf(after) : -1
    return { ...c, at: i >= 0 ? i + 1 : Math.min(c.at, display.length) }
  })
  return { summary, meta, messages, display, contextTokens, patched, charts, harness, lastTurn, cards: placed, redaction }
}

/**
 * Every tool call must have exactly one result or providers reject the next request.
 * Add an "interrupted" error result right after any call left without one (Codex
 * `ensure_call_outputs_present`), and drop results whose call is missing. `reason`
 * lets an aborted turn say so instead of blaming a finished session.
 */
export function closeDanglingToolCalls(messages: ModelMessage[], reason = "Tool bị ngắt vì phiên trước kết thúc giữa chừng."): { messages: ModelMessage[]; patched: number } {
  const results = new Set<string>()
  const calls = new Set<string>()
  for (const m of messages) {
    if (m.role === "tool") for (const p of m.content) if (p.type === "tool-result") results.add(p.toolCallId)
    if (m.role === "assistant" && typeof m.content !== "string")
      for (const p of m.content) if (p.type === "tool-call") calls.add(p.toolCallId)
  }
  let patched = 0
  const out: ModelMessage[] = []
  for (const m of messages) {
    if (m.role === "tool") {
      const content = m.content.filter((p) => p.type !== "tool-result" || calls.has(p.toolCallId))
      if (content.length > 0) out.push({ ...m, content })
      continue
    }
    out.push(m)
    if (m.role !== "assistant" || typeof m.content === "string") continue
    const missing = m.content.filter((p) => p.type === "tool-call" && !results.has(p.toolCallId))
    if (missing.length === 0) continue
    patched += missing.length
    out.push({
      role: "tool",
      content: missing.map((p) => {
        const call = p as { toolCallId: string; toolName: string }
        return {
          type: "tool-result" as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: { type: "error-text" as const, value: reason },
        }
      }),
    })
  }
  return { messages: out, patched }
}
