import { readFile } from "node:fs/promises"
import type { z } from "zod"
import { runAgent } from "../agent"
import { describeError, resolveTarget, type Target } from "../chat"
import { loadConfig, type Config } from "../config"
import { isEffort, type Effort } from "../effort"
import { classifyFailure, retryText } from "../retry"
import { closeDanglingToolCalls } from "../session/store"
import type { Skill } from "../skills/schema"
import { loadSkillTool } from "../tools/builtin/load-skill"
import { toolSearchTool } from "../tools/builtin/tool-search"
import { ToolRegistry } from "../tools/registry"
import type { ChartData } from "../tools/chart/data"
import type { AgentOrigin, ToolDef } from "../tools/types"
import { Limiter } from "./limiter"
import { AUTO_MODEL, autoTarget } from "./model-pick"
import { lastAssistantText } from "./result"
import { Sidechain, type SidechainEntry } from "./sidechain"
import { MAX_RESULT_ATTEMPTS, RESULT_LAST_STEP, RESULT_REMINDER, RESULT_TOOL, resultTool } from "./structured"
import { MAX_TOOL_VIEWS, type RunFailure, type SubagentResult, type SubagentRun, type SubagentView } from "./types"

export const DEFAULT_MAX_CONCURRENT = 10
export const DEFAULT_SUBAGENT_STEPS = 8
export const DEFAULT_SUBAGENT_TYPE = "nghien-cuu"
/** A subagent that reports nothing for this long (not queued, not waiting on the user) is stopped. */
export const SUBAGENT_IDLE_MS = 5 * 60_000
/** "5 phút" for the default, "0.4 giây" for a test-sized idleMs. */
const idleText = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} phút` : `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} giây`)
/** How often the idle watchdog checks a run. */
const watchdogTick = (idleMs: number) => Math.min(10_000, idleMs)
/** Finished runs kept in memory (the sidechain files keep the rest). */
const MAX_FINISHED = 20

/**
 * Tools a subagent never gets (Claude Code strips the Agent tool from subagents): no
 * nesting, nothing that talks to the user or the parent's pinned panel. tool_search and
 * load_skill are re-created bound to the child's own registry.
 */
// desk_run (literal: importing desk/tool would cycle back here): a child must never start a
// desk run, and it would read the main turn's opt-in.
export const EXCLUDED_TOOLS = new Set(["spawn_subagent", "send_message", "stop_agent", "ask_user", "todo_write", "tool_search", "load_skill", "desk_run"])

/**
 * The child's registry: the parent's tools minus EXCLUDED_TOOLS and memory tools (a child
 * must not propose memories about the user), narrowed by `filter`. It shares the parent's
 * lock (writes exclude each other across agents) and gate (approvals reach the main UI).
 */
export function childRegistry(parent: ToolRegistry, origin: AgentOrigin, filter?: (def: ToolDef) => boolean, skills?: () => Skill[]) {
  const child = new ToolRegistry({ lock: parent.lock, origin })
  child.gate = parent.gate
  child.workspace = parent.workspace
  const candidates = parent
    .list()
    .filter((t) => !EXCLUDED_TOOLS.has(t.name) && !t.source?.startsWith("memory:") && (!filter || filter(t)))
  if (candidates.length === 0) throw new Error("Subagent không có tool nào để dùng (danh sách tool rỗng hoặc không khớp).")
  for (const def of candidates) child.register(def)
  if (candidates.some((t) => t.deferrable)) child.register(toolSearchTool(child))
  if (skills) {
    child.register(
      loadSkillTool(skills, () =>
        child
          .list()
          .filter((d) => d.deferrable)
          .map((d) => d.name),
      ),
    )
  }
  return child
}

/** A run's effort: the call's or the type's, else config subagents.effort, else config effort. */
export function subagentEffort(spec: { effort?: unknown }, config: Pick<Config, "effort" | "subagents">): Effort | undefined {
  return [spec.effort, config.subagents?.effort, config.effort].find(isEffort)
}

/** What an agent type contributes to a run (spawn_subagent and send_message resolve it). */
export interface TypeSpec {
  maxSteps?: number
  /** Extra instructions of the agent type. */
  agentPrompt?: string
  /** Narrow the tools beyond EXCLUDED_TOOLS. */
  toolFilter?: (def: ToolDef) => boolean
  /** Model of the agent type; else config subagents, else the session's. */
  model?: { provider?: string; model?: string }
  /** Reasoning effort; else config subagents.effort, else config effort. */
  effort?: Effort
}

export interface StartSpec extends TypeSpec {
  type?: string
  description: string
  prompt: string
  /** The spawn_subagent call in the parent transcript. */
  parentCallId?: string
  /** Aborts the subagent with the parent turn (foreground); background runs have none. */
  parentSignal?: AbortSignal
  background?: boolean
  /**
   * Structured output: the agent must call tra_ket_qua with input matching this schema (its
   * last step is forced to); the result's `data` holds it. Up to MAX_RESULT_ATTEMPTS turns.
   */
  schema?: z.ZodObject
  /** The ultradesk run this agent belongs to. */
  deskRunId?: string
}

export interface ManagerDeps {
  parent: ToolRegistry
  skills?: () => Skill[]
  serverInstructions?: () => { server: string; text: string }[]
}

type Listener = (view: SubagentView) => void

/** Per-run state the views never carry. */
interface RunContext {
  child: ToolRegistry
  spec: StartSpec
  /** The structured result, once tra_ket_qua accepted one. */
  data?: unknown
  /** Messages from send_message, taken after the current turn. */
  inbox: string[]
  /** The parent turn's signal, for foreground runs. */
  parentSignal?: AbortSignal
}

const newId = () => `ag-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`

/** A copy without the live parts (controller, messages, promise): what UIs store. */
export function viewOf(run: SubagentRun): SubagentView {
  const { controller: _c, messages: _m, done: _d, ...view } = run
  return { ...view, tools: run.tools.map((t) => ({ ...t })), usage: { ...run.usage }, retry: run.retry ? { ...run.retry } : undefined }
}

const isActive = (run: { status: string }) => run.status === "queued" || run.status === "running"

/**
 * Starts, tracks, continues and stops subagents for one runtime. UIs follow progress
 * through `onChange` (the parent's tool call is still pending while a child works, so
 * nothing reaches the agent event stream until it returns), and background results
 * through `onFinished`.
 */
export class SubagentManager {
  readonly limiter: Limiter
  private runs = new Map<string, SubagentRun>()
  private contexts = new Map<string, RunContext>()
  private listeners = new Set<Listener>()
  private finished = new Set<Listener>()
  private session?: { id: string; dir: string }
  private max = DEFAULT_MAX_CONCURRENT
  /** No-event stop threshold; config `subagents.idleMs`, default 5 minutes. */
  private idleMs = SUBAGENT_IDLE_MS
  /**
   * `subagents.idleMs` when set: the run's stall window follows it (runAgent `stallMs`), placed
   * past the watchdog's next check so the watchdog, not the stall, stops a silent run.
   */
  private idleConfigured?: number
  /** Sidechain writes not finished yet (exit waits for them). */
  private writes = new Set<Promise<unknown>>()
  /**
   * Setup (config, model) runs one spawn after another, so slots are taken in the order
   * the model asked for them, not in whichever order the async setup happened to finish.
   */
  private setup: Promise<unknown> = Promise.resolve()
  /** Disk errors, reported once per run to whoever listens (the TUI shows them). */
  onPersistError?: (error: unknown) => void

  constructor(private deps: ManagerDeps) {
    this.limiter = new Limiter(() => this.max)
  }

  /** Session each run belongs to: only runs of the attached session notify (/clear, /new, resume). */
  private owners = new Map<string, string | undefined>()

  /** Where sidechains go; undefined (headless runs) = not persisted. */
  attachSession(session: { id: string; dir: string } | undefined) {
    this.session = session
  }

  setMax(n: number) {
    this.max = n
    this.limiter.drain()
  }

  onChange(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private chartListeners = new Set<(chart: ChartData, view: SubagentView, callId: string) => void>()

  /** A subagent's tool drew a chart: the parent UI shows it (the child has no transcript of its own). */
  onChart(listener: (chart: ChartData, view: SubagentView, callId: string) => void) {
    this.chartListeners.add(listener)
    return () => this.chartListeners.delete(listener)
  }

  /** A background run finished a turn (completed, failed or stopped): its result is ready. */
  onFinished(listener: Listener) {
    this.finished.add(listener)
    return () => this.finished.delete(listener)
  }

  get(id: string): SubagentView | undefined {
    const run = this.runs.get(id)
    return run && viewOf(run)
  }

  list(): SubagentView[] {
    return [...this.runs.values()].map(viewOf)
  }

  /** Stop one subagent (queued or running). */
  stop(id: string) {
    const run = this.runs.get(id)
    if (!run || !isActive(run)) return false
    run.controller.abort()
    return true
  }

  /** Stop everything still queued or running (exit, /clear). Returns how many. */
  stopAll() {
    let n = 0
    for (const run of this.runs.values()) if (this.stop(run.id)) n++
    return n
  }

  /** Wait for pending sidechain writes (before the process exits). */
  async flush() {
    await Promise.all([...this.writes])
  }

  /** The user's answer to a subagent's approval prompt, shown under that child call. */
  recordDecision(agentId: string, callId: string | undefined, text: string) {
    const run = this.runs.get(agentId)
    const call = run?.tools.find((t) => t.callId === callId)
    if (!run || !call) return
    call.decision = text
    this.emit(run)
  }

  /**
   * Start a subagent. Throws at once when it would have no tools; everything later
   * (model setup, provider errors, aborts) ends up in the result.
   */
  start(spec: StartSpec): SubagentRun {
    const id = newId()
    const type = spec.type ?? DEFAULT_SUBAGENT_TYPE
    const child = childRegistry(this.deps.parent, { id, type, description: spec.description }, spec.toolFilter, this.deps.skills)
    const run: SubagentRun = {
      id,
      type,
      description: spec.description,
      prompt: spec.prompt,
      parentCallId: spec.parentCallId,
      background: !!spec.background,
      model: "",
      status: "queued",
      createdAt: Date.now(),
      tools: [],
      toolCount: 0,
      usage: { input: 0, output: 0 },
      requests: 0,
      text: "",
      controller: new AbortController(),
      messages: [],
      done: Promise.resolve(undefined as never),
      sessionId: this.session?.id,
      deskRunId: spec.deskRunId,
    }
    const context: RunContext = { child, spec, inbox: [], parentSignal: spec.parentSignal }
    if (spec.schema) child.register(resultTool(spec.schema, (data) => (context.data = data)))
    this.runs.set(id, run)
    this.owners.set(id, this.session?.id)
    this.contexts.set(id, context)
    this.prune()
    run.done = this.loop(run, spec.prompt, true)
    this.emit(run)
    return run
  }

  /**
   * send_message: a running agent gets the message after its current turn; a finished one
   * resumes in the background with its conversation (from memory, else its sidechain).
   * `resolve` gives the agent type's settings when it has to be rebuilt from disk.
   */
  async continue(id: string, message: string, resolve: (type: string) => TypeSpec | undefined): Promise<"queued" | "resumed"> {
    let run = this.runs.get(id)
    // Another session's agent (after /clear or a resume) is not this conversation's to continue.
    if (run && this.owners.get(id) !== this.session?.id) run = undefined
    if (!run) run = await this.restore(id, resolve)
    const context = this.contexts.get(id)!
    if (isActive(run)) {
      context.inbox.push(message)
      return "queued"
    }
    context.parentSignal = undefined
    // A continuation must produce its own structured result, never return the previous one.
    context.data = undefined
    Object.assign(run, { status: "queued", background: true, controller: new AbortController(), text: "", error: undefined, endedAt: undefined })
    run.done = this.loop(run, message, false)
    this.emit(run)
    return "resumed"
  }

  /** Rebuild a finished agent from its sidechain (a resumed session, or evicted from memory). */
  private async restore(id: string, resolve: (type: string) => TypeSpec | undefined): Promise<SubagentRun> {
    const known = this.list()
      .filter((v) => this.owners.get(v.id) === this.session?.id)
      .map((v) => v.id)
    const missing = () => new Error(`Không có subagent "${id}".${known.length > 0 ? ` Các subagent hiện có: ${known.join(", ")}.` : ""}`)
    if (!this.session || !/^ag-[a-z0-9]+$/.test(id)) throw missing()
    const text = await readFile(new Sidechain(this.session.dir, id).file, "utf8").catch(() => undefined)
    if (!text) throw missing()
    const entries = text
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as SidechainEntry]
        } catch {
          return []
        }
      })
    const meta = entries.find((e) => e.type === "agent_meta")
    if (meta?.type !== "agent_meta") throw missing()
    const { messages } = closeDanglingToolCalls(entries.flatMap((e) => (e.type === "message" ? [e.message] : [])))
    const ends = entries.filter((e) => e.type === "agent_end")
    const type = resolve(meta.agentType)
    const spec: StartSpec = {
      ...type,
      type: meta.agentType,
      description: meta.description,
      prompt: meta.prompt,
      model: type?.model ?? { provider: meta.provider || undefined, model: meta.model },
      background: true,
    }
    const child = childRegistry(this.deps.parent, { id, type: meta.agentType, description: meta.description }, spec.toolFilter, this.deps.skills)
    const run: SubagentRun = {
      id,
      type: meta.agentType,
      description: meta.description,
      prompt: meta.prompt,
      parentCallId: meta.parentCallId,
      background: true,
      model: "",
      status: "completed",
      createdAt: Date.parse(meta.createdAt) || Date.now(),
      tools: [],
      toolCount: ends.reduce((n, e) => n + (e.type === "agent_end" ? e.toolCount : 0), 0),
      usage: { input: 0, output: 0 },
      requests: 0,
      text: lastAssistantText(messages),
      controller: new AbortController(),
      messages,
      done: Promise.resolve(undefined as never),
      sessionId: this.session.id,
      deskRunId: meta.deskRunId,
    }
    this.runs.set(id, run)
    this.owners.set(id, this.session.id)
    this.contexts.set(id, { child, spec, inbox: [] })
    return run
  }

  /** One run: setup, a slot, then turns until the inbox is empty. */
  private async loop(run: SubagentRun, input: string, first: boolean): Promise<SubagentResult> {
    const context = this.contexts.get(run.id)!
    const { child, spec } = context
    const signal = context.parentSignal ? AbortSignal.any([context.parentSignal, run.controller.signal]) : run.controller.signal
    const session = this.session
    const sidechain = session ? new Sidechain(session.dir, run.id) : undefined
    const persistError = once(this.onPersistError)
    const entries: SidechainEntry[] = []
    const started = Date.now()
    const toolsBefore = run.toolCount
    const usageBefore = { ...run.usage }
    const requestsBefore = run.requests ?? 0
    let release: (() => void) | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined
    let idleStop = false
    let streamed = ""
    let effort: Effort | undefined
    let failure: RunFailure | undefined
    let attempts = 0
    /** This turn ended because the model ignored the forced tra_ket_qua call. */
    let missedTool = false
    try {
      const fallback: SidechainEntry[] = []
      const prepared = this.setup.then(async () => {
        const config = await loadConfig()
        effort = subagentEffort(spec, config)
        this.max = config.subagents?.maxConcurrent ?? this.max
        const idle = config.subagents?.idleMs
        this.idleConfigured = typeof idle === "number" && Number.isFinite(idle) && idle >= 1_000 ? idle : undefined
        this.idleMs = this.idleConfigured ?? SUBAGENT_IDLE_MS
        return this.targetFor(spec, config.subagents, fallback)
      })
      this.setup = prepared.catch(() => {})
      const target = await prepared
      run.model = `${target.provider.name} · ${target.model}`
      const fell = fallback.find((e) => e.type === "notice")
      if (fell?.type === "notice") run.notice = fell.text
      if (target.provider.models[target.model]?.tool_call === false) {
        throw new Error(`Model ${target.model} không hỗ trợ gọi tool nên không chạy được subagent. Đổi "Model cho subagent" trong /config.`)
      }
      this.emit(run)
      if (sidechain && session && first) {
        entries.push({
          type: "agent_meta",
          format: 1,
          agentId: run.id,
          agentType: run.type,
          description: run.description,
          prompt: run.prompt,
          parentSessionId: session.id,
          parentCallId: run.parentCallId,
          ...(run.deskRunId ? { deskRunId: run.deskRunId } : {}),
          background: run.background,
          provider: target.provider.id ?? "",
          model: target.model,
          createdAt: new Date(run.createdAt).toISOString(),
        })
      }
      entries.push(...fallback)

      release = await this.limiter.acquire(signal)
      run.status = "running"
      run.startedAt ??= Date.now()
      this.emit(run)

      // Idle watchdog instead of a wall-clock limit: waiting for a slot or for the user's
      // approval never counts.
      let last = Date.now()
      watchdog = setInterval(() => {
        // Waiting on the user, or on a tool still running (a long shell command, an auto-mode
        // review), is not being idle.
        const asking = child.gate?.pending().some((r) => r.agent?.id === run.id)
        if (asking || run.tools.some((t) => t.status === "running")) last = Date.now()
        else if (Date.now() - last > this.idleMs) {
          idleStop = true
          run.controller.abort()
        }
      }, watchdogTick(this.idleMs))
      watchdog.unref?.()

      // A turn per message: the task, then whatever send_message queued meanwhile. With a
      // schema, a turn that ended without a valid result is followed by a reminder turn.
      // Reminder turns get a single step, which is then the forced one: the findings are
      // already in the conversation, only the call is missing. A schema run therefore makes
      // at most maxSteps + MAX_RESULT_ATTEMPTS - 1 requests (ultradesk estimates count on it).
      let reminding = false
      const following = () => {
        reminding = false
        if (context.inbox.length > 0) return context.inbox.splice(0).join("\n\n")
        if (spec.schema && context.data === undefined && run.status === "completed" && attempts < MAX_RESULT_ATTEMPTS) {
          reminding = true
          return RESULT_REMINDER
        }
        return undefined
      }
      for (let next: string | undefined = input; next !== undefined; next = following()) {
        const history = run.messages
        streamed = ""
        run.status = "running"
        attempts++
        for await (const event of runAgent({
          history,
          input: next,
          skills: this.deps.skills?.() ?? [],
          registry: child,
          maxSteps: reminding ? 1 : (spec.maxSteps ?? DEFAULT_SUBAGENT_STEPS),
          signal,
          stallMs: this.idleConfigured === undefined ? undefined : this.idleConfigured + 2 * watchdogTick(this.idleConfigured),
          role: "subagent",
          target,
          agentPrompt: spec.agentPrompt,
          serverInstructions: this.deps.serverInstructions,
          effort,
          ...(spec.schema ? { finalTool: RESULT_TOOL, finalPrompt: RESULT_LAST_STEP } : {}),
        })) {
          last = Date.now()
          // Anything after a retry notice means the wait is over (the request went out again).
          if (run.retry && event.type !== "retry") {
            run.retry = undefined
            this.emit(run)
          }
          switch (event.type) {
            case "text-delta":
              streamed += event.text
              break
            case "tool-start":
              run.toolCount++
              run.tools.push({ callId: event.callId, name: event.name, label: event.label, status: "running" })
              if (run.tools.length > MAX_TOOL_VIEWS) run.tools.splice(0, run.tools.length - MAX_TOOL_VIEWS)
              this.emit(run)
              break
            case "tool-end": {
              const call = run.tools.find((t) => t.callId === event.callId)
              if (call) Object.assign(call, { status: event.ok ? "ok" : "error", durationMs: event.durationMs })
              this.emit(run)
              if (event.ok && event.chart) for (const listener of this.chartListeners) listener(event.chart, viewOf(run), event.callId)
              break
            }
            case "step":
              run.requests = (run.requests ?? 0) + 1
              this.emit(run)
              break
            case "step-usage":
              run.usage.input += event.inputTokens
              run.usage.output += event.outputTokens
              this.emit(run)
              break
            case "notice":
              entries.push({ type: "notice", ts: new Date().toISOString(), text: event.text })
              break
            case "retry":
              entries.push({ type: "notice", ts: new Date().toISOString(), text: retryText(event) })
              run.retry = { attempt: event.attempt, max: event.max, until: event.until, label: event.label }
              this.emit(run)
              break
            case "error":
              // Prose where tra_ket_qua was required is a missing result, not a failure:
              // the reminder turns below ask again.
              if (event.kind === "tool-choice" && spec.schema) {
                missedTool = true
                break
              }
              run.error = event.message
              failure = event.kind === "tool-choice" ? "fatal" : event.kind
              break
            case "done": {
              run.messages = [...history, ...event.messages]
              const ts = new Date().toISOString()
              for (const message of event.messages) entries.push({ type: "message", ts, message })
              if (event.outcome === "completed") {
                const text = lastAssistantText(event.messages)
                run.text = text === "(không có câu trả lời)" ? "" : text
                run.status = "completed"
              } else if (missedTool && event.outcome === "failed") {
                run.text = streamed.trim()
                run.status = "completed"
              } else {
                run.text = streamed.trim()
                run.status = event.outcome === "aborted" ? "stopped" : "failed"
              }
              missedTool = false
              break
            }
          }
        }
        if (run.status !== "completed") break
      }
      if (run.status === "running") run.status = signal.aborted ? "stopped" : "failed"
      // Messages that arrived for a turn that never came: say so rather than drop them.
      if (context.inbox.length > 0) {
        const lost = context.inbox.splice(0)
        run.error = `${run.error ? `${run.error}. ` : ""}Chưa xử lý ${lost.length} tin nhắn gửi thêm: ${lost.join(" / ").slice(0, 300)}`
      }
      if (idleStop) {
        run.error = `Subagent không có tiến triển trong ${idleText(this.idleMs)} nên đã bị dừng.`
        failure = "stall"
      }
      if (spec.schema && run.status === "completed" && context.data === undefined) {
        run.status = "failed"
        run.error = `Subagent không trả kết quả đúng schema qua ${RESULT_TOOL} sau ${attempts} lượt.`
        failure = "invalid-output"
      }
    } catch (error) {
      run.status = signal.aborted ? "stopped" : "failed"
      if (!signal.aborted) {
        run.error = describeError(error)
        failure = classifyFailure(error).kind
      }
      run.text = streamed.trim()
    } finally {
      clearInterval(watchdog)
      release?.()
      run.endedAt = Date.now()
      run.retry = undefined
      for (const call of run.tools) if (call.status === "running") call.status = "error"
      this.emit(run)
    }

    // ▸▸: look back over what the sub-agent did before its result reaches the main agent.
    const gate = this.deps.parent.gate
    const warning =
      run.status === "completed" && gate?.mode === "auto" && gate.auto
        ? await gate.auto.handoff({ id: run.id, type: run.type, description: run.description }, signal).catch(() => undefined)
        : undefined
    if (warning) run.text = `${warning}\n\n${run.text}`
    // Its refusals and approvals no longer count against later calls.
    gate?.auto?.log.agentDone({ id: run.id, type: run.type, description: run.description })
    const result: SubagentResult = {
      status: run.status,
      text: run.text,
      error: run.error,
      ...(run.status === "failed" ? { failure: failure ?? "fatal" } : {}),
      ...(context.data !== undefined ? { data: context.data } : {}),
      toolCount: run.toolCount - toolsBefore,
      usage: { input: run.usage.input - usageBefore.input, output: run.usage.output - usageBefore.output },
      requests: (run.requests ?? 0) - requestsBefore,
      durationMs: run.endedAt! - (first ? (run.startedAt ?? run.createdAt) : started),
    }
    if (sidechain) {
      entries.push({ type: "agent_end", ts: new Date().toISOString(), ...result })
      void sidechain.append(entries, persistError)
      const written = sidechain.writeMeta(
        {
          agentId: run.id,
          agentType: run.type,
          description: run.description,
          status: run.status,
          createdAt: new Date(run.createdAt).toISOString(),
          updatedAt: new Date().toISOString(),
          toolCount: run.toolCount,
          usage: { ...run.usage },
          parentCallId: run.parentCallId,
          ...(run.deskRunId ? { deskRunId: run.deskRunId } : {}),
        },
        persistError,
      )
      this.writes.add(written)
      void written.finally(() => this.writes.delete(written))
    }
    if (run.background && this.owners.get(run.id) === this.session?.id) {
      const view = viewOf(run)
      for (const listener of this.finished) listener(view)
    }
    return result
  }

  /**
   * The agent type's model, else config `subagents`, else the session's model. A chosen
   * model that cannot be used (key removed, provider gone) falls back to the session's,
   * with a note: the session model still works, so the child should too.
   */
  private async targetFor(spec: StartSpec, config: { provider?: string; model?: string } | undefined, notes: SidechainEntry[]): Promise<Target> {
    const own = spec.model?.model || spec.model?.provider ? spec.model : undefined
    const configured = config?.model || config?.provider ? { provider: config.provider, model: config.model } : undefined
    const chosen = own ?? configured
    if (!chosen) return resolveTarget()
    if (chosen.model === AUTO_MODEL) {
      const picked = await autoTarget(chosen.provider)
      if (picked) {
        notes.push({ type: "notice", ts: new Date().toISOString(), text: `Subagent tự chọn model: ${picked.provider.name} · ${picked.model} (đổi trong /config).` })
        return picked
      }
      notes.push({ type: "notice", ts: new Date().toISOString(), text: "Không tìm thấy model lite phù hợp cho subagent; dùng model của phiên." })
      return resolveTarget()
    }
    try {
      return await resolveTarget(chosen)
    } catch (error) {
      notes.push({ type: "notice", ts: new Date().toISOString(), text: `Không dùng được model cho subagent (${describeError(error)}); dùng model của phiên.` })
      return resolveTarget()
    }
  }

  private prune() {
    const finished = [...this.runs.values()].filter((r) => !isActive(r))
    for (const run of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) {
      this.runs.delete(run.id)
      this.contexts.delete(run.id)
      this.owners.delete(run.id)
    }
  }

  private emit(run: SubagentRun) {
    if (this.listeners.size === 0) return
    const view = viewOf(run)
    for (const listener of this.listeners) listener(view)
  }
}

function once(fn: ((error: unknown) => void) | undefined) {
  let called = false
  return (error: unknown) => {
    if (called) return
    called = true
    fn?.(error)
  }
}

