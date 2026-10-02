import { stepCountIs, streamText, type ModelMessage, type StreamTextResult, type SystemModelMessage, type ToolSet } from "ai"
import { ChatSetupError, describeError, resolveTarget } from "./chat"
import type { AgentEvent } from "./events"
import { loadProfile } from "./profile"
import { assemble, type Assembled } from "./prompt/assemble"
import { tierOf, type Tier } from "./prompt/budget"
import type { ClockSnapshot } from "./prompt/market-clock"
import { languageModel } from "./providers"
import type { Skill } from "./skills/schema"
import type { HookBus } from "./hooks"
import { MEMORY_INDEX_MAX_CHARS, MEMORY_RECALL_MAX_CHARS, MEMORY_RECALL_MAX_ITEMS, type MemoryProvider } from "./memory/types"
import type { ToolRegistry } from "./tools/registry"

export const DEFAULT_MAX_STEPS = 10

const SUMMARY_PROMPT =
  "Đã hết số lượt gọi tool cho câu hỏi này. Không gọi thêm tool. Hãy tổng kết câu trả lời dựa trên dữ liệu đã có, nói rõ phần nào còn thiếu."

/**
 * Some models (seen with gemini-2.5-flash-lite) end a turn with an empty answer right
 * after a tool result: finish reason STOP, zero output tokens. The request is well formed —
 * it is a model quirk — so we ask once more, with tools still declared but disabled.
 */
const NUDGE_PROMPT = "Hãy trả lời câu hỏi của người dùng dựa trên kết quả tool ở trên. Không gọi thêm tool."

/** Reminders ride on the user message inside this tag; UIs hide it, history keeps it. */
export const REMINDER_TAG = "nhac_nho"

export interface RunOptions {
  history: ModelMessage[]
  input: string
  /** Every loaded skill (catalog + always-on). */
  skills: Skill[]
  /** Skills the user switched on with /skill <name>. */
  sticky?: string[]
  registry: ToolRegistry
  /** Market-clock snapshot last sent in this conversation; undefined = send it. */
  prevClock?: ClockSnapshot
  now?: Date
  signal?: AbortSignal
  maxSteps?: number
  sessionId?: string
  hooks?: HookBus
  memory?: MemoryProvider
}

export function label(registry: ToolRegistry, name: string, input: unknown) {
  const def = registry.get(name)
  if (def?.summarize) {
    try {
      return def.summarize(input)
    } catch {
      // fall through to the generic label
    }
  }
  const args = JSON.stringify(input ?? {})
  return `${name}(${args === "{}" ? "" : args.length > 60 ? args.slice(0, 57) + "…" : args})`
}

function stringify(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Assistant messages with no content at all (the empty answer itself) are dropped from history. */
function isEmptyAssistant(message: ModelMessage) {
  if (message.role !== "assistant") return false
  if (typeof message.content === "string") return message.content.trim() === ""
  return message.content.every((part) => part.type === "text" && part.text.trim() === "")
}

/**
 * Put the per-request user context in front of the first user message instead of adding a
 * separate one: two user messages in a row are rejected or mishandled by some providers.
 */
export function withContext(messages: ModelMessage[], context: string | undefined): ModelMessage[] {
  if (!context) return messages
  const index = messages.findIndex((m) => m.role === "user")
  if (index < 0) return messages
  const first = messages[index] as Extract<ModelMessage, { role: "user" }>
  const parts = typeof first.content === "string" ? [{ type: "text" as const, text: first.content }] : first.content
  const copy = [...messages]
  copy[index] = { ...first, content: [{ type: "text", text: context }, ...parts] }
  return copy
}

/** The user message as stored in history: optional reminder block, then what the user typed. */
function userMessage(input: string, reminders: string[]): ModelMessage {
  if (reminders.length === 0) return { role: "user", content: input }
  return {
    role: "user",
    content: [
      { type: "text", text: `<${REMINDER_TAG}>\n${reminders.join("\n\n")}\n</${REMINDER_TAG}>` },
      { type: "text", text: input },
    ],
  }
}

/** Visible text of a user message, without reminder blocks (for UIs rebuilding transcripts). */
export function visibleUserText(message: ModelMessage) {
  if (message.role !== "user") return ""
  if (typeof message.content === "string") return message.content
  return message.content
    .filter((p) => p.type === "text" && !p.text.startsWith(`<${REMINDER_TAG}>`))
    .map((p) => (p as { text: string }).text)
    .join("\n")
}

interface Outcome {
  text: string
  aborted: boolean
  failure?: unknown
}

/** Relay one streamText run as AgentEvents and report what happened. */
async function* relay(
  result: StreamTextResult<ToolSet, never>,
  registry: ToolRegistry,
  signal: AbortSignal | undefined,
  outcome: Outcome,
): AsyncGenerator<AgentEvent> {
  const started = new Map<string, number>()
  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          outcome.text += part.text
          yield { type: "text-delta", text: part.text }
          break
        case "tool-call":
          started.set(part.toolCallId, Date.now())
          yield {
            type: "tool-start",
            callId: part.toolCallId,
            name: part.toolName,
            label: label(registry, part.toolName, part.input),
            input: part.input,
          }
          break
        case "tool-result":
        case "tool-error": {
          const ok = part.type === "tool-result"
          yield {
            type: "tool-end",
            callId: part.toolCallId,
            ok,
            output: ok ? stringify(part.output) : describeError(part.error),
            durationMs: Date.now() - (started.get(part.toolCallId) ?? Date.now()),
          }
          break
        }
        case "abort":
          outcome.aborted = true
          break
        case "error":
          outcome.failure = part.error
          break
      }
    }
  } catch (error) {
    if (signal?.aborted) outcome.aborted = true
    else outcome.failure = error
  }
  if (signal?.aborted) outcome.aborted = true
}

interface Prepared {
  target: Awaited<ReturnType<typeof resolveTarget>>
  tier: Tier
  tools: ToolSet | undefined
  assembled: Assembled
  supportsTools: boolean
}

type TurnInput = Omit<RunOptions, "history" | "signal" | "maxSteps">
type Target = Awaited<ReturnType<typeof resolveTarget>>

/** Per-turn extras gathered before assembly (recall and hooks run only for real turns). */
interface TurnExtras {
  recalled?: string
  hookContext?: string[]
}

const cap = (text: string | undefined, max: number) =>
  text && text.length > max ? text.slice(0, max) + "\n[… đã cắt bớt]" : text

async function assembleFor(opts: TurnInput, target: Target | undefined, extras: TurnExtras = {}) {
  const info = target?.provider.models[target.model]
  const supportsTools = info?.tool_call !== false
  const tier = tierOf(info?.limit?.context)
  const toolNames = supportsTools ? opts.registry.list().map((t) => t.name) : []
  const assembled = assemble({
    tier,
    tools: toolNames,
    skills: opts.skills,
    sticky: opts.sticky ?? [],
    investorProfile: await loadProfile(),
    memoryInstructions: opts.memory?.instructions?.(),
    memoryIndex: cap(await opts.memory?.index?.({ sessionId: opts.sessionId ?? "" }).catch(() => undefined), MEMORY_INDEX_MAX_CHARS),
    recalled: extras.recalled,
    hookContext: extras.hookContext,
    input: opts.input,
    now: opts.now ?? new Date(),
    prevClock: opts.prevClock,
  })
  return { tier, supportsTools, toolNames, assembled }
}

async function prepare(opts: TurnInput, extras: TurnExtras): Promise<Prepared> {
  const target = await resolveTarget()
  const { tier, supportsTools, toolNames, assembled } = await assembleFor(opts, target, extras)
  return { target, tier, supportsTools, tools: toolNames.length > 0 ? opts.registry.toToolSet() : undefined, assembled }
}

/**
 * What the next turn would send, per layer — for /context. Works without a configured model
 * (assumes tier B), so prompt writers can check their layers before connecting a provider.
 */
export async function previewContext(opts: TurnInput) {
  let target: Target | undefined
  try {
    target = await resolveTarget()
  } catch (error) {
    if (!(error instanceof ChatSetupError)) throw error
  }
  const { assembled, tier } = await assembleFor(opts, target)
  return {
    report: assembled.report,
    tier,
    model: target ? `${target.provider.name} · ${target.model}` : "chưa chọn model (giả định hạng B)",
  }
}

/**
 * One user turn: stream the model, run whatever tools it calls, feed results back, repeat
 * until it stops calling tools or hits `maxSteps` (the last step is forced to answer).
 *
 * Setup problems (no provider/model/key) throw before anything is yielded. Everything after
 * that — provider errors, aborts, tool failures, empty answers — is reported as events,
 * always ending in `done` with history that is safe to send back next turn.
 */
export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent> {
  const sessionId = opts.sessionId ?? ""
  // Fail fast on setup problems before any hook side effects run.
  await resolveTarget()

  // user-prompt hooks: may block the turn or add context for it.
  const extras: TurnExtras = {}
  if (opts.hooks) {
    const hooked = await opts.hooks.emit({ type: "user-prompt", sessionId, prompt: opts.input })
    for (const error of hooked.errors) yield { type: "notice", text: error }
    if (hooked.block) {
      yield { type: "notice", text: `Lượt này bị chặn: ${hooked.block}` }
      yield { type: "done", messages: [] }
      return
    }
    extras.hookContext = hooked.context
  }
  // Memory relevant to this message (active items only; the provider filters pending ones).
  const recalled = (await opts.memory?.recall?.(opts.input, { sessionId }).catch(() => []))?.slice(0, MEMORY_RECALL_MAX_ITEMS) ?? []
  if (recalled.length > 0) {
    extras.recalled = cap(recalled.map((m) => `- ${m.text}`).join("\n"), MEMORY_RECALL_MAX_CHARS)
    // Never invisible (the lesson from Cursor's memories): say what was used.
    yield { type: "notice", text: `Dùng ${recalled.length} memory: ${recalled.map((m) => m.text.slice(0, 40)).join("; ")}` }
  }

  const { target, tools, assembled, supportsTools } = await prepare(opts, extras)
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  if (!supportsTools && opts.registry.list().length > 0) {
    yield { type: "notice", text: "Model này không hỗ trợ tool; trả lời không dùng tool." }
  }

  const user = userMessage(opts.input, assembled.reminders)
  const request = withContext([...opts.history, user], assembled.context)
  // Anthropic caches only where asked: mark the static system prompt. Others cache by prefix.
  const system: string | SystemModelMessage =
    target.provider.npm === "@ai-sdk/anthropic"
      ? { role: "system", content: assembled.system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
      : assembled.system

  const model = languageModel(target.provider, target.model, target.apiKey)
  let summarized = false
  const result = streamText({
    model,
    system,
    messages: request,
    tools,
    stopWhen: stepCountIs(maxSteps),
    // Last allowed step: keep tools declared (some providers reject tool history otherwise)
    // but forbid calling them, so the turn always ends with an answer.
    prepareStep: ({ stepNumber, messages }) => {
      if (!tools || stepNumber < maxSteps - 1) return undefined
      summarized = true
      return { toolChoice: "none", messages: [...messages, { role: "user", content: SUMMARY_PROMPT }] }
    },
    abortSignal: opts.signal,
    maxRetries: 1,
    onError: () => {}, // errors are read from the stream
  })

  const outcome: Outcome = { text: "", aborted: false }
  yield* relay(result, opts.registry, opts.signal, outcome)

  let messages: ModelMessage[] | undefined
  if (!outcome.aborted && !outcome.failure) {
    try {
      messages = (await result.response).messages
    } catch (error) {
      outcome.failure = error
    }
  }

  // Completed, but the model said nothing: ask once more for the actual answer.
  if (messages && !outcome.text.trim()) {
    const usedTools = messages.some((m) => m.role === "tool")
    const kept = messages.filter((m) => !isEmptyAssistant(m))
    const retry = streamText({
      model,
      system,
      // The nudge is only for this request; it is not kept in history.
      messages: [...request, ...kept, { role: "user", content: NUDGE_PROMPT }],
      tools,
      toolChoice: tools ? "none" : undefined,
      abortSignal: opts.signal,
      maxRetries: 1,
      onError: () => {},
    })
    const second: Outcome = { text: "", aborted: false }
    yield* relay(retry, opts.registry, opts.signal, second)
    outcome.aborted = second.aborted
    outcome.failure = second.failure
    outcome.text = second.text
    if (!second.aborted && !second.failure) {
      if (second.text.trim()) messages = [...kept, { role: "assistant", content: second.text }]
      else {
        yield {
          type: "notice",
          text: usedTools
            ? "Model không trả lời sau khi gọi tool (câu trả lời rỗng). Kết quả tool ở phía trên; thử hỏi lại hoặc đổi model."
            : "Model trả về câu trả lời rỗng. Thử hỏi lại hoặc đổi model.",
        }
        messages = [...kept, { role: "assistant", content: "[Không có câu trả lời]" }]
      }
    }
  }

  if (messages && !outcome.aborted && !outcome.failure) {
    if (summarized) yield { type: "notice", text: `Đã dùng hết ${maxSteps} bước gọi tool; câu trả lời là bản tổng kết.` }
    yield { type: "done", messages: [user, ...messages], clock: assembled.clock }
    if (opts.hooks) void opts.hooks.emit({ type: "turn-end", sessionId, messages: [user, ...messages] })
    return
  }

  if (outcome.failure && !outcome.aborted) yield { type: "error", message: describeError(outcome.failure) }
  // Aborted or failed mid-turn: keep only plain text, so history never holds a tool call
  // without its result (providers reject that on the next request). The user message keeps
  // its reminders, so the clock it carried still counts as sent.
  const text = outcome.text
  yield {
    type: "done",
    messages: [user, { role: "assistant", content: text || (outcome.aborted ? "[Đã dừng]" : "[Lỗi]") }],
    clock: assembled.clock,
  }
}
