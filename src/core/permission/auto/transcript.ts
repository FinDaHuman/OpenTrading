import type { ModelMessage } from "ai"
import type { AgentOrigin, ToolDef } from "../../tools/types"

/**
 * What the auto-mode classifier reads: the user's own words and the agent's actions, never the
 * assistant's prose or tool results (Claude Code's classifier is "reasoning-blind": assistant
 * text could argue its way past it, tool results are where injected instructions arrive).
 *
 * Kept by the runtime rather than taken from the SDK's messages: a subagent's conversation
 * starts from a task the main agent wrote, and parallel calls of one step are missing there.
 * One log for the whole session (subagents included); /compact does not touch it, so a "don't
 * overwrite X" said at the start still counts. Bounded when rendered.
 *
 * Calls that did not run (auto mode blocked them, the user or a deny rule refused) are marked,
 * so a later call reaching the same effect another way is judged against that; so are calls the
 * user let through after auto mode handed them over (that exact call only: its input is the
 * agent's text, never the user's words). The marks last until the user's next message, or for a
 * subagent's calls until it hands back: a wrong block must not follow the work for the session
 * (and a workaround in a later turn still meets the ordinary rules).
 */

export type LogEntry =
  | { kind: "user"; text: string }
  /** The user's answers to ask_user, or a note typed when denying a call: their words too. */
  | { kind: "answer"; text: string }
  /** A task or follow-up the main agent wrote for a subagent: instructions, but not the user's. */
  | { kind: "task"; agent: string; text: string }
  /** Something the harness delivered as a user turn (background subagent results). */
  | { kind: "notice"; text: string }
  /** `effect`: the tool is not read-only (or only claims to be): worth a sub-agent return check. */
  | { kind: "action"; agent?: string; tool: string; input: string; effect?: true }
  /** A call that did not run, and who stopped it (`rule`: the auto-mode rule's label, when it was auto mode). */
  | { kind: "denied"; agent?: string; tool: string; input: string; by: DeniedBy; rule?: string }
  /** A call auto mode handed to the user, who let it run (or a /permissions retry). */
  | { kind: "approved"; agent?: string; tool: string; input: string }

export type DeniedBy = "auto_mode" | "user" | "deny_rule"

/** Per field, then per entry: long text keeps its head and tail with an explicit marker. */
export const FIELD_CHARS = 2_000
/** A denied call's input: enough to name its target. */
export const DENIED_CHARS = 300
export const MAX_ENTRIES = 40
export const MAX_CHARS = 20_000
/** The user's own lines may use this much of MAX_CHARS; the rest is kept for the actions. */
export const MAX_PINNED_CHARS = 12_000

/** Head and tail of `text` with how much was left out between them. */
export function clip(text: string, max = FIELD_CHARS) {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.6)
  const tail = max - head
  return `${text.slice(0, head)}[đã lược ${text.length - head - tail} ký tự]${text.slice(text.length - tail)}`
}

/** The parts of a call that decide what it does, short. */
export function compactInput(def: Pick<ToolDef, "name" | "subject">, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""))
  switch (def.name) {
    case "shell":
      return JSON.stringify({ command: clip(s(i.command)), ...(i.workdir ? { workdir: i.workdir } : {}) })
    case "write_file":
      return JSON.stringify({ path: def.subject?.(input) ?? i.path, content: clip(s(i.content)) })
    case "edit_file":
      return JSON.stringify({ path: def.subject?.(input) ?? i.path, old_string: clip(s(i.old_string), 800), new_string: clip(s(i.new_string), 1200), ...(i.replace_all ? { replace_all: true } : {}) })
    case "web_fetch":
      return JSON.stringify({ url: i.url, ...(i.prompt ? { prompt: clip(s(i.prompt), 300) } : {}) })
    case "web_search":
      return JSON.stringify({ query: i.query, ...(i.allowed_domains ? { allowed_domains: i.allowed_domains } : {}) })
    case "read_file":
    case "glob_files":
    case "grep_files":
      return JSON.stringify({ path: def.subject?.(input) ?? i.path, ...(i.pattern ? { pattern: i.pattern } : {}) })
    default:
      return clip(JSON.stringify(input ?? {}))
  }
}

/** A compact input as a JSON value again, so a log line is not JSON inside a JSON string. */
export function asJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Tools whose calls the classifier sees even when they ran without asking: they can leak data in a URL or a query. */
const ALWAYS_LOGGED = new Set(["web_fetch", "web_search"])

/** A background subagent's report as delivered to the main agent (subagents/notification.ts). */
const NOTICE_BLOCK = /<thong_bao_subagent>[\s\S]*?<\/thong_bao_subagent>/g

/** The harness's marks on calls (refused, or approved by the user after a hand-off). */
const isMark = (e: LogEntry): e is Extract<LogEntry, { kind: "denied" | "approved" }> => e.kind === "denied" || e.kind === "approved"

export class ActionLog {
  private entries: LogEntry[] = []
  /** Turn texts the harness sends in the user's name (an MCP prompt's expansion): not the user's words. */
  private harness = new Set<string>()

  /** The next turn with exactly this text came from the harness, not the user. */
  markHarness(text: string) {
    this.harness.add(text.trim())
  }

  /**
   * A turn's input: the user's words, a subagent's task (the main agent's words), or harness
   * text. Subagent reports ride in front of what the user typed (tui send()): they are split
   * off as notices, so a report built from web pages never counts as the user's consent.
   */
  turn(text: string, opts: { agent?: AgentOrigin; note?: string } = {}) {
    if (!text.trim()) return
    if (opts.agent) {
      this.entries.push({ kind: "task", agent: `${opts.agent.type}#${opts.agent.id}`, text: clip(text) })
      return
    }
    let rest = text
    for (const block of text.match(NOTICE_BLOCK) ?? []) {
      this.entries.push({ kind: "notice", text: clip(block, 600) })
      rest = rest.replace(block, "")
    }
    if (opts.note) rest = rest.replace(opts.note, "")
    rest = rest.trim()
    if (!rest) return
    // Checked after the reports are split off: they may ride in front of the prompt's text.
    if (this.harness.delete(rest)) this.entries.push({ kind: "notice", text: clip(rest, 1_500) })
    else {
      // The user spoke again: earlier marks stop counting (see the header); a subagent still at work keeps its own.
      this.entries = this.entries.filter((e) => !isMark(e) || e.agent !== undefined)
      this.entries.push({ kind: "user", text: clip(rest, 4_000) })
    }
  }

  answer(text: string) {
    if (text.trim()) this.entries.push({ kind: "answer", text: clip(text, 2_000) })
  }

  /** A call about to be checked: logged when it may change something or reach the network. */
  action(def: ToolDef, input: unknown, agent?: AgentOrigin) {
    // A read that runs without asking (a plain read_file, a data-server quote) is not an action
    // that needs judging, and dozens per turn would push the scripts out of the log. A tool that
    // only claims to be read-only (another MCP server) is: its arguments go to another program.
    if (def.readOnly && !def.autoReview && !ALWAYS_LOGGED.has(def.name) && def.askFor?.(input) === undefined) return
    this.entries.push({
      kind: "action",
      tool: def.name,
      input: compactInput(def, input),
      ...(agent ? { agent: `${agent.type}#${agent.id}` } : {}),
      ...(!def.readOnly || def.autoReview ? { effect: true as const } : {}),
    })
  }

  /** The call just checked did not run: who stopped it, and the auto-mode rule if it was auto mode. */
  denied(def: Pick<ToolDef, "name" | "subject">, input: unknown, by: DeniedBy, rule?: string, agent?: AgentOrigin) {
    this.entries.push({
      kind: "denied",
      tool: def.name,
      input: clip(compactInput(def, input), DENIED_CHARS),
      by,
      ...(rule ? { rule } : {}),
      ...(agent ? { agent: `${agent.type}#${agent.id}` } : {}),
    })
  }

  /** The user let this call run after auto mode handed it over. `input` is compact already. */
  approved(tool: string, input: string, agent?: AgentOrigin) {
    this.entries.push({ kind: "approved", tool, input: clip(input, DENIED_CHARS), ...(agent ? { agent: `${agent.type}#${agent.id}` } : {}) })
  }

  /** A subagent handed back: its marks stop counting. */
  agentDone(agent: AgentOrigin) {
    const tag = `${agent.type}#${agent.id}`
    this.entries = this.entries.filter((e) => !isMark(e) || e.agent !== tag)
  }

  /**
   * Rebuild from a resumed conversation (--continue): user texts and tool calls, not results.
   * `harness` are the turn texts the session recorded as harness-written (an MCP prompt's template).
   */
  rebuild(history: readonly ModelMessage[], defOf: (name: string) => ToolDef | undefined, visible: (m: ModelMessage) => string, harness: readonly string[] = []) {
    this.entries = []
    this.harness = new Set(harness.map((t) => t.trim()))
    for (const m of history) {
      if (m.role === "user") this.turn(visible(m))
      else if (m.role === "assistant" && typeof m.content !== "string") {
        for (const part of m.content) {
          if (part.type !== "tool-call") continue
          const def = defOf(part.toolName)
          if (def) this.action(def, part.input)
        }
      }
    }
  }

  all(): readonly LogEntry[] {
    return this.entries
  }

  /**
   * JSONL for the classifier, oldest first: the user's messages and answers first (they carry
   * the intent and the boundaries), then the most recent other entries up to the limits. A very
   * long session keeps the first user message and the newest ones within MAX_PINNED_CHARS, so
   * the actions (a script's content that "Session Scripts" relies on) are never crowded out.
   */
  render(): string {
    const line = (e: LogEntry) => {
      switch (e.kind) {
        case "user":
          return JSON.stringify({ user: e.text })
        case "answer":
          return JSON.stringify({ user_answer: e.text })
        case "task":
          return JSON.stringify({ main_agent_task: e.text, to: e.agent })
        case "notice":
          return JSON.stringify({ harness_notice: e.text })
        case "action":
          return JSON.stringify({ [e.tool]: asJson(e.input), ...(e.agent ? { by: e.agent } : {}) })
        case "denied":
          return JSON.stringify({ denied_previous_action: { [e.tool]: asJson(e.input) }, stopped_by: e.by, ...(e.rule ? { rule: e.rule } : {}), ...(e.agent ? { by: e.agent } : {}) })
        case "approved":
          return JSON.stringify({ user_approved_action: { [e.tool]: asJson(e.input) }, ...(e.agent ? { by: e.agent } : {}) })
      }
    }
    const lines = this.entries.map((e) => ({ e, text: line(e) }))
    // Marks are short and only live until the user's next message: kept with the user's words.
    const pinned = (e: LogEntry) => e.kind === "user" || e.kind === "answer" || isMark(e)
    const keep = new Set<number>()
    let chars = 0
    const users = lines.flatMap((l, i) => (pinned(l.e) ? [i] : []))
    for (const [n, i] of [...users.entries()].reverse()) {
      const size = lines[i]!.text.length
      // The first message (the task) always; the others newest first while they fit.
      if (n > 0 && chars + size > MAX_PINNED_CHARS - (lines[users[0]!]?.text.length ?? 0)) continue
      keep.add(i)
      chars += size
    }
    let others = 0
    for (let i = lines.length - 1; i >= 0; i--) {
      if (keep.has(i)) continue
      if (others >= MAX_ENTRIES || chars + lines[i]!.text.length > MAX_CHARS) break
      keep.add(i)
      others++
      chars += lines[i]!.text.length
    }
    const dropped = lines.length - keep.size
    return [...(dropped > 0 ? [JSON.stringify({ omitted_earlier_entries: dropped })] : []), ...lines.filter((_, i) => keep.has(i)).map((l) => l.text)].join("\n")
  }
}
