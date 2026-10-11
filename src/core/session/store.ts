import { stripImages } from "../tools/registry"
import { isCompactMarker } from "../compact-marker"
import { splitNotices } from "../subagents/notification"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { ModelMessage } from "ai"
import { dataDir } from "../paths"
import type { ChartData } from "../tools/chart/data"

/**
 * Session transcripts as append-only JSONL, one file per session (the Claude Code / Codex
 * approach): crash-safe, human-readable, and the file is only created once a real turn
 * happens. `index.jsonl` lists sessions for the picker; the last record per id wins.
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
  | { type: "turn_end"; ts: string; provider?: string; model?: string; contextTokens?: number }
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

export class Session {
  turns: number
  title: string
  private createdAt: string
  private writing: Promise<void> = Promise.resolve()

  private constructor(
    readonly id: string,
    /** Relative path; undefined until the first turn is written. */
    public file: string | undefined,
    summary?: SessionSummary,
    createdAt = new Date(),
  ) {
    this.turns = summary?.turns ?? 0
    this.title = summary?.title ?? ""
    // The folder (YYYY/MM) must agree with the id's timestamp, so both come from one clock.
    this.createdAt = summary?.createdAt ?? createdAt.toISOString()
  }

  static create(now = new Date()) {
    return new Session(newSessionId(now), undefined, undefined, now)
  }

  /** Keep appending to an existing session file after resume. */
  static continue(summary: SessionSummary) {
    return new Session(summary.id, summary.file, summary)
  }

  get path() {
    return this.file ? path.join(sessionsDir(), this.file) : undefined
  }

  /** Folder for this session's side files (subagent transcripts); exists before the first turn is written. */
  get dir() {
    return path.join(sessionsDir(), this.createdAt.slice(0, 4), this.createdAt.slice(5, 7), this.id)
  }

  private pendingCharts: { callId: string; data: ChartData }[] = []

  /** A chart drawn during the current turn; written with the turn. */
  noteChart(callId: string, data: ChartData) {
    this.pendingCharts.push({ callId, data })
  }

  /** Record a compaction. Nothing to do before the first turn created the file. */
  appendCompact(entry: Omit<Extract<SessionEntry, { type: "compact" }>, "type" | "ts">) {
    this.writing = this.writing.then(async () => {
      if (!this.path) return
      const line: SessionEntry = { type: "compact", ts: new Date().toISOString(), ...entry, messages: stripImages(entry.messages) }
      await appendFile(this.path, JSON.stringify(line) + "\n", "utf8")
    })
    return this.writing
  }

  /** Resolves once every queued write has finished (a failed earlier write is not rethrown). */
  flush(): Promise<void> {
    return this.writing.catch(() => {})
  }

  /** Append one completed turn. Writes are serialised so turns never interleave. */
  appendTurn(messages: ModelMessage[], info: SessionInfo & { provider?: string; model?: string; contextTokens?: number }) {
    this.writing = this.writing.then(() => this.write(messages, info))
    return this.writing
  }

  private async write(messages: ModelMessage[], info: SessionInfo & { provider?: string; model?: string; contextTokens?: number }) {
    const ts = new Date().toISOString()
    const lines: SessionEntry[] = []
    if (!this.file) {
      const [year, month] = [this.createdAt.slice(0, 4), this.createdAt.slice(5, 7)]
      this.file = path.join(year, month, `${this.id}.jsonl`)
      await mkdir(path.dirname(this.path!), { recursive: true })
      lines.push({
        type: "meta",
        format: SESSION_FORMAT,
        id: this.id,
        createdAt: this.createdAt,
        cwd: info.cwd,
        promptVersion: info.promptVersion,
        skills: info.skills,
      })
    }
    // Screenshots would bloat the file by megabytes per turn; keep a text placeholder.
    for (const message of stripImages(messages)) lines.push({ type: "message", ts, message })
    for (const chart of this.pendingCharts.splice(0)) lines.push({ type: "chart", ts, ...chart })
    lines.push({ type: "turn_end", ts, provider: info.provider, model: info.model, contextTokens: info.contextTokens })
    await appendFile(this.path!, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8")

    this.turns++
    if (!this.title) {
      const first = messages.map(userText).find((t) => t.trim())
      this.title = (first ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "(không tiêu đề)"
    }
    const summary: SessionSummary = {
      id: this.id,
      file: this.file.split(path.sep).join("/"),
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: ts,
      provider: info.provider,
      model: info.model,
      turns: this.turns,
    }
    await mkdir(sessionsDir(), { recursive: true })
    await appendFile(indexFile(), JSON.stringify(summary) + "\n", "utf8")
  }
}

/** Newest first. Malformed index lines and sessions whose file is gone are skipped. */
export async function listSessions(): Promise<SessionSummary[]> {
  const text = await readFile(indexFile(), "utf8").catch(() => "")
  const byId = new Map<string, SessionSummary>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const summary = JSON.parse(line) as SessionSummary
      if (!summary.id || !summary.file) continue
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
  return all.filter((_, i) => exists[i])
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
  /** Context size after the last turn or compaction, if recorded. */
  contextTokens?: number
  /** Tool calls that had no result and were closed with an "interrupted" result. */
  patched: number
}

/** Read a session back. Unreadable lines (e.g. a write cut by a crash) are skipped. */
export async function loadSession(id: string): Promise<LoadedSession> {
  const summary = (await listSessions()).find((s) => s.id === id || s.id.startsWith(id))
  if (!summary) throw new Error(`Không tìm thấy phiên "${id}". Gõ /sessions để xem danh sách.`)
  const text = await readFile(path.join(sessionsDir(), summary.file), "utf8")
  let meta: LoadedSession["meta"]
  let raw: ModelMessage[] = []
  const shown: ModelMessage[] = []
  let contextTokens: number | undefined
  const charts = new Map<string, ChartData>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as SessionEntry
      if (entry.type === "meta") meta = entry
      else if (entry.type === "message") {
        raw.push(entry.message)
        shown.push(entry.message)
      } else if (entry.type === "compact" && Array.isArray(entry.messages)) {
        raw = [...entry.messages]
        // The marker and summary (absent when only tool results were pruned).
        if (entry.messages[0] && isCompactMarker(entry.messages[0])) shown.push(...entry.messages.slice(0, 2))
        contextTokens = entry.after
      } else if (entry.type === "turn_end" && entry.contextTokens !== undefined) contextTokens = entry.contextTokens
      else if (entry.type === "chart" && entry.callId && entry.data) charts.set(entry.callId, entry.data)
    } catch {
      // skip
    }
  }
  const { messages, patched } = closeDanglingToolCalls(raw)
  return { summary, meta, messages, display: closeDanglingToolCalls(shown).messages, contextTokens, patched, charts }
}

/**
 * Every tool call must have exactly one result or providers reject the next request.
 * Add an "interrupted" error result right after any call left without one (Codex
 * `ensure_call_outputs_present`), and drop results whose call is missing.
 */
export function closeDanglingToolCalls(messages: ModelMessage[]): { messages: ModelMessage[]; patched: number } {
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
          output: { type: "error-text" as const, value: "Tool bị ngắt vì phiên trước kết thúc giữa chừng." },
        }
      }),
    })
  }
  return { messages: out, patched }
}
