import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ModelMessage } from "ai"
import { z } from "zod"
import { runAgent } from "../../src/core/agent"
import type { Target } from "../../src/core/chat"
import { promptVersion } from "../../src/core/prompt/assemble"
import { onModelRequest } from "../../src/core/requests"
import type { Runtime } from "../../src/core/runtime"
import type { Skill } from "../../src/core/skills/schema"
import { currentTimeTool } from "../../src/core/tools/builtin/current-time"
import { clearResults, useResultSession } from "../../src/core/tools/refs"
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

/** A run's own home: same model and connections as `from`, none of the user's other state. */
export async function prepareHome(from: string, to: string, target: { provider: string; model: string }) {
  await mkdir(path.join(to, "cache"), { recursive: true })
  for (const file of HOME_FILES) await copyFile(path.join(from, file), path.join(to, file)).catch(() => {})
  await writeFile(path.join(to, "config.json"), JSON.stringify(target))
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
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000

/** Every question, one fresh conversation each. Nothing a question does reaches the next. */
export async function runEval(run: EvalRun) {
  const { runtime, write, ledger } = run
  const { registry } = runtime
  const web = WEB_TOOLS.flatMap((name) => registry.get(name) ?? [])
  const stopAnswering = answerUnattended(runtime.permissions, "eval")
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
    tools: registry.list().length,
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
        await ask(run, question, asked, now, meter)
        await ledger?.flush()
      }
    }
  } finally {
    stopMeter()
    stopAnswering()
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
  const result = { text: "", streamed: "", steps: 0, input: 0, output: 0, outcome: "failed", unanswered: false, recoveries: [] as { kind: string; attempt: number }[], gaps: [] as string[] }
  const say = (event: TraceEvent) => write(event)
  const timeout = AbortSignal.timeout(run.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    for await (const event of runAgent({
      history: [],
      input: question.question,
      skills: run.skills,
      registry: runtime.registry,
      serverInstructions: () => runtime.mcp.instructions(),
      target: run.target,
      now,
      signal: AbortSignal.any([timeout, meter.capped.signal]),
    })) {
      if (event.type === "text-delta") result.streamed += event.text
      else if (event.type === "tool-start") say({ type: "tool_call", ...asked, call_id: event.callId, tool: event.name, input: event.input, step: event.step })
      else if (event.type === "tool-end") say({ type: "tool_result", ...asked, call_id: event.callId, ok: event.ok, visible: event.output, duration_ms: event.durationMs })
      else if (event.type === "retry") say({ type: "retry", ...asked, attempt: event.attempt, delay_ms: event.delayMs, label: event.label })
      else if (event.type === "notice") say({ type: "notice", ...asked, text: event.text })
      else if (event.type === "error") say({ type: "error", ...asked, message: event.message, ...(event.kind ? { kind: event.kind } : {}) })
      else if (event.type === "step") result.steps++
      else if (event.type === "step-usage") {
        result.input += event.inputTokens
        result.output += event.outputTokens
      } else if (event.type === "done") {
        result.text = finalText(event.messages)
        result.outcome = event.outcome ?? "completed"
        result.unanswered = event.unanswered ?? false
        result.recoveries = event.recoveries ?? []
        result.gaps = event.dataGaps ?? []
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
    model_steps: result.steps,
    requests: meter.requests,
    input_tokens: result.input,
    output_tokens: result.output,
    duration_ms: Date.now() - started,
  })
}
