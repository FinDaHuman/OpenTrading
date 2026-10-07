import { runAgent } from "../agent"
import { describeError, resolveTarget, type Target } from "../chat"
import { loadConfig } from "../config"
import type { Skill } from "../skills/schema"
import { loadSkillTool } from "../tools/builtin/load-skill"
import { toolSearchTool } from "../tools/builtin/tool-search"
import { ToolRegistry } from "../tools/registry"
import type { AgentOrigin, ToolDef } from "../tools/types"
import { Limiter } from "./limiter"
import { lastAssistantText } from "./result"
import { Sidechain, type SidechainEntry } from "./sidechain"
import { MAX_TOOL_VIEWS, type SubagentResult, type SubagentRun, type SubagentView } from "./types"

export const DEFAULT_MAX_CONCURRENT = 10
export const DEFAULT_SUBAGENT_STEPS = 8
export const DEFAULT_SUBAGENT_TYPE = "nghien-cuu"
/** A subagent that reports nothing for this long (not queued, not waiting on the user) is stopped. */
export const SUBAGENT_IDLE_MS = 5 * 60_000
/** Finished runs kept in memory (the sidechain files keep the rest). */
const MAX_FINISHED = 50

/**
 * Tools a subagent never gets (Claude Code strips the Agent tool from subagents): no
 * nesting, nothing that talks to the user or the parent's pinned panel. tool_search and
 * load_skill are re-created bound to the child's own registry.
 */
export const EXCLUDED_TOOLS = new Set(["spawn_subagent", "send_message", "stop_agent", "ask_user", "todo_write", "tool_search", "load_skill"])

/**
 * The child's registry: the parent's tools minus EXCLUDED_TOOLS and memory tools (a child
 * must not propose memories about the user), narrowed by `filter`. It shares the parent's
 * lock (writes exclude each other across agents) and gate (approvals reach the main UI).
 */
export function childRegistry(parent: ToolRegistry, origin: AgentOrigin, filter?: (def: ToolDef) => boolean, skills?: () => Skill[]) {
  const child = new ToolRegistry({ lock: parent.lock, origin })
  child.gate = parent.gate
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

export interface StartSpec {
  type?: string
  description: string
  prompt: string
  maxSteps?: number
  /** The spawn_subagent call in the parent transcript. */
  parentCallId?: string
  /** Aborts the subagent with the parent turn (foreground); background runs have none. */
  parentSignal?: AbortSignal
  background?: boolean
  /** Extra instructions of the agent type. */
  agentPrompt?: string
  /** Narrow the tools beyond EXCLUDED_TOOLS. */
  toolFilter?: (def: ToolDef) => boolean
  /** Model of the agent type; else config subagents, else the session's. */
  model?: { provider?: string; model?: string }
}

export interface ManagerDeps {
  parent: ToolRegistry
  skills?: () => Skill[]
  serverInstructions?: () => { server: string; text: string }[]
}

type Listener = (view: SubagentView) => void

const newId = () => `ag-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`

/** A copy without the live parts (controller, messages, promise): what UIs store. */
export function viewOf(run: SubagentRun): SubagentView {
  const { controller: _c, messages: _m, done: _d, ...view } = run
  return { ...view, tools: run.tools.map((t) => ({ ...t })), usage: { ...run.usage } }
}

/**
 * Starts, tracks and stops subagents for one runtime. UIs follow progress through
 * `onChange` (the parent's tool call is still pending while a child works, so nothing
 * reaches the agent event stream until it returns).
 */
export class SubagentManager {
  readonly limiter: Limiter
  private runs = new Map<string, SubagentRun>()
  /** Sidechain writes not finished yet (exit waits for them). */
  private writes = new Set<Promise<unknown>>()
  private listeners = new Set<Listener>()
  private session?: { id: string; dir: string }
  private max = DEFAULT_MAX_CONCURRENT
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
    if (!run || (run.status !== "queued" && run.status !== "running")) return false
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
    const origin: AgentOrigin = { id, type, description: spec.description }
    const child = childRegistry(this.deps.parent, origin, spec.toolFilter, this.deps.skills)
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
      text: "",
      controller: new AbortController(),
      messages: [],
      done: Promise.resolve(undefined as never),
    }
    this.runs.set(id, run)
    this.prune()
    run.done = this.loop(run, child, spec)
    this.emit(run)
    return run
  }

  private async loop(run: SubagentRun, child: ToolRegistry, spec: StartSpec): Promise<SubagentResult> {
    const signal = spec.parentSignal ? AbortSignal.any([spec.parentSignal, run.controller.signal]) : run.controller.signal
    const session = this.session
    const sidechain = session ? new Sidechain(session.dir, run.id) : undefined
    const persistError = once(this.onPersistError)
    const entries: SidechainEntry[] = []
    let release: (() => void) | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined
    let idleStop = false
    let streamed = ""
    try {
      const fallback: SidechainEntry[] = []
      const prepared = this.setup.then(async () => {
        const config = await loadConfig()
        this.max = config.subagents?.maxConcurrent ?? this.max
        return this.targetFor(spec, config.subagents, fallback)
      })
      this.setup = prepared.catch(() => {})
      const target = await prepared
      run.model = `${target.provider.name} · ${target.model}`
      if (target.provider.models[target.model]?.tool_call === false) {
        throw new Error(`Model ${target.model} không hỗ trợ gọi tool nên không chạy được subagent. Đổi "Model cho subagent" trong /config.`)
      }
      this.emit(run)
      if (sidechain && session) {
        entries.push({
          type: "agent_meta",
          format: 1,
          agentId: run.id,
          agentType: run.type,
          description: run.description,
          prompt: run.prompt,
          parentSessionId: session.id,
          parentCallId: run.parentCallId,
          background: run.background,
          provider: target.provider.id ?? "",
          model: target.model,
          createdAt: new Date(run.createdAt).toISOString(),
        })
      }
      entries.push(...fallback)

      release = await this.limiter.acquire(signal)
      run.status = "running"
      run.startedAt = Date.now()
      this.emit(run)

      // Idle watchdog instead of a wall-clock limit: waiting for a slot or for the user's
      // approval never counts.
      let last = Date.now()
      watchdog = setInterval(() => {
        const asking = child.gate?.pending().some((r) => r.agent?.id === run.id)
        if (asking) last = Date.now()
        else if (Date.now() - last > SUBAGENT_IDLE_MS) {
          idleStop = true
          run.controller.abort()
        }
      }, 10_000)
      watchdog.unref?.()

      for await (const event of runAgent({
        history: [],
        input: run.prompt,
        skills: this.deps.skills?.() ?? [],
        registry: child,
        maxSteps: spec.maxSteps ?? DEFAULT_SUBAGENT_STEPS,
        signal,
        role: "subagent",
        target,
        agentPrompt: spec.agentPrompt,
        serverInstructions: this.deps.serverInstructions,
      })) {
        last = Date.now()
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
            break
          }
          case "step-usage":
            run.usage.input += event.inputTokens
            run.usage.output += event.outputTokens
            this.emit(run)
            break
          case "notice":
            entries.push({ type: "notice", ts: new Date().toISOString(), text: event.text })
            break
          case "error":
            run.error = event.message
            break
          case "done": {
            run.messages = event.messages
            const ts = new Date().toISOString()
            for (const message of event.messages) entries.push({ type: "message", ts, message })
            if (event.outcome === "completed") {
              const text = lastAssistantText(event.messages)
              run.text = text === "(không có câu trả lời)" ? "" : text
              run.status = "completed"
            } else {
              run.text = streamed.trim()
              run.status = event.outcome === "aborted" ? "stopped" : "failed"
            }
            break
          }
        }
      }
      if (run.status === "running") run.status = signal.aborted ? "stopped" : "failed"
      if (idleStop) run.error = `Subagent không có tiến triển trong ${SUBAGENT_IDLE_MS / 60_000} phút nên đã bị dừng.`
    } catch (error) {
      run.status = signal.aborted ? "stopped" : "failed"
      if (!signal.aborted) run.error = describeError(error)
      run.text = streamed.trim()
    } finally {
      clearInterval(watchdog)
      release?.()
      run.endedAt = Date.now()
      for (const call of run.tools) if (call.status === "running") call.status = "error"
      this.emit(run)
    }

    const result: SubagentResult = {
      status: run.status,
      text: run.text,
      error: run.error,
      toolCount: run.toolCount,
      usage: { ...run.usage },
      durationMs: run.endedAt! - (run.startedAt ?? run.createdAt),
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
        },
        persistError,
      )
      this.writes.add(written)
      void written.finally(() => this.writes.delete(written))
    }
    return result
  }

  /**
   * The agent type's model, else config `subagents`, else the session's model. A chosen
   * model that cannot be used (key removed, provider gone) falls back to the session's,
   * with a note in the sidechain: the session model still works, so the child should too.
   */
  private async targetFor(spec: StartSpec, config: { provider?: string; model?: string } | undefined, notes: SidechainEntry[]): Promise<Target> {
    const own = spec.model?.model || spec.model?.provider ? spec.model : undefined
    const configured = config?.model || config?.provider ? { provider: config.provider, model: config.model } : undefined
    const chosen = own ?? configured
    if (!chosen) return resolveTarget()
    try {
      return await resolveTarget(chosen)
    } catch (error) {
      notes.push({ type: "notice", ts: new Date().toISOString(), text: `Không dùng được model cho subagent (${describeError(error)}); dùng model của phiên.` })
      return resolveTarget()
    }
  }

  private prune() {
    const finished = [...this.runs.values()].filter((r) => r.status !== "queued" && r.status !== "running")
    for (const run of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) this.runs.delete(run.id)
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
