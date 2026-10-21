import { z } from "zod"
import type { Config } from "../config"
import { loadConfig } from "../config"
import { describeError } from "../chat"
import type { AgentDefinition } from "../agents/schema"
import { Limiter } from "../subagents/limiter"
import type { StartSpec } from "../subagents/manager"
import type { SubagentResult, SubagentView } from "../subagents/types"
import { typeSpec } from "../tools/subagent/spawn"
import { agentKey, callHash, DeskJournal, type DeskMeta, type JournalEntry } from "./journal"
import { CUT_TEXT } from "./notification"
import { cleanLabel } from "./sanitize"
import { deskSettings, type DeskSettings } from "./settings"
import type { AgentOpts, DeskAgentView, DeskContext, DeskRunView, DeskSize, Estimate, Playbook } from "./types"

/** Agent type when a call names none: read-only data lookup. */
export const DEFAULT_DESK_TYPE = "tra-cuu"
/** Items one parallel()/pipeline() call takes (Claude Code: 4096); more is an error, not a silent cut. */
export const MAX_ITEMS = 4096
const MAX_LOGS = 200

/** What the engine needs from SubagentManager (tests pass a fake). */
export interface AgentStarter {
  start(spec: StartSpec): { id: string; done: Promise<SubagentResult> }
  onChange?(listener: (view: SubagentView) => void): () => void
}

export interface DeskDeps {
  starter: AgentStarter
  agents: () => AgentDefinition[]
  playbooks: () => Playbook[]
  config?: () => Promise<Config>
}

/** An agent() call that failed (shown in the run's agent list already, so not logged again). */
export class DeskAgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DeskAgentError"
  }
}

/** A run ended early on purpose (quota, a cap, a stop): agent() throws it, parallel() turns it into null. */
export class DeskCut extends Error {
  constructor(readonly cut: NonNullable<DeskRunView["cut"]>) {
    super(CUT_TEXT[cut])
    this.name = "DeskCut"
  }
}


interface RunState {
  view: DeskRunView
  playbook: Playbook
  settings: DeskSettings
  /** Agents of this run at once: settings.maxConcurrent, down to 1 after a rate limit. */
  concurrency: number
  /** Rate-limit failures so far (the first is retried, the second cuts the run). */
  rateLimited: number
  controller: AbortController
  limiter: Limiter
  journal?: DeskJournal
  cache: Map<string, JournalEntry>
  occurrences: Map<string, number>
  phase: string
  paused?: { promise: Promise<void>; release: () => void }
  /** Per prompt prefix: released once the first agent of that prefix has a response. */
  stagger: Map<string, { promise: Promise<void>; release: () => void }>
  done: Promise<DeskRunView>
}

const newId = () => `dk-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`

export interface DeskStart {
  size?: DeskSize
  effort?: DeskRunView["effort"]
}

/**
 * Runs playbooks: each agent() becomes a subagent (foreground, read-only tools, tagged with
 * the run), results land in the journal, and one view per run is what UIs show.
 */
export class DeskEngine {
  private runs = new Map<string, RunState>()
  private listeners = new Set<(view: DeskRunView) => void>()
  private finished = new Set<(view: DeskRunView) => void>()
  private session?: { id: string; dir: string }
  onPersistError?: (error: unknown) => void

  constructor(private deps: DeskDeps) {}

  attachSession(session: { id: string; dir: string } | undefined) {
    this.session = session
  }

  onChange(listener: (view: DeskRunView) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Fires once per run when it ends: the one notice the main agent gets. */
  onFinished(listener: (view: DeskRunView) => void) {
    this.finished.add(listener)
    return () => this.finished.delete(listener)
  }

  playbook(name: string): Playbook | undefined {
    return this.deps.playbooks().find((p) => p.meta.name === name)
  }

  list(): DeskRunView[] {
    return [...this.runs.values()].map((s) => snapshot(s.view))
  }

  get(id: string): DeskRunView | undefined {
    const state = this.runs.get(id)
    return state && snapshot(state.view)
  }

  /** Projected cost of a run, and whether the approval card should warn. */
  async estimate(name: string, args: unknown, size?: DeskSize): Promise<Estimate & { size: DeskSize; warn: boolean }> {
    const playbook = this.require(name)
    const settings = deskSettings(await this.config())
    const chosen = size ?? settings.size
    const parsed = parseArgs(playbook, args)
    const estimate = playbook.meta.estimate(parsed, chosen)
    return { ...estimate, size: chosen, warn: estimate.requests > settings.warnRequests || estimate.agents > settings.maxAgents }
  }

  /** Starts a run in the background; `done` resolves with its final view. Bad args throw here. */
  async start(name: string, args: unknown, opts: DeskStart = {}): Promise<{ id: string; done: Promise<DeskRunView> }> {
    const playbook = this.require(name)
    const parsed = parseArgs(playbook, args)
    return this.launch(newId(), playbook, parsed, opts, new Map())
  }

  /** Runs a stopped or cut run again: answered agents come back from its journal. */
  async resume(id: string): Promise<{ id: string; done: Promise<DeskRunView> }> {
    const live = this.runs.get(id)
    if (live && (live.view.status === "running" || live.view.status === "paused")) throw new Error(`Run ${id} vẫn đang chạy.`)
    if (!this.session) throw new Error("Chưa có phiên nào để tìm run.")
    const journal = new DeskJournal(this.session.dir, id)
    const meta = await journal.readMeta()
    if (!meta) throw new Error(`Không tìm thấy run ${id} trong phiên này.`)
    const playbook = this.require(meta.playbook)
    const cache = await journal.load()
    const handle = await this.launch(id, playbook, parseArgs(playbook, meta.args), { size: meta.size, effort: meta.effort }, cache, meta)
    if (meta.version !== playbook.meta.version) this.log(this.runs.get(id)!, `Playbook đã đổi phiên bản (${meta.version} → ${playbook.meta.version}): mọi agent chạy lại.`)
    return handle
  }

  stop(id: string) {
    const state = this.runs.get(id)
    if (!state || (state.view.status !== "running" && state.view.status !== "paused")) return false
    this.cut(state, "stop")
    state.controller.abort()
    state.paused?.release()
    return true
  }

  /** Stop every live run (/clear, /new, exit): each is cut as stopped, so no new agent starts. */
  stopAll() {
    let n = 0
    for (const state of this.runs.values()) if (this.stop(state.view.id)) n++
    return n
  }

  /** Paused: agents already running finish; no new one starts until resumed. */
  pause(id: string) {
    const state = this.runs.get(id)
    if (!state || state.view.status !== "running") return false
    let release!: () => void
    const promise = new Promise<void>((r) => (release = r))
    state.paused = { promise, release }
    state.view.status = "paused"
    this.emit(state)
    return true
  }

  unpause(id: string) {
    const state = this.runs.get(id)
    if (!state?.paused) return false
    const { release } = state.paused
    state.paused = undefined
    if (state.view.status === "paused") state.view.status = "running"
    release()
    this.emit(state)
    return true
  }

  async flush() {
    await Promise.all([...this.runs.values()].map((s) => s.journal?.flush()))
  }

  private require(name: string) {
    const playbook = this.playbook(name)
    if (!playbook) {
      const known = this.deps.playbooks().map((p) => p.meta.name)
      throw new Error(`Không có playbook "${name}".${known.length ? ` Có: ${known.join(", ")}.` : ""}`)
    }
    return playbook
  }

  private config() {
    return this.deps.config ? this.deps.config() : loadConfig()
  }

  private async launch(id: string, playbook: Playbook, args: unknown, opts: DeskStart, cache: Map<string, JournalEntry>, previous?: DeskMeta) {
    const settings = deskSettings(await this.config())
    const size = opts.size ?? settings.size
    const effort = opts.effort ?? settings.effort
    const view: DeskRunView = {
      id,
      playbook: playbook.meta.name,
      version: playbook.meta.version,
      args,
      size,
      effort,
      status: "running",
      phases: playbook.meta.phases.map((title) => ({ title, total: 0, done: 0, failed: 0 })),
      agents: [],
      logs: [],
      createdAt: previous ? Date.parse(previous.createdAt) || Date.now() : Date.now(),
      counters: { agents: 0, cached: 0, requests: 0, input: 0, output: 0 },
      sessionId: this.session?.id,
    }
    const state: RunState = {
      view,
      playbook,
      settings: { ...settings, effort },
      concurrency: settings.maxConcurrent,
      rateLimited: 0,
      controller: new AbortController(),
      limiter: new Limiter(() => state.concurrency),
      journal: this.session ? new DeskJournal(this.session.dir, id) : undefined,
      cache,
      occurrences: new Map(),
      phase: playbook.meta.phases[0] ?? "Chạy",
      stagger: new Map(),
      done: Promise.resolve(undefined as never),
    }
    this.runs.set(id, state)
    this.writeMeta(state)
    state.done = this.execute(state)
    this.emit(state)
    return { id, done: state.done }
  }

  private async execute(state: RunState): Promise<DeskRunView> {
    const { view } = state
    try {
      view.result = await state.playbook.run(this.context(state, state.playbook, 0))
      view.status = view.cut === "stop" ? "stopped" : view.cut ? "partial" : "done"
    } catch (error) {
      if (error instanceof DeskCut || view.cut) {
        view.status = view.cut === "stop" ? "stopped" : "partial"
      } else {
        view.status = "failed"
        view.error = describeError(error)
      }
    } finally {
      state.paused?.release()
      view.endedAt = Date.now()
    }
    this.writeMeta(state)
    this.emit(state)
    const final = snapshot(view)
    for (const listener of this.finished) listener(final)
    return final
  }

  private context(state: RunState, playbook: Playbook, depth: number): DeskContext {
    const prefix = depth > 0 ? `${playbook.meta.name} › ` : ""
    const ctx: DeskContext = {
      args: undefined,
      size: state.view.size,
      agent: (prompt, opts = {}) => this.agent(state, playbook, prompt, { ...opts, phase: opts.phase !== undefined ? prefix + opts.phase : undefined }),
      parallel: (thunks) => {
        if (thunks.length > MAX_ITEMS) throw new Error(`parallel() nhận tối đa ${MAX_ITEMS} việc, nhận ${thunks.length}.`)
        return Promise.all(thunks.map((thunk) => Promise.resolve().then(thunk).catch((error) => this.dropped(state, error))))
      },
      pipeline: (items, ...stages) => {
        if (items.length > MAX_ITEMS) throw new Error(`pipeline() nhận tối đa ${MAX_ITEMS} mục, nhận ${items.length}.`)
        return Promise.all(
          items.map((item, index) =>
            stages
              .reduce<Promise<unknown>>((prev, stage) => prev.then((value) => stage(value, item, index)), Promise.resolve(item))
              .catch((error) => this.dropped(state, error)),
          ),
        )
      },
      phase: (title) => {
        state.phase = prefix + title
        phaseOf(state.view, state.phase)
        this.emit(state)
      },
      log: (message) => this.log(state, message),
      budget: {
        maxAgents: state.settings.maxAgents,
        maxRequests: state.settings.maxRequests,
        agents: () => state.view.counters.agents,
        requests: () => state.view.counters.requests,
      },
      playbook: async (name, args) => {
        if (depth >= 1) throw new Error("Playbook chỉ lồng được một cấp.")
        const child = this.require(name)
        const childCtx = this.context(state, child, depth + 1)
        childCtx.args = parseArgs(child, args)
        const outer = state.phase
        try {
          return (await child.run(childCtx)) as never
        } finally {
          state.phase = outer
        }
      },
      stopping: () => !!state.view.cut,
    }
    ctx.args = depth === 0 ? state.view.args : undefined
    return ctx
  }

  private async agent(state: RunState, playbook: Playbook, prompt: string, opts: AgentOpts): Promise<never> {
    const { view, settings } = state
    if (view.cut) throw new DeskCut(view.cut)
    const type = opts.type ?? DEFAULT_DESK_TYPE
    if (!playbook.meta.agentTypes.includes(type)) throw new Error(`Playbook ${playbook.meta.name} không khai báo loại agent "${type}".`)
    const effort = opts.effort ?? settings.effort
    const model = opts.model ?? settings.model
    // The key holds what the playbook asked for, not the settings: a user who switches
    // desk.model after the quota ran out still gets the answered agents back on resume.
    const identity = { type, schema: schemaKey(opts.schema), effort: opts.effort, model: opts.model, maxSteps: opts.maxSteps }
    const hash = callHash(playbook.meta.version, prompt, identity)
    const occurrence = state.occurrences.get(hash) ?? 0
    state.occurrences.set(hash, occurrence + 1)
    const key = agentKey(hash, occurrence)
    const phase = opts.phase ?? state.phase
    const entry: DeskAgentView = {
      key,
      label: cleanLabel(opts.label ?? prompt.split("\n")[0] ?? prompt, 60),
      phase,
      type,
      status: "queued",
      requests: 0,
      tokens: { input: 0, output: 0 },
    }
    view.agents.push(entry)
    phaseOf(view, phase).total++

    const cached = state.cache.get(key)
    if (cached) {
      entry.status = "cached"
      entry.agentId = cached.agentId
      view.counters.cached++
      phaseOf(view, phase).done++
      this.emit(state)
      return cached.value as never
    }
    this.emit(state)

    let release: (() => void) | undefined
    const prefix = JSON.stringify([identity.type, identity.schema, identity.effort, identity.model])
    let leads = false
    try {
      if (state.paused) await state.paused.promise
      release = await state.limiter.acquire(state.controller.signal)
      // Caps are checked when the agent would actually start (cached ones cost nothing).
      if (view.cut) throw new DeskCut(view.cut)
      if (view.counters.agents >= settings.maxAgents) this.cut(state, "agents")
      else if (settings.maxRequests !== undefined && view.counters.requests >= settings.maxRequests) this.cut(state, "requests")
      if (view.cut) throw new DeskCut(view.cut)
      leads = await this.staggered(state, prefix)
      if (view.cut) throw new DeskCut(view.cut)

      const spec = typeSpec(this.deps.agents(), type)
      if (!spec) throw new Error(`Không có loại agent "${type}".`)
      const narrowed = spec.toolFilter
      view.counters.agents++
      entry.status = "running"
      const startSpec: StartSpec = {
        ...spec,
        type,
        description: entry.label,
        prompt,
        // Desk agents only read: a playbook can never widen what the user allowed (ADR 0005).
        toolFilter: (def) => def.readOnly && (!narrowed || narrowed(def)),
        ...(opts.schema ? { schema: opts.schema } : {}),
        ...(effort ? { effort } : {}),
        ...(model ? { model } : {}),
        ...(opts.maxSteps ? { maxSteps: opts.maxSteps } : {}),
        deskRunId: view.id,
        background: false,
        parentSignal: state.controller.signal,
      }
      const run = this.deps.starter.start(startSpec)
      entry.agentId = run.id
      if (leads) this.releaseOnAnswer(state, prefix, run.id)
      leads = false
      this.emit(state)
      let result = await run.done
      // A per-minute limit that outlasted the request retries: slow the whole run down to one
      // agent at a time and try this agent once more; a second one stops the run (resumable).
      if (result.failure === "rate-limit" && !view.cut) {
        state.rateLimited++
        if (state.rateLimited === 1) {
          state.concurrency = 1
          this.log(state, "Bị giới hạn tốc độ (429): chạy từng agent một và thử lại agent này.")
          this.addRequests(view, entry, result)
          const again = this.deps.starter.start(startSpec)
          entry.agentId = again.id
          this.emit(state)
          result = await again.done
        } else this.cut(state, "rate")
      }
      this.addRequests(view, entry, result)
      if (result.status === "completed") {
        const value = opts.schema ? result.data : result.text
        entry.status = "done"
        phaseOf(view, phase).done++
        state.journal?.append(
          { type: "result", key, label: entry.label, phase, value, requests: entry.requests, tokens: entry.tokens, agentId: run.id, ts: new Date().toISOString() },
          this.onPersistError,
        )
        return value as never
      }
      entry.error = result.error
      entry.failure = result.failure
      if (result.failure === "daily-quota") this.cut(state, "quota")
      if (result.status === "stopped" && view.cut) throw new DeskCut(view.cut)
      throw new Error(result.error ?? (result.status === "stopped" ? "Agent bị dừng." : "Agent lỗi."))
    } catch (error) {
      // A first agent that never started must not keep its siblings waiting.
      if (leads) state.stagger.get(prefix)?.release()
      // Not started because the run was cut (cap, quota, stop — the slot wait is aborted too).
      const cut = error instanceof DeskCut ? error.cut : entry.status === "queued" ? view.cut : undefined
      if (entry.status === "queued" || entry.status === "running") {
        if (cut) {
          entry.status = "skipped"
          entry.failure = cut === "stop" ? "stopped" : "cap"
        } else {
          entry.status = "failed"
          entry.error ??= describeError(error)
          phaseOf(view, phase).failed++
        }
      }
      if (cut) throw new DeskCut(cut)
      if (view.cut) throw new DeskCut(view.cut)
      throw error instanceof DeskAgentError || !(error instanceof Error) || entry.status !== "failed" ? error : new DeskAgentError(error.message)
    } finally {
      release?.()
      this.emit(state)
    }
  }

  /**
   * Siblings with the same prompt prefix wait (up to staggerMs) for the first one's response,
   * so their first requests read its cache (Claude Code: CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS).
   */
  private async staggered(state: RunState, prefix: string): Promise<boolean> {
    if (state.settings.staggerMs <= 0 || !this.deps.starter.onChange) return false
    const gate = state.stagger.get(prefix)
    if (!gate) {
      let release!: () => void
      const promise = new Promise<void>((r) => (release = r))
      state.stagger.set(prefix, { promise, release })
      return true
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([gate.promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, state.settings.staggerMs)))])
    clearTimeout(timer)
    return false
  }

  /** Opens the prefix's gate once its first agent has an answer (a request done, a tool, or the end). */
  private addRequests(view: DeskRunView, entry: DeskAgentView, result: SubagentResult) {
    entry.requests += result.requests ?? 0
    entry.tokens = { input: entry.tokens.input + result.usage.input, output: entry.tokens.output + result.usage.output }
    view.counters.requests += result.requests ?? 0
    view.counters.input += result.usage.input
    view.counters.output += result.usage.output
  }

  private releaseOnAnswer(state: RunState, prefix: string, agentId: string) {
    const gate = state.stagger.get(prefix)
    if (!gate || !this.deps.starter.onChange) return
    const stopListening = this.deps.starter.onChange((v) => {
      if (v.id !== agentId) return
      const answered = (v.requests ?? 0) > 0 || v.usage.input > 0 || v.tools.length > 0 || (v.status !== "queued" && v.status !== "running")
      if (!answered) return
      stopListening()
      gate.release()
    })
  }

  /** An item that became null: a bug in the playbook's own code is logged (agent failures are listed already). */
  private dropped(state: RunState, error: unknown): null {
    if (!(error instanceof DeskCut) && !(error instanceof DeskAgentError)) this.log(state, `Lỗi trong code playbook: ${describeError(error)}`)
    return null
  }

  private cut(state: RunState, cut: NonNullable<DeskRunView["cut"]>) {
    if (state.view.cut) return
    state.view.cut = cut
    this.log(state, CUT_TEXT[cut])
  }

  private log(state: RunState, message: string) {
    state.view.logs.push(cleanLabel(message, 200))
    if (state.view.logs.length > MAX_LOGS) state.view.logs.splice(0, state.view.logs.length - MAX_LOGS)
    this.emit(state)
  }

  private writeMeta(state: RunState) {
    const { view } = state
    state.journal?.writeMeta(
      {
        format: 1,
        id: view.id,
        playbook: view.playbook,
        version: view.version,
        args: view.args,
        size: view.size,
        effort: view.effort,
        status: view.status,
        cut: view.cut,
        createdAt: new Date(view.createdAt).toISOString(),
        updatedAt: new Date().toISOString(),
        counters: { ...view.counters },
        sessionId: view.sessionId,
      },
      this.onPersistError,
    )
  }

  private emit(state: RunState) {
    if (this.listeners.size === 0) return
    const view = snapshot(state.view)
    for (const listener of this.listeners) listener(view)
  }
}

/** JSON Schema of a result schema, for the key; transforms and dates must not throw here. */
function schemaKey(schema: z.ZodObject | undefined) {
  return schema ? z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) : undefined
}

function parseArgs(playbook: Playbook, args: unknown) {
  const parsed = playbook.meta.args.safeParse(args)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`).join("; ")
    throw new Error(`Tham số của playbook ${playbook.meta.name} không hợp lệ: ${issues}`)
  }
  return parsed.data
}

function phaseOf(view: DeskRunView, title: string) {
  let phase = view.phases.find((p) => p.title === title)
  if (!phase) view.phases.push((phase = { title, total: 0, done: 0, failed: 0 }))
  return phase
}

function snapshot(view: DeskRunView): DeskRunView {
  return {
    ...view,
    phases: view.phases.map((p) => ({ ...p })),
    agents: view.agents.map((a) => ({ ...a, tokens: { ...a.tokens } })),
    logs: [...view.logs],
    counters: { ...view.counters },
  }
}
