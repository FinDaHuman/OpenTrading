import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ModelMessage } from "ai"
import { z } from "zod"
import { ABLATIONS, type Ablation, type Ablations } from "../../src/core/ablation"
import { runAgent } from "../../src/core/agent"
import type { Target } from "../../src/core/chat"
import { cleanRouting, type OpenRouterRouting } from "../../src/core/openrouter-routing"
import { promptVersion } from "../../src/core/prompt/assemble"
import { onModelRequest } from "../../src/core/requests"
import { closeMemory, createMemory, switchMemory, type MemoryChoice, type Runtime } from "../../src/core/runtime"
import type { Skill } from "../../src/core/skills/schema"
import { currentTimeTool } from "../../src/core/tools/builtin/current-time"
import { clearResults, useResultSession } from "../../src/core/tools/refs"
import { TODO_WRITE } from "../../src/core/tools/todos"
import type { ToolDef, ToolResult } from "../../src/core/tools/types"
import type { ToolRegistry } from "../../src/core/tools/registry"
import { answerUnattended } from "./approvals"
import type { RequestLedger } from "./ledger"
import { TRACE_VERSION, type TraceEvent, type TraceWriter } from "./trace"

const QUESTIONS = z
  .array(
    z.object({
      id: z.string().min(1),
      /** OT-VNBench group, A–F (thesis plan). */
      group: z.enum(["A", "B", "C", "D", "E", "F"]),
      question: z.string().min(1),
      /** The moment the question is asked at: the prompt's date and `current_time` use it. */
      now: z.iso.datetime({ offset: true }),
    }),
  )
  .min(1)
  .refine((list) => new Set(list.map((q) => q.id)).size === list.length, "id trùng nhau")

export type EvalQuestion = z.infer<typeof QUESTIONS>[number]

export const parseQuestions = (text: string): EvalQuestion[] => QUESTIONS.parse(JSON.parse(text))

/** Replay has no web results, so only long reports may search; others answer from MCP data. */
const WEB_GROUPS = new Set(["F"])
const WEB_TOOLS = ["web_fetch", "web_search"]

/** Copied so MCP and side calls work; everything else (profile, memory, skills) stays out. */
const HOME_FILES = ["auth.json", "mcp.json", "mcp-auth.json", path.join("cache", "models.json")]

/** Parts a run can go without that are set up rather than switched in the loop. */
const SETUP_ABLATIONS = ["todo", "tool-deferral", "skills"] as const
type SetupAblation = (typeof SETUP_ABLATIONS)[number]

export interface Ablated {
  loop: Ablations
  setup: ReadonlySet<SetupAblation>
}

/** `--ablate` values, or an error naming what is on offer: a typo must not run as the full harness. */
export function parseAblations(list: string[]): Ablated {
  const known = new Set<string>([...ABLATIONS, ...SETUP_ABLATIONS])
  const wrong = list.filter((name) => !known.has(name))
  if (wrong.length > 0) throw new Error(`--ablate không biết: ${wrong.join(", ")}. Có: ${[...known].join(", ")}.`)
  return {
    loop: new Set(list.filter((name): name is Ablation => (ABLATIONS as readonly string[]).includes(name))),
    setup: new Set(list.filter((name): name is SetupAblation => (SETUP_ABLATIONS as readonly string[]).includes(name))),
  }
}

/**
 * The skills of an ablated run. It has to go through the runtime too: subagents read skills
 * from it, so taking them from the main agent alone would leave the catalog in every child.
 */
export const skillsFor = (skills: Skill[], ablated?: Ablated) => (ablated?.setup.has("skills") ? [] : skills)

/** A run's own home: same model and connections as `from`, none of the user's other state. */
export async function prepareHome(from: string, to: string, target: { provider: string; model: string }, ablated?: Ablated, routing?: OpenRouterRouting) {
  await mkdir(path.join(to, "cache"), { recursive: true })
  for (const file of HOME_FILES) await copyFile(path.join(from, file), path.join(to, file)).catch(() => {})
  // The pin comes from this run's flags only, never from the user's config: a run states it.
  const pin = routing ? { openrouter: { routing: { [target.model]: routing } } } : {}
  await writeFile(path.join(to, "config.json"), JSON.stringify({ ...target, ...(ablated?.setup.has("tool-deferral") ? { toolSearch: "off" } : {}), ...pin }))
}

/** Finished model steps per upstream provider over a trace's answers (OpenRouter's `served_by`). */
export function servedSummary(events: TraceEvent[]): Record<string, number> {
  const total: Record<string, number> = {}
  for (const event of events) {
    if (event.type !== "answer" || !event.served_by) continue
    for (const [by, n] of Object.entries(event.served_by)) total[by] = (total[by] ?? 0) + n
  }
  return total
}

/**
 * The OpenRouter pin of an eval run, from its flags (one key each): `--or-provider a,b` → order,
 * `--or-no-fallback` → allow_fallbacks false, `--or-quant fp8` → quantizations. Undefined with
 * none of them; an error when they are given for another provider. `warnings`: why the run can
 * still mix providers.
 */
export function routingFromFlags(provider: string, flags: { orProvider?: string; noFallback?: boolean; quant?: string }): { routing?: OpenRouterRouting; error?: string; warnings: string[] } {
  const list = (value?: string) => value?.split(",").map((s) => s.trim()).filter(Boolean)
  const order = list(flags.orProvider)
  const quantizations = list(flags.quant)
  const any = flags.orProvider !== undefined || flags.noFallback || flags.quant !== undefined
  if (provider !== "openrouter") return any ? { error: `--or-provider/--or-no-fallback/--or-quant chỉ dùng với model openrouter/… (đang là ${provider}).`, warnings: [] } : { warnings: [] }
  const routing = cleanRouting({ order, quantizations, ...(flags.noFallback ? { allow_fallbacks: false } : {}) })
  const warnings: string[] = []
  if (!routing.order) warnings.push("Provider OpenRouter không cố định (thiếu --or-provider): kết quả có thể lẫn provider.")
  else if (routing.allow_fallbacks !== false) warnings.push("Vẫn cho fallback (thiếu --or-no-fallback): kết quả vẫn có thể lẫn provider.")
  return { ...(Object.keys(routing).length > 0 ? { routing } : {}), warnings }
}

interface Asked {
  q: string
  rep: number
}

interface Observed {
  callId: string
  tool: string
  input: unknown
  ok: boolean
  raw: string
  agent?: string
}

/**
 * Report what each tool returned before the output cap. Definitions are changed in place, so
 * the registries subagents build from them report too; calling this again is safe. `asked` is
 * read when a call starts: a call that outlives its question stays with that question.
 */
export function observeTools(registry: ToolRegistry, seen: WeakSet<ToolDef>, asked: () => Asked, report: (asked: Asked, call: Observed) => void) {
  for (const def of registry.list()) {
    if (seen.has(def)) continue
    seen.add(def)
    const execute = def.execute.bind(def)
    def.execute = async (input, ctx) => {
      const tag = asked()
      const base = { callId: ctx.callId, tool: def.name, input, ...(ctx.agent ? { agent: ctx.agent.type } : {}) }
      try {
        const result: string | ToolResult = await execute(input, ctx)
        report(tag, { ...base, ok: true, raw: typeof result === "string" ? result : result.output })
        return result
      } catch (error) {
        report(tag, { ...base, ok: false, raw: error instanceof Error ? error.message : String(error) })
        throw error
      }
    }
  }
}

export interface EvalRun {
  runtime: Runtime
  skills: Skill[]
  target: Target
  questions: EvalQuestion[]
  repeat?: number
  /** Limit per question; a question past it ends as aborted and the run goes on. */
  timeoutMs?: number
  write: TraceWriter
  version: string
  commit?: string
  /** What must stay fixed between runs to compare them (effort, tool search, step limit). */
  settings?: Record<string, unknown>
  /** Stops the run at its cap. Reaching it mid-question aborts that question. */
  ledger?: RequestLedger
  ablated?: Ablated
  /** --yolo: ▸▸▸ bypass instead of the narrow unattended list (approvals.ts). */
  yolo?: boolean
  /**
   * --memory: "notebook" gives every question its own empty notebook in the run's home (the guide
   * and memory_read reach the prompt, nothing carries over); "none" (the product default) has none.
   */
  memory?: MemoryChoice
}

/** A fresh empty notebook for the next question: the last one is closed (Windows locks it) and its files removed. */
async function freshMemory(runtime: Runtime, choice: MemoryChoice) {
  closeMemory(runtime)
  if (choice === "notebook") for (const suffix of ["", "-wal", "-shm"]) await rm(path.join(runtime.home, `memory.db${suffix}`), { force: true })
  switchMemory(runtime, createMemory(choice, runtime.home))
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000

/** Every question, one fresh conversation each. Nothing a question does reaches the next. */
export async function runEval(run: EvalRun) {
  const { runtime, write, ledger } = run
  const { registry } = runtime
  const web = WEB_TOOLS.flatMap((name) => registry.get(name) ?? [])
  // Bypass needs nobody to answer: what it still keeps for the user is refused (not interactive).
  if (run.yolo) {
    runtime.permissions.bypassAvailable = true
    runtime.permissions.setMode("bypass")
  }
  const stopAnswering = run.yolo ? () => {} : answerUnattended(runtime.permissions, "eval")
  runtime.subagents.disabled = run.ablated?.loop
  if (run.ablated?.setup.has("todo")) registry.unregister(TODO_WRITE)
  if (run.ablated?.setup.has("skills")) registry.unregister("load_skill")
  write({
    type: "run",
    trace_version: TRACE_VERSION,
    harness: "opentrading",
    harness_version: run.version,
    ...(run.commit ? { commit: run.commit } : {}),
    prompt_version: promptVersion(),
    provider: run.target.provider.id,
    model: run.target.model,
    started_at: new Date().toISOString(),
    memory: run.memory ?? "none",
    tools: registry.list().length,
    // Bypass declares the write tools in full (~850 tokens a turn): the prompt differs, not only approvals.
    permission_mode: runtime.permissions.mode,
    ...(run.settings ? { settings: run.settings } : {}),
  })
  const seen = new WeakSet<ToolDef>()
  let asked: Asked = { q: "", rep: 0 }
  const meter = { requests: 0, capped: new AbortController() }
  const stopMeter = onModelRequest((request) => {
    meter.requests++
    ledger?.note(`${request.provider}/${request.model}`)
    if (ledger?.exhausted) meter.capped.abort()
  })
  try {
    for (let rep = 1; rep <= (run.repeat ?? 1); rep++) {
      for (const question of run.questions) {
        if (ledger?.exhausted) {
          write({ type: "stopped", reason: "request-cap", spent: ledger.spent, cap: ledger.cap })
          return
        }
        const now = new Date(question.now)
        registry.register(currentTimeTool(() => now))
        for (const def of web) {
          if (WEB_GROUPS.has(question.group)) registry.register(def)
          // By prefix: also drops any later tool named web_fetch_…, which replay would not cover.
          else registry.unregister(def.name)
        }
        asked = { q: question.id, rep }
        observeTools(
          registry,
          seen,
          () => asked,
          (tag, { callId, ...call }) => write({ type: "tool_raw", ...tag, call_id: callId, ...call }),
        )
        meter.requests = 0
        await freshMemory(runtime, run.memory ?? "none")
        await ask(run, question, asked, now, meter)
        await ledger?.flush()
      }
    }
  } finally {
    stopMeter()
    stopAnswering()
    closeMemory(runtime)
    if (run.yolo) {
      runtime.permissions.setMode("read-only")
      runtime.permissions.bypassAvailable = false
    }
  }
}

/** The answer the turn kept: a draft the stop gate sent back is streamed but not in it. */
function finalText(messages: ModelMessage[]) {
  const content = messages.findLast((m) => m.role === "assistant")?.content
  if (typeof content === "string") return content
  return (content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
}

async function ask(run: EvalRun, question: EvalQuestion, asked: Asked, now: Date, meter: { requests: number; capped: AbortController }) {
  const { runtime, write } = run
  clearResults()
  useResultSession(`${asked.q}#${asked.rep}`)
  runtime.subagents.clock = () => now
  write({ type: "question", ...asked, group: question.group, question: question.question, now: question.now })
  const before = new Set(runtime.subagents.list().map((v) => v.id))
  const started = Date.now()
  const result = { text: "", streamed: "", steps: 0, input: 0, output: 0, outcome: "failed", unanswered: false, recoveries: [] as { kind: string; attempt: number }[], gaps: [] as string[], ungrounded: [] as string[] }
  const served: Record<string, number> = {}
  const serve = (by: string, n = 1) => (served[by] = (served[by] ?? 0) + n)
  const say = (event: TraceEvent) => write(event)
  const timeout = AbortSignal.timeout(run.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    for await (const event of runAgent({
      history: [],
      input: question.question,
      skills: skillsFor(run.skills, run.ablated),
      registry: runtime.registry,
      memory: runtime.memory,
      constraints: runtime.constraints,
      redaction: runtime.redaction,
      serverInstructions: () => runtime.mcp.instructions(),
      target: run.target,
      now,
      disabled: run.ablated?.loop,
      signal: AbortSignal.any([timeout, meter.capped.signal]),
    })) {
      if (event.type === "text-delta") result.streamed += event.text
      else if (event.type === "tool-start") say({ type: "tool_call", ...asked, call_id: event.callId, tool: event.name, input: event.input, step: event.step })
      else if (event.type === "tool-end") say({ type: "tool_result", ...asked, call_id: event.callId, ok: event.ok, visible: event.output, duration_ms: event.durationMs })
      else if (event.type === "retry") say({ type: "retry", ...asked, attempt: event.attempt, delay_ms: event.delayMs, label: event.label })
      else if (event.type === "notice") say({ type: "notice", ...asked, text: event.text })
      else if (event.type === "error") say({ type: "error", ...asked, message: event.message, ...(event.kind ? { kind: event.kind } : {}) })
      else if (event.type === "step") {
        result.steps++
        if (event.servedBy) serve(event.servedBy)
      }
      else if (event.type === "step-usage") {
        result.input += event.inputTokens
        result.output += event.outputTokens
      } else if (event.type === "done") {
        result.text = finalText(event.messages)
        result.outcome = event.outcome ?? "completed"
        result.unanswered = event.unanswered ?? false
        result.recoveries = event.recoveries ?? []
        result.gaps = event.dataGaps ?? []
        result.ungrounded = event.ungrounded ?? []
      }
    }
  } catch (error) {
    say({ type: "error", ...asked, message: error instanceof Error ? error.message : String(error) })
  }
  // A background subagent must not write into the next question's trace.
  runtime.subagents.stopAll()
  await runtime.subagents.flush()
  for (const view of runtime.subagents.list()) {
    if (before.has(view.id)) continue
    result.steps += view.requests ?? 0
    result.input += view.usage.input
    result.output += view.usage.output
    for (const [by, n] of Object.entries(view.servedBy ?? {})) serve(by, n)
  }
  write({
    type: "answer",
    ...asked,
    text: result.text.trim(),
    streamed: result.streamed.trim(),
    outcome: result.outcome,
    ...(meter.capped.signal.aborted ? { abort: "cap" as const } : timeout.aborted ? { abort: "timeout" as const } : {}),
    unanswered: result.unanswered,
    recoveries: result.recoveries,
    data_gaps: result.gaps,
    ungrounded: result.ungrounded,
    model_steps: result.steps,
    ...(Object.keys(served).length > 0 ? { served_by: served } : {}),
    requests: meter.requests,
    input_tokens: result.input,
    output_tokens: result.output,
    duration_ms: Date.now() - started,
  })
}
