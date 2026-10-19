import {
  generateText,
  NoSuchToolError,
  isStepCount,
  streamText,
  type JSONValue,
  type LanguageModelUsage,
  type ModelMessage,
  type StreamTextResult,
  type SystemModelMessage,
  type ToolSet,
  wrapLanguageModel,
} from "ai"
import { ChatSetupError, describeError, resolveTarget, type Target } from "./chat"
import type { AgentEvent } from "./events"
import { loadProfile } from "./profile"
import { assemble, type Assembled } from "./prompt/assemble"
import { estimateTokens, tierOf, type Tier } from "./prompt/budget"
import type { ClockSnapshot } from "./prompt/market-clock"
import { languageModel } from "./providers"
import type { Skill } from "./skills/schema"
import type { HookBus } from "./hooks"
import { MEMORY_INDEX_MAX_CHARS, MEMORY_RECALL_MAX_CHARS, MEMORY_RECALL_MAX_ITEMS, type MemoryProvider } from "./memory/types"
import { loadConfig, type Config } from "./config"
import { closeDanglingToolCalls } from "./session/store"
import { sanitize, serverPrefix } from "./mcp/naming"
import type { SchemaFlavor } from "./mcp/schema"
import { isContextOverflow } from "./compact"
import { retryMiddleware, type RetryNotice, type RetryOptions } from "./retry"
import { loadedTools } from "./tools/loaded"
import { modeNote } from "./permission/mode"
import { NOTE as NOTICE_NOTE } from "./subagents/notification"
import { currentTodos, todoMark } from "./tools/todos"
import { MAX_TOOLS_PER_REQUEST, stripImages, type BuiltToolSet, type ToolRegistry, type ToolSetOptions } from "./tools/registry"
import { describeTool, LOADED_PREFIX, resolveToolName } from "./tools/search"
import { cleanToolErrors, toolErrorText } from "./tools/errors"
import { TOOL_SEARCH } from "./tools/builtin/tool-search"
import { LOCAL_SOURCE, type ToolResult } from "./tools/types"
import type { ChartData } from "./tools/chart/data"

/** Unlimited: the turn ends when the model stops calling tools. A cap is opt-in via
 *  config `maxSteps` or the caller's `opts.maxSteps`; when capped, the last step forces a summary. */
export const DEFAULT_MAX_STEPS = Number.POSITIVE_INFINITY

const SUMMARY_PROMPT =
  "Đã hết số lượt gọi tool cho câu hỏi này. Không gọi thêm tool. Hãy tổng kết câu trả lời dựa trên dữ liệu đã có, nói rõ phần nào còn thiếu."

/**
 * Some models (seen with gemini-2.5-flash-lite) end a turn with an empty answer right
 * after a tool result: finish reason STOP, zero output tokens. The request is well formed —
 * it is a model quirk — so we ask once more, with tools still declared but disabled.
 */
const NUDGE_PROMPT = "Hãy trả lời câu hỏi của người dùng dựa trên kết quả tool ở trên. Không gọi thêm tool."

/** No stream part at all for this long: the request is stalled, not slow. */
export const LLM_STALL_MS = 120_000

/** What a stalled request reports; the turn fails instead of hanging. */
const stallMessage = (ms: number) =>
  `Model không gửi dữ liệu trong ${Math.round(ms / 1000)}s (provider hoặc mạng treo); đã dừng lượt để báo lỗi thay vì treo. Gửi lại tin nhắn hoặc đổi model.`

/**
 * Sent after each round of tool results (never stored): weak models drift to one call per
 * step and lose the formatting rules once tool output piles up. It sits at the very end of
 * the request, so the cached prefix is unchanged.
 */
export const TOOL_NUDGE =
  "<nhac_nho>\nNếu còn cần dữ liệu, gọi cùng lúc mọi tool không phụ thuộc nhau. Khi trả lời: ngày tuyệt đối, mỗi cột một đơn vị, số dòng khớp lời nói, mỗi số có nguồn.\n</nhac_nho>"

/**
 * The nudge, plus the open todo items when there are any. Seen with gemini-3.1-flash-lite
 * (06/10): after its last tool call the model wrote the answer and closed the list only on
 * the next turn. This step may be the one that answers, so close the list first.
 */
export function toolNudge(messages: readonly ModelMessage[]): string {
  const open = currentTodos(messages).filter((t) => t.status === "pending" || t.status === "in_progress")
  if (open.length === 0) return TOOL_NUDGE
  const items = open.map((t) => `${todoMark(t.status)} ${t.content}`).join("\n")
  return TOOL_NUDGE.replace(
    "\n</nhac_nho>",
    `\nViệc cần làm còn mở:\n${items}\nViệc nào đã xong thì gọi todo_write đánh dấu completed (hoặc cancelled nếu bỏ) trước khi viết câu trả lời cuối.\n</nhac_nho>`,
  )
}

/**
 * Routes whose request body was checked to keep a user message right after tool results in
 * the same user turn (test/tool-nudge.test.ts). Others (Mistral rejects user-after-tool,
 * OpenAI-compatible gateways vary) get no nudge.
 */
const NUDGE_NPM = new Set(["@ai-sdk/anthropic", "@ai-sdk/google", "@ai-sdk/groq", "@ai-sdk/openai"])

export function nudgeAfterTools(target: TargetLike | undefined): boolean {
  if (!target) return false
  const info = target.provider.models[target.model]
  const npm = info?.provider?.npm ?? target.provider.npm ?? ""
  const api = info?.provider?.api ?? target.provider.api
  // @ai-sdk/openai with its own base URL is some third party speaking Chat Completions.
  return NUDGE_NPM.has(npm) && !(npm === "@ai-sdk/openai" && api)
}

/** Reminders ride on the user message inside this tag; UIs hide it, history keeps it. */
export const REMINDER_TAG = "nhac_nho"

export interface RunOptions {
  history: ModelMessage[]
  input: string
  /** Images pasted into the prompt, sent after the text (only to models that take image input). */
  images?: { data: string; mediaType: string }[]
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
  /** `instructions` of connected MCP servers (McpManager.instructions). */
  serverInstructions?: () => { server: string; text: string }[]
  /** Provider and model to use instead of the configured ones (a subagent's model). */
  target?: Target
  /** "subagent": a child run — its own system prompt, no investor profile or memory. */
  role?: "main" | "subagent"
  /** A subagent type's own instructions (the body of its definition). */
  agentPrompt?: string
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
  // A tool's own result: show its text; images are never dumped as base64 into the UI.
  if (value && typeof value === "object" && "output" in value && typeof (value as ToolResult).output === "string") {
    const r = value as ToolResult
    return r.images?.length ? `${r.output}\n[${r.images.length} ảnh]` : r.output
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Structured chart payload a tool carried (TUI paints it coloured); absent for other tools. */
function chartOf(value: unknown): ChartData | undefined {
  if (!value || typeof value !== "object" || !("chart" in value)) return undefined
  return (value as { chart?: ChartData }).chart
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

/**
 * The user message as stored in history: optional reminder block, what the user typed, then
 * the pasted images (Claude Code's order: text first; the `[Image #N]` labels refer to them).
 */
export function userMessage(input: string, reminders: string[], images: RunOptions["images"] = []): ModelMessage {
  if (reminders.length === 0 && images.length === 0) return { role: "user", content: input }
  return {
    role: "user",
    content: [
      ...(reminders.length > 0 ? [{ type: "text" as const, text: `<${REMINDER_TAG}>\n${reminders.join("\n\n")}\n</${REMINDER_TAG}>` }] : []),
      { type: "text" as const, text: input },
      ...images.map((i) => ({ type: "image" as const, image: i.data, mediaType: i.mediaType })),
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

/**
 * Body of the last `<id>` block sent inside a reminder, or undefined. Reminders that only go
 * out when they change (`<quyen_tep>`) compare against it.
 */
export function lastReminder(history: readonly ModelMessage[], id: string): string | undefined {
  const open = `<${id}>\n`
  const close = `\n</${id}>`
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!
    if (m.role !== "user" || typeof m.content === "string") continue
    for (const part of m.content) {
      if (part.type !== "text" || !part.text.startsWith(`<${REMINDER_TAG}>`)) continue
      const start = part.text.indexOf(open)
      if (start < 0) continue
      const end = part.text.indexOf(close, start)
      if (end > start) return part.text.slice(start + open.length, end)
    }
  }
  return undefined
}

/**
 * Calls the SDK could not parse. A short name from <tool_hoan> (`vn_quote_history`,
 * `server/tool`) that matches one active tool is rewritten to its full name. A deferred tool
 * the model called before loading it cannot run at this step (AI SDK 7 parses a repaired
 * call against the step's active tools), but the call itself loads it: the error says so,
 * with its parameters, and the model calls it again instead of spending a tool_search step.
 * `null` = keep the SDK's own error.
 */
async function repairCall<T extends { toolName: string }>(
  registry: ToolRegistry,
  built: BuiltToolSet | undefined,
  active: string[] | undefined,
  loaded: readonly string[],
  toolCall: T,
  error: unknown,
): Promise<T | null> {
  if (!built) return null
  const deferring = built.deferring || built.deferred.length > 0
  if (!NoSuchToolError.isInstance(error)) return null
  const names = resolveToolName(registry, toolCall.toolName).filter((n) => n in built.tools)
  if (names.length === 1 && (!active || active.includes(names[0]!))) return { ...toolCall, toolName: names[0]! }
  if (names.length === 1 && deferring) {
    const name = names[0]!
    // Loaded already yet still not active: cut by the per-request cap. Saying "loaded,
    // call again" here would loop.
    if (loaded.includes(name)) {
      throw new Error(
        `Tool ${name} đã nạp nhưng không gửi kèm được trong bước này: đã chạm trần ${MAX_TOOLS_PER_REQUEST} tool mỗi lần gọi model. Dùng các tool đang có để trả lời.`,
      )
    }
    const def = registry.get(name)
    // First line loads it (loadedTools reads it), also when the model used a short name.
    throw new Error(
      [
        `${LOADED_PREFIX}${name}`,
        `Tool ${name} chưa có trong bước này nên chưa chạy; đã nạp xong — gọi lại đúng lệnh với tên ${name}.`,
        ...(def ? ["", describeTool(registry, def)] : []),
      ].join("\n"),
    )
  }
  if (!deferring) return null
  const many = names.length > 1 ? ` Tên này khớp nhiều tool: ${names.join(", ")}.` : ""
  throw new Error(`Không có tool "${toolCall.toolName}".${many} Gọi tool_search (query "select:<tên>" hoặc từ khoá) để nạp tool rồi gọi lại.`)
}

interface Outcome {
  text: string
  aborted: boolean
  failure?: unknown
  /** Model requests started so far in this turn (tool calls carry the step that made them). */
  steps: number
  /** Billed tokens summed over the steps that reported usage; undefined = none did. */
  usage?: { input: number; output: number }
  /** How the last step ended, as the provider said it (STOP, UNEXPECTED_TOOL_CALL…). */
  rawFinish?: string
  /** The provider's note on that end (Gemini's finishMessage), clipped. */
  finishMessage?: string
  /** The model streamed reasoning (thoughts) in this run. */
  reasoned?: boolean
  /** Completed steps of this turn (assistant calls + their tool results), for aborted turns. */
  progress: ModelMessage[]
}

/**
 * Why a run ended without text, from what the provider reported, or undefined when it just
 * stopped. An empty answer was only "(không có câu trả lời)" before: nothing told a
 * Gemini UNEXPECTED_TOOL_CALL from a reply made of thoughts only.
 */
export function emptyReason(outcome: Pick<Outcome, "rawFinish" | "finishMessage" | "reasoned">): string | undefined {
  const raw = outcome.rawFinish && !/^stop$/i.test(outcome.rawFinish) ? outcome.rawFinish : undefined
  const parts = [raw, outcome.finishMessage, !raw && outcome.reasoned ? "chỉ có phần suy luận, không có câu trả lời" : undefined].filter(Boolean)
  return parts.length > 0 ? parts.join(" — ") : undefined
}

/** Relay one streamText run as AgentEvents and report what happened. */
/** Retry notices raised inside the SDK's request, relayed between stream parts. */
class RetryNotices {
  private queue: RetryNotice[] = []
  private wake: (() => void) | undefined
  readonly options: RetryOptions = { onRetry: (notice) => this.push(notice) }
  push(notice: RetryNotice) {
    this.queue.push(notice)
    this.wake?.()
  }
  /** Resolves once a notice is waiting. */
  ready(): Promise<typeof RETRY> {
    if (this.queue.length > 0) return Promise.resolve(RETRY)
    return new Promise((resolve) => (this.wake = () => resolve(RETRY)))
  }
  drain(): RetryNotice[] {
    const out = this.queue
    this.queue = []
    return out
  }
}
const RETRY = Symbol("retry")

async function* relay(
  result: StreamTextResult<ToolSet, Record<string, unknown>, never>,
  registry: ToolRegistry,
  signal: AbortSignal | undefined,
  outcome: Outcome,
  notices?: RetryNotices,
  stall?: { ms: number; onStall: () => void },
): AsyncGenerator<AgentEvent> {
  const started = new Map<string, number>()
  // The turn's completed steps so far, kept so an abort or failure keeps work whose tools
  // already ran (closeDanglingToolCalls patches calls left without a result).
  let stepText = ""
  const stepCalls: { toolCallId: string; toolName: string; input: unknown }[] = []
  const stepResults: { toolCallId: string; toolName: string; output: unknown; error: boolean }[] = []
  const flushProgress = () => {
    if (stepCalls.length === 0 && stepResults.length === 0 && !stepText) return
    const content = [
      ...(stepText ? [{ type: "text" as const, text: stepText }] : []),
      ...stepCalls.map((c) => ({ type: "tool-call" as const, ...c })),
    ]
    if (content.length > 0) outcome.progress.push({ role: "assistant", content })
    if (stepResults.length > 0)
      outcome.progress.push({
        role: "tool",
        content: stepResults.map((r) => ({
          type: "tool-result" as const,
          toolCallId: r.toolCallId,
          toolName: r.toolName,
          output: r.error
            ? { type: "error-text" as const, value: String(r.output) }
            : typeof r.output === "string"
              ? { type: "text" as const, value: r.output }
              : { type: "json" as const, value: r.output as JSONValue },
        })),
      })
    stepText = ""
    stepCalls.length = 0
    stepResults.length = 0
  }
  // A request is alive while parts arrive OR while a tool call it made still runs: tool
  // execution can take minutes (spawn_subagent, ask_user, MCP) and streams no parts.
  const pendingTools = new Set<string>()
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  const rearm = (ms = stall?.ms ?? 0) => {
    if (!stall) return
    clearTimeout(stallTimer)
    if (pendingTools.size > 0) return
    stallTimer = setTimeout(stall.onStall, ms)
    stallTimer.unref?.()
  }
  try {
    const parts = result.stream[Symbol.asyncIterator]()
    rearm()
    let pending = parts.next()
    for (;;) {
      // While a request waits to be retried no part arrives: show the wait meanwhile.
      const next = notices ? await Promise.race([pending, notices.ready()]) : await pending
      if (next === RETRY) {
        let wait = 0
        for (const notice of notices!.drain()) {
          wait = Math.max(wait, notice.delayMs)
          yield { type: "retry", ...notice }
        }
        // A deliberate retry wait is not a stall: the next attempt gets a full window
        // after the provider's requested delay.
        rearm((stall?.ms ?? 0) + wait)
        continue
      }
      if (next.done) break
      pending = parts.next()
      const part = next.value
      rearm()
      switch (part.type) {
        case "start-step":
          outcome.steps++
          break
        case "reasoning-delta":
          outcome.reasoned = true
          yield { type: "progress" }
          break
        case "finish-step": {
          flushProgress()
          outcome.rawFinish = part.rawFinishReason
          const note = (part.providerMetadata?.google as { finishMessage?: unknown } | undefined)?.finishMessage
          outcome.finishMessage = typeof note === "string" && note.trim() ? note.trim().slice(0, 300) : undefined
          const input = part.usage?.inputTokens
          const output = part.usage?.outputTokens
          if (input === undefined && output === undefined) break
          outcome.usage = { input: (outcome.usage?.input ?? 0) + (input ?? 0), output: (outcome.usage?.output ?? 0) + (output ?? 0) }
          yield { type: "step-usage", inputTokens: input ?? 0, outputTokens: output ?? 0 }
          break
        }
        case "text-delta":
          outcome.text += part.text
          stepText += part.text
          yield { type: "text-delta", text: part.text }
          break
        case "tool-call":
          started.set(part.toolCallId, Date.now())
          stepCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input })
          pendingTools.add(part.toolCallId)
          rearm()
          yield {
            type: "tool-start",
            callId: part.toolCallId,
            name: part.toolName,
            label: label(registry, part.toolName, part.input),
            input: part.input,
            step: Math.max(1, outcome.steps),
          }
          break
        case "tool-result":
        case "tool-error": {
          const ok = part.type === "tool-result"
          yield {
            type: "tool-end",
            callId: part.toolCallId,
            ok,
            output: ok ? stringify(part.output) : toolErrorText(describeError(part.error)),
            chart: ok ? chartOf(part.output) : undefined,
            durationMs: Date.now() - (started.get(part.toolCallId) ?? Date.now()),
          }
          pendingTools.delete(part.toolCallId)
          stepResults.push({ toolCallId: part.toolCallId, toolName: part.toolName, output: ok ? part.output : describeError(part.error), error: !ok })
          rearm()
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
  } finally {
    // A turn cut mid-step still keeps what completed: the abort path reads outcome.progress.
    flushProgress()
    clearTimeout(stallTimer)
  }
  if (signal?.aborted) outcome.aborted = true
}

interface Prepared {
  target: Awaited<ReturnType<typeof resolveTarget>>
  tier: Tier
  tools: ToolSet | undefined
  built: BuiltToolSet | undefined
  /** Images in tool results reach the model. */
  images: boolean
  /** Images in user messages reach the model. */
  userImages: boolean
  assembled: Assembled
  supportsTools: boolean
}

type TargetLike = {
  provider: { npm?: string; api?: string; models: Record<string, { modalities?: { input?: string[] }; provider?: { npm?: string; api?: string } }> }
  model: string
}

/**
 * Whether images in tool results reach the model as real image parts. Only the request
 * shapes checked in test/image-routing.test.ts (against the bundled SDKs) qualify:
 * - Anthropic: an image block inside tool_result.
 * - OpenAI Responses API (the official endpoint): input_image in function_call_output.
 *   OpenAI-SDK providers with their own base URL use Chat Completions, which puts the
 *   base64 into the tool message as text — never there.
 * - Gemini 3: inlineData inside functionResponse.parts. Gemini 2.x takes a different
 *   ("legacy") shape we cannot verify without a live key — placeholders until then.
 */
function imagesReachModel(npm: string, api: string | undefined, model: string) {
  if (npm === "@ai-sdk/anthropic") return true
  if (npm === "@ai-sdk/openai") return !api
  if (npm === "@ai-sdk/google") return model.startsWith("gemini-3")
  return false
}

/** How to build the tool set for this model: schema dialect and whether it can see images. */
export function toolSetOptions(target: TargetLike | undefined): ToolSetOptions {
  if (!target) return {}
  const info = target.provider.models[target.model]
  const npm = info?.provider?.npm ?? target.provider.npm ?? ""
  const api = info?.provider?.api ?? target.provider.api
  return {
    // Gemini through OpenRouter or a gateway still has Gemini's schema rules.
    flavor: npm.startsWith("@ai-sdk/google") || /gemini/i.test(target.model) ? "gemini" : "default",
    images: imagesReachModel(npm, api, target.model) && (info?.modalities?.input ?? []).includes("image"),
  }
}

/**
 * Whether the model takes images the user pasted. Unlike images inside tool results, user
 * image parts are understood by every bundled SDK; models.dev says which models see them.
 */
export function acceptsImageInput(target: TargetLike | undefined): boolean {
  if (!target) return false
  return (target.provider.models[target.model]?.modalities?.input ?? []).includes("image")
}

/** Deferred tools are worth it once their definitions would take this share of the context. */
export const DEFER_CONTEXT_SHARE = 0.1
export const DEFAULT_DEFER_MIN_TOOLS = 40

/**
 * Whether deferrable tools (MCP and the optional built-in ones) go out by name only this
 * request (tool search). "auto" defers once the deferrable tools are many (tool choice degrades past ~30–50) or heavy for the context.
 */
export function shouldDefer(
  config: Pick<Config, "toolSearch" | "toolSearchMinTools">,
  registry: ToolRegistry,
  context: number | undefined,
  flavor?: SchemaFlavor,
) {
  const mode = config.toolSearch ?? "auto"
  if (mode === "off" || !registry.get(TOOL_SEARCH)) return false
  const deferrable = registry.list().filter((d) => d.deferrable)
  if (deferrable.length === 0) return false
  if (mode === "on") return true
  if (deferrable.length > (config.toolSearchMinTools ?? DEFAULT_DEFER_MIN_TOOLS)) return true
  return !!context && registry.estimateTokens(deferrable, flavor) > context * DEFER_CONTEXT_SHARE
}

/** Deferred tool names grouped by MCP server, short names where they are unambiguous. */
export function deferredByServer(registry: ToolRegistry, names: string[]) {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const source = registry.get(name)?.source ?? "?"
    const server = source.replace(/^mcp:/, "")
    const prefix = serverPrefix(server)
    const short = source.startsWith("mcp:") && name.startsWith(prefix) ? name.slice(prefix.length) : name
    const unique = short === name || resolveToolName(registry, short).length === 1
    groups.set(server, [...(groups.get(server) ?? []), unique ? short : `${sanitize(server)}/${short}`])
  }
  return [...groups].map(([server, tools]) => ({ server, tools }))
}

/**
 * Tools the model may call at a step: the visible set plus deferred tools the conversation
 * loaded (tool_search results, load_skill, direct calls). Undefined = no narrowing.
 */
export function activeFor(built: BuiltToolSet | undefined, messages: readonly ModelMessage[]): string[] | undefined {
  if (!built) return undefined
  // Nothing deferred and nothing cut: every declared tool is callable. (With search on, a
  // history that loaded more than the cap declares them all; the cap must still apply.)
  if (built.deferred.length === 0 && built.names.length === Object.keys(built.tools).length) return undefined
  const visible = new Set(built.names)
  const extra = loadedTools(messages).filter((n) => !visible.has(n) && n in built.tools)
  return [...built.names, ...extra].slice(0, MAX_TOOLS_PER_REQUEST)
}

type TurnInput = Omit<RunOptions, "history" | "signal" | "maxSteps"> & {
  /** Conversation so far; decides which deferred tools are already loaded. */
  history?: ModelMessage[]
}

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
  const setOptions = toolSetOptions(target)
  const defer = supportsTools && shouldDefer(await loadConfig(), opts.registry, info?.limit?.context, setOptions.flavor)
  // ‖ read-only sends the local write tools by name only; ▸ declares them in full.
  const mode = opts.registry.gate?.mode ?? "read-only"
  const modeTools = mode === "read-only" ? [] : opts.registry.list().filter((d) => d.effect).map((d) => d.name)
  const loaded = new Set([...loadedTools(opts.history ?? []), ...modeTools])
  const built = supportsTools ? opts.registry.toToolSet({ ...setOptions, defer, loaded }) : undefined
  const toolNames = built?.names ?? []
  const assembled = assemble({
    tier,
    tools: toolNames,
    skills: opts.skills,
    sticky: opts.sticky ?? [],
    role: opts.role,
    agentPrompt: opts.agentPrompt,
    // A subagent works for the main agent: no investor profile, no memory about the user.
    investorProfile: opts.role === "subagent" ? undefined : await loadProfile(),
    memoryInstructions: opts.memory?.instructions?.(),
    memoryIndex: cap(await opts.memory?.index?.({ sessionId: opts.sessionId ?? "" }).catch(() => undefined), MEMORY_INDEX_MAX_CHARS),
    recalled: extras.recalled,
    hookContext: extras.hookContext,
    input: opts.input,
    now: opts.now ?? new Date(),
    prevClock: opts.prevClock,
    deferredTools: built && built.deferred.length > 0 ? deferredByServer(opts.registry, built.deferred) : undefined,
    declaredTools: built ? Object.keys(built.tools) : undefined,
    mcpInstructions: opts.serverInstructions?.(),
    todos: currentTodos(opts.history ?? []),
    fileAccess: toolNames.includes("read_file") && opts.registry.workspace ? `${opts.registry.workspace.describe()}\n${modeNote(mode)}` : undefined,
    prevFileAccess: lastReminder(opts.history ?? [], "quyen_tep"),
  })
  if (built && built.names.length > 0) {
    const share = info?.limit?.context ? built.tokens / info.limit.context : 0
    assembled.report.push({
      id: "tool_schemas",
      layer: 7,
      channel: "system",
      tokens: built.tokens,
      truncated: built.hidden.length > 0,
      dropped: false,
      note:
        `${built.names.length} tool` +
        (built.deferred.length > 0 ? ` · hoãn ${built.deferred.length}` : "") +
        (built.hidden.length > 0 ? ` · ẩn ${built.hidden.reduce((n, h) => n + h.count, 0)} do giới hạn ${built.names.length}` : "") +
        (share > 0.25 ? ` · chiếm ${Math.round(share * 100)}% context, nên lọc bớt tool` : ""),
    })
  }
  return { tier, supportsTools, toolNames, built, assembled }
}

async function prepare(opts: TurnInput, extras: TurnExtras): Promise<Prepared> {
  const target = opts.target ?? (await resolveTarget())
  const { tier, supportsTools, toolNames, built, assembled } = await assembleFor(opts, target, extras)
  return {
    target,
    tier,
    supportsTools,
    built,
    images: toolSetOptions(target).images ?? false,
    userImages: acceptsImageInput(target),
    tools: toolNames.length > 0 ? built!.tools : undefined,
    assembled,
  }
}

/**
 * The request as sent: placeholders for images the model cannot see, the user/session
 * context on the first user message, the cache mark for Anthropic, and the tools visible
 * now (tool search). Turns and the compaction summary share it, so both send the same prefix.
 */
function requestFor(p: Prepared, messages: ModelMessage[], retry: RetryOptions = {}) {
  // After /model to a model without vision, earlier screenshots become placeholders.
  const visible = p.images && p.userImages ? messages : stripImages(messages, { tool: !p.images, user: !p.userImages })
  const request = withContext(visible, p.assembled.context)
  // Anthropic caches only where asked: mark the static system prompt. Others cache by prefix.
  const system: string | SystemModelMessage =
    p.target.provider.npm === "@ai-sdk/anthropic"
      ? { role: "system", content: p.assembled.system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
      : p.assembled.system
  // Requests are retried by kind of failure (retry.ts); the SDK's own retry stays off.
  const model = wrapLanguageModel({ model: languageModel(p.target.provider, p.target.model, p.target.apiKey), middleware: retryMiddleware(retry) })
  return { system, request, model, active: activeFor(p.built, request) }
}

/** Context size after a response: the last step's prompt plus its answer, as the provider counted it. */
async function lastStepTokens(result: { steps: PromiseLike<{ usage: LanguageModelUsage }[]> }): Promise<number | undefined> {
  try {
    const usage = (await result.steps).at(-1)?.usage
    if (usage?.inputTokens === undefined) return undefined
    return usage.inputTokens + (usage.outputTokens ?? 0)
  } catch {
    return undefined
  }
}

const estimateRequest = (system: string | SystemModelMessage, messages: ModelMessage[], toolTokens = 0) =>
  estimateTokens(JSON.stringify([system, ...messages])) + toolTokens

/**
 * Compaction step 2: the model condenses `head` (older turns) into a structured summary.
 * Same system prompt, context and tool set as a turn, tools disabled; the instruction comes
 * last. A prompt-too-long error drops the oldest turn and retries (at most twice).
 */
export async function summarizeConversation(
  opts: Omit<TurnInput, "input"> & { head: ModelMessage[]; prompt: string; signal?: AbortSignal },
): Promise<string> {
  let head = opts.head
  for (let attempt = 0; ; attempt++) {
    const prepared = await prepare({ ...opts, history: head, input: "" }, {})
    const { system, request, model, active } = requestFor(prepared, [...head, { role: "user", content: opts.prompt }])
    try {
      const result = await generateText({
        model,
        instructions: system,
        messages: request,
        tools: prepared.tools,
        activeTools: active,
        toolChoice: prepared.tools ? "none" : undefined,
        maxOutputTokens: compactOutputTokens(prepared.target),
        abortSignal: opts.signal,
        // retry.ts retries transient failures; never a daily-quota 429.
        maxRetries: 0,
      })
      // A cut-off summary loses its last section (what to do next): never use it.
      if (result.finishReason === "length") throw new SummaryTruncated()
      return result.text
    } catch (error) {
      if (error instanceof SummaryTruncated) throw error
      const turns = head.reduce((n, m) => n + (m.role === "user" ? 1 : 0), 0)
      if (attempt >= 2 || turns <= 1 || !isContextOverflow(describeError(error))) throw new Error(describeError(error))
      // Drop the oldest turn: everything up to the second user message.
      const next = head.findIndex((m, i) => i > 0 && m.role === "user")
      head = head.slice(next)
    }
  }
}

/** The summary plus its <analysis> scratchpad; never above what the model can write. */
const COMPACT_MAX_OUTPUT_TOKENS = 12_000
const compactOutputTokens = (target: Target) =>
  Math.min(COMPACT_MAX_OUTPUT_TOKENS, target.provider.models[target.model]?.limit?.output ?? COMPACT_MAX_OUTPUT_TOKENS)

class SummaryTruncated extends Error {
  constructor() {
    super(`Bản tóm tắt dài quá ${COMPACT_MAX_OUTPUT_TOKENS} token và bị cắt; đã giữ nguyên hội thoại.`)
  }
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
  const { assembled, tier, built } = await assembleFor(opts, target)
  const loaded = new Set(loadedTools(opts.history ?? []))
  return {
    report: assembled.report,
    tier,
    /** Tool search state: tools sent by name only, and deferred tools already loaded. */
    deferred: built?.deferred ?? [],
    loaded: built ? Object.keys(built.tools).filter((n) => loaded.has(n) && opts.registry.get(n)?.deferrable && !built.deferred.includes(n)) : [],
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
  const target0 = opts.target ?? (await resolveTarget())
  opts = { ...opts, target: target0 }
  // The auto-mode classifier reads the user's words (or, for a subagent, its task as the main
  // agent's words), never the answers.
  opts.registry.gate?.auto?.log.turn(opts.input, { agent: opts.role === "subagent" ? opts.registry.origin : undefined, note: NOTICE_NOTE })

  // user-prompt hooks: may block the turn or add context for it.
  const extras: TurnExtras = {}
  if (opts.hooks) {
    const hooked = await opts.hooks.emit({ type: "user-prompt", sessionId, prompt: opts.input })
    for (const error of hooked.errors) yield { type: "notice", text: error }
    if (hooked.block) {
      yield { type: "notice", text: `Lượt này bị chặn: ${hooked.block}` }
      yield { type: "done", messages: [], outcome: "completed" }
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

  const prepared = await prepare(opts, extras)
  const { target, tools, built, assembled, supportsTools } = prepared
  const configured = (await loadConfig()).maxSteps
  const maxSteps = opts.maxSteps ?? (Number.isInteger(configured) && configured! >= 2 ? configured! : DEFAULT_MAX_STEPS)
  if (!supportsTools && opts.registry.list().length > 0) {
    yield { type: "notice", text: "Model này không hỗ trợ tool; trả lời không dùng tool." }
  }
  // Tell the user once whenever deferral or the hidden tools change. Keyed on every
  // deferrable tool, not on those still unloaded: loading tools must not repeat the notice.
  const deferrable = built?.deferring ? opts.registry.list().filter((d) => d.deferrable).map((d) => d.name) : []
  const hiddenKey = JSON.stringify([built?.hidden ?? [], deferrable.length])
  if (hiddenKey !== opts.registry.lastHiddenNotice) {
    opts.registry.lastHiddenNotice = hiddenKey
    if (deferrable.length > 0) {
      // Built-in tools (charts, web, watchlist…) are deferrable too, but they are not MCP.
      const groups = deferredByServer(opts.registry, deferrable)
      const parts = [
        ...groups.filter((g) => g.server !== LOCAL_SOURCE).map((g) => `${g.tools.length} MCP của ${g.server}`),
        ...groups.filter((g) => g.server === LOCAL_SOURCE).map((g) => `${g.tools.length} tool có sẵn`),
      ]
      yield {
        type: "notice",
        text: `Đang hoãn ${deferrable.length} tool (${parts.join(", ")}); model tự nạp bằng tool_search khi cần. Đổi trong /config.`,
      }
    }
    if (built && built.hidden.length > 0) {
      const parts = built.hidden.map((h) => `${h.count} tool của ${h.source.replace(/^mcp:/, "")}`).join(", ")
      yield {
        type: "notice",
        text: `Model chỉ nhận tối đa ${built.names.length} tool mỗi lần; đang ẩn ${parts}. Lọc bằng "enabledTools"/"disabledTools" trong cấu hình MCP hoặc tắt bớt server (/mcp).`,
      }
    }
  }

  const user = userMessage(opts.input, assembled.reminders, opts.images)
  // A vision model's screenshots stay in history; a model without vision gets placeholders.
  const notices = new RetryNotices()
  // A request that streams nothing for a long time is stalled, not slow: cut it (LLM_STALL_MS).
  const stall = new AbortController()
  let stalled = false
  const stallMs = Number(process.env.OPENTRADING_STALL_MS ?? LLM_STALL_MS)
  const abortSignal = opts.signal ? AbortSignal.any([opts.signal, stall.signal]) : stall.signal
  const onStall = () => {
    stalled = true
    stall.abort()
  }
  const { system, request, model } = requestFor(prepared, [...opts.history, user], notices.options)
  let summarized = false
  const nudge = nudgeAfterTools(target)
  // Visible tools at the current step; deferred tools join once loaded (tool search).
  let active = activeFor(built, request)
  let loaded = loadedTools(request)
  const result = streamText({
    model,
    instructions: system,
    messages: request,
    tools,
    stopWhen: isStepCount(maxSteps),
    // Every step exposes what the conversation has loaded so far, so a tool found by
    // tool_search is callable at the very next step.
    // Last allowed step: keep tools declared (some providers reject tool history otherwise)
    // but forbid calling them, so the turn always ends with an answer.
    // Message overrides carry forward to later steps, so every step rebuilds its messages from
    // the request plus what the model and tools produced: a nudge stays a one-step addition.
    prepareStep: ({ stepNumber, initialMessages, responseMessages }) => {
      if (!tools) return undefined
      // Clean before activeFor reads them: the model never sees the SDK's raw error strings.
      const messages = cleanToolErrors([...initialMessages, ...responseMessages])
      active = activeFor(built, messages)
      loaded = loadedTools(messages)
      if (stepNumber < maxSteps - 1) {
        if (!nudge || messages.at(-1)?.role !== "tool") return { ...(active ? { activeTools: active } : {}), messages }
        return { ...(active ? { activeTools: active } : {}), messages: [...messages, { role: "user", content: toolNudge(messages) }] }
      }
      summarized = true
      return { toolChoice: "none", activeTools: active, messages: [...messages, { role: "user", content: SUMMARY_PROMPT }] }
    },
    experimental_repairToolCall: async ({ toolCall, error }) => repairCall(opts.registry, built, active, loaded, toolCall, error),
    abortSignal,
    // The model is wrapped with retry.ts (by kind of failure, shown to the user, Esc
    // cancels the wait); the SDK's blind retry would repeat a daily-quota 429.
    maxRetries: 0,
    onError: () => {}, // errors are read from the stream
  })

  const outcome: Outcome = { text: "", aborted: false, steps: 0, progress: [] }
  yield* relay(result, opts.registry, opts.signal, outcome, notices, { ms: stallMs, onStall })
  if (stalled) {
    outcome.aborted = false
    outcome.failure = new Error(stallMessage(stallMs))
  }
  // The request whose usage measures the context (the empty-answer retry replaces it).
  let measured: { steps: PromiseLike<{ usage: LanguageModelUsage }[]> } = result

  let messages: ModelMessage[] | undefined
  if (!outcome.aborted && !outcome.failure) {
    try {
      messages = cleanToolErrors(await result.responseMessages)
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
      instructions: system,
      // The nudge is only for this request; it is not kept in history.
      messages: [...request, ...kept, { role: "user", content: NUDGE_PROMPT }],
      tools,
      activeTools: activeFor(built, [...request, ...kept]),
      toolChoice: tools ? "none" : undefined,
      abortSignal,
      maxRetries: 0,
      onError: () => {},
    })
    const second: Outcome = { text: "", aborted: false, steps: 0, progress: [] }
    yield* relay(retry, opts.registry, opts.signal, second, notices, { ms: stallMs, onStall })
    if (stalled) {
      second.aborted = false
      second.failure = new Error(stallMessage(stallMs))
    }
    measured = retry
    if (second.usage) {
      outcome.usage = { input: (outcome.usage?.input ?? 0) + second.usage.input, output: (outcome.usage?.output ?? 0) + second.usage.output }
    }
    outcome.aborted = second.aborted
    outcome.failure = second.failure
    outcome.text = second.text
    if (!second.aborted && !second.failure) {
      if (second.text.trim()) messages = [...kept, { role: "assistant", content: second.text }]
      else {
        // What the provider said, for both attempts: the first one is what went wrong.
        const why = [emptyReason(outcome), emptyReason(second)].filter(Boolean)
        const reason = why.length > 0 ? ` Lý do từ provider: ${[...new Set(why)].join("; lần thử lại: ")}.` : ""
        yield {
          type: "notice",
          text: usedTools
            ? `Model không trả lời sau khi gọi tool (câu trả lời rỗng).${reason} Kết quả tool ở phía trên; thử hỏi lại hoặc đổi model.`
            : `Model trả về câu trả lời rỗng.${reason} Thử hỏi lại hoặc đổi model.`,
        }
        // Kept in the session file, so the cause can be read back later.
        messages = [...kept, { role: "assistant", content: `(không có câu trả lời${why.length > 0 ? ` — ${why[0]}` : ""})` }]
      }
    }
  }

  if (messages && !outcome.aborted && !outcome.failure) {
    if (summarized) yield { type: "notice", text: `Đã dùng hết ${maxSteps} bước gọi tool; câu trả lời là bản tổng kết.` }
    const tokens = await lastStepTokens(measured)
    const usage =
      tokens !== undefined
        ? { contextTokens: tokens, estimated: false, total: outcome.usage }
        : { contextTokens: estimateRequest(system, [...request, ...messages], built?.tokens), estimated: true, total: outcome.usage }
    yield { type: "done", messages: [user, ...messages], clock: assembled.clock, usage, outcome: "completed" }
    if (opts.hooks) void opts.hooks.emit({ type: "turn-end", sessionId, messages: [user, ...messages] })
    return
  }

  if (outcome.failure && !outcome.aborted) yield { type: "error", message: describeError(outcome.failure) }
  // Aborted or failed mid-turn: keep the steps whose tools already ran (closeDanglingToolCalls
  // closes any call left without a result, so providers still accept the history), then the
  // partial text. The user message keeps its reminders, so the clock it carried still counts
  // as sent.
  const text = outcome.text
  const kept = closeDanglingToolCalls(outcome.progress, "Tool bị ngắt vì lượt bị dừng giữa chừng.").messages
  // No square brackets: the markdown renderer read "[Đã dừng]" as a link. The closed steps
  // already carry their text, so the trailing note appears only when nothing else closes the
  // turn — a resumed session must not show a step's text twice.
  const marker = outcome.aborted ? "(đã dừng)" : "(lỗi)"
  const closing: ModelMessage[] =
    kept.length === 0 ? [{ role: "assistant", content: text || marker }] : kept.at(-1)!.role === "tool" ? [{ role: "assistant", content: marker }] : []
  yield {
    type: "done",
    messages: [user, ...kept, ...closing],
    clock: assembled.clock,
    usage: {
      contextTokens: estimateRequest(system, [...request, ...kept, ...closing], built?.tokens),
      estimated: true,
      total: outcome.usage,
    },
    outcome: outcome.aborted ? "aborted" : "failed",
  }
}
