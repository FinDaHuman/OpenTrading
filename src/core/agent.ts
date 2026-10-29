import {
  generateText,
  NoSuchToolError,
  ToolChoiceViolationError,
  hasToolCall,
  isStepCount,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
  type StreamTextResult,
  type SystemModelMessage,
  type ToolCallPart,
  type ToolResultPart,
  type ToolSet,
  wrapLanguageModel,
} from "ai"
import { ChatSetupError, describeError, resolveTarget, type Target } from "./chat"
import { effortOptions, isEffort, mergeProviderOptions, type Effort } from "./effort"
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
import { isContextOverflow, pruneAttachments, pruneToolResults, tokensOf } from "./compact"
import { isAttachmentText } from "./mentions"
import { classifyFailure, retryMiddleware, type RetryNotice, type RetryOptions } from "./retry"
import { loadedTools } from "./tools/loaded"
import { modeNote } from "./permission/mode"
import { NOTE as NOTICE_NOTE } from "./subagents/notification"
import { currentTodos, retiredNote, retireLeftTodos, todoMark, TODO_WRITE } from "./tools/todos"
import { answeredAndClosedTodos, judgeStop, MAX_RECOVERIES, stripEchoes, type RecoveryKind, type Verdict } from "./loop/stop-gate"
import { MAX_TOOLS_PER_REQUEST, modelOutput, stripImages, type BuiltToolSet, type ToolRegistry, type ToolSetOptions } from "./tools/registry"
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
 * No stream part at all for this long: the request is stalled, not slow. Codex and opencode
 * use 5 minutes too; parts here are counted after the SDK, so provider keep-alives that reset
 * their SSE-level timers do not count, and a model thinking without streaming its thoughts
 * sends nothing meanwhile.
 */
export const LLM_STALL_MS = 300_000

/** OPENTRADING_STALL_MS when it is a positive number (tests), else LLM_STALL_MS. */
function stallWindow(): number {
  const ms = Number(process.env.OPENTRADING_STALL_MS)
  return Number.isFinite(ms) && ms > 0 ? ms : LLM_STALL_MS
}

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

/** Model steps since the last todo_write call in this request: past this, the list is likely behind. */
export const TODO_BEHIND_STEPS = 2

/**
 * The nudge, plus the open todo items when there are any. The status update rides on the next
 * round of tool calls, and the answering step closes the list itself (one step, no extra
 * request: loop/stop-gate.ts answeredAndClosedTodos). Seen with gemini-3.1-flash-lite (29/10):
 * a list split per ticker while the tickers were fetched in one parallel round could not be
 * kept true, so the model closed it all at the end.
 */
export function toolNudge(messages: readonly ModelMessage[]): string {
  const open = currentTodos(messages).filter((t) => t.status === "pending" || t.status === "in_progress")
  if (open.length === 0) return TOOL_NUDGE
  const items = open.map((t) => `${todoMark(t.status)} ${t.content}`).join("\n")
  const running = open.find((t) => t.status === "in_progress")
  const since = stepsSinceTodoWrite(messages)
  const behind =
    running && since >= TODO_BEHIND_STEPS ? `\nĐã ${since} bước chưa cập nhật danh sách: nếu dữ liệu cho "${running.content}" đã có ở trên thì đánh completed ngay.` : ""
  return TOOL_NUDGE.replace(
    "\n</nhac_nho>",
    `\nViệc cần làm còn mở:\n${items}${behind}\nCập nhật trạng thái bằng todo_write CÙNG lượt với các tool tiếp theo. Khi viết câu trả lời cuối, gọi todo_write đóng danh sách trong cùng bước đó.\n</nhac_nho>`,
  )
}

/** Model steps after the last todo_write call in this turn (all of them when there is none). */
function stepsSinceTodoWrite(messages: readonly ModelMessage[]): number {
  let steps = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role === "user") break
    if (m.role !== "assistant") continue
    if (typeof m.content !== "string" && m.content.some((p) => p.type === "tool-call" && p.toolName === TODO_WRITE)) return steps
    steps++
  }
  return steps
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
  /** Files the user @-mentioned, read for the model (mentions.ts), sent after the text. */
  attachments?: string[]
  /** Every loaded skill (catalog + always-on). */
  skills: Skill[]
  /** Skills the user switched on with /skill <name>. */
  sticky?: string[]
  registry: ToolRegistry
  /** Market-clock snapshot last sent in this conversation; undefined = send it. */
  prevClock?: ClockSnapshot
  now?: Date
  signal?: AbortSignal
  /**
   * How long a request may stream nothing before it is cut (default LLM_STALL_MS). A subagent
   * with `subagents.idleMs` set passes it, so a longer idle limit is not undercut by the stall.
   */
  stallMs?: number
  maxSteps?: number
  /**
   * Auto-compaction threshold (contextLimits). Between tool steps, a request that would reach
   * it goes out with old tool results pruned (no extra request, history untouched); the next
   * turn compacts for real. Undefined: never.
   */
  compactAt?: number
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
  /** Reasoning effort; undefined = the provider's default. Stepped down to what the model takes. */
  effort?: Effort
  /**
   * A tool that ends the turn (a subagent's structured result): calling it stops the loop,
   * and the last allowed step must call it (with `finalPrompt`) instead of answering in prose.
   */
  finalTool?: string
  finalPrompt?: string
  /** Deferred tools callable this turn without tool_search (desk_run when the request opted in). */
  preload?: string[]
  /** The <ultradesk> reminder (desk/keyword.ts deskReminder). */
  desk?: string
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

/**
 * A tool's result as the model sees it: what the tool set's toModelOutput produces for a
 * ToolResult (registry.ts), plain text for anything else. Used where the SDK's response
 * messages are not available (a turn cut mid-way keeps its finished tool results).
 */
function keptOutput(value: unknown, images: boolean): ToolResultPart["output"] {
  if (value && typeof value === "object" && "output" in value && typeof (value as ToolResult).output === "string") return modelOutput(value as ToolResult, images)
  return { type: "text", value: stringify(value) }
}

/** Structured chart payload a tool carried (TUI paints it coloured); absent for other tools. */
function chartOf(value: unknown): ChartData | undefined {
  if (!value || typeof value !== "object" || !("chart" in value)) return undefined
  return (value as { chart?: ChartData }).chart
}

/**
 * The nudge as the request's last user words: joined onto the user message it ends with (two
 * user messages in a row are rejected or mishandled by some providers), else a new message.
 */
export function withNudge(messages: ModelMessage[], text: string): ModelMessage[] {
  const last = messages.at(-1)
  if (last?.role !== "user") return [...messages, { role: "user", content: text }]
  const parts = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content
  return [...messages.slice(0, -1), { ...last, content: [...parts, { type: "text", text }] }]
}

/** A recovery run's nudge (never stored) and whether its first step may call tools. */
type Rescue = { nudge: string; toolChoice: "auto" | "none" }

/** What the user is told when the stop gate sends the model back. */
const RESCUE_NOTICE: Record<RecoveryKind, string> = {
  malformed: "Model gọi tool sai định dạng nên lượt dừng khi chưa trả lời.",
  length: "Câu trả lời bị cắt vì chạm giới hạn độ dài output.",
  empty: "Model dừng khi chưa viết câu trả lời.",
  promise: "Model nói sẽ lấy thêm dữ liệu nhưng dừng mà chưa làm.",
}

type AssistantMessage = Extract<ModelMessage, { role: "assistant" }>
type AssistantPart = Exclude<AssistantMessage["content"], string>[number]

const assistantParts = (message: AssistantMessage): AssistantPart[] =>
  typeof message.content === "string" ? (message.content ? [{ type: "text", text: message.content }] : []) : message.content

/**
 * A recovered run's broken final step leaves history: its text (empty, or only echoed todo
 * lines) is dropped, and the message with it unless it carries tool calls. The answer that
 * follows takes its place, so two model turns never sit side by side.
 */
export function dropFinalText(messages: ModelMessage[]): ModelMessage[] {
  const index = messages.findLastIndex((m) => m.role === "assistant")
  if (index < 0 || index !== messages.length - 1) return messages
  const message = messages[index] as AssistantMessage
  const parts = assistantParts(message).filter((part) => part.type !== "text")
  if (!parts.some((part) => part.type === "tool-call")) return messages.slice(0, index)
  return [...messages.slice(0, index), { ...message, content: parts }]
}

/** A cut answer and its continuation become one assistant message (the nudge between is not kept). */
export function continueAnswer(kept: ModelMessage[], more: ModelMessage[]): ModelMessage[] {
  const prev = kept.at(-1)
  const next = more[0]
  if (prev?.role !== "assistant" || next?.role !== "assistant") return [...kept, ...more]
  const parts = [...assistantParts(prev), ...assistantParts(next)]
  const joined: typeof parts = []
  for (const part of parts) {
    const tail = joined.at(-1)
    if (part.type === "text" && tail?.type === "text") joined[joined.length - 1] = { ...tail, text: tail.text + part.text }
    else joined.push(part)
  }
  return [...kept.slice(0, -1), { ...prev, content: joined }, ...more.slice(1)]
}

/** Echoed todo status lines out of every assistant text (stop-gate.ts stripEchoes). */
export function stripEchoMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role !== "assistant") return [message]
    if (typeof message.content === "string") {
      const text = stripEchoes(message.content)
      return text === message.content ? [message] : text ? [{ ...message, content: text }] : []
    }
    const parts: AssistantPart[] = message.content.flatMap((part): AssistantPart[] => {
      if (part.type !== "text") return [part]
      const text = stripEchoes(part.text)
      return text === part.text ? [part] : text ? [{ ...part, text }] : []
    })
    if (parts.length === message.content.length && parts.every((p, i) => p === message.content[i])) return [message]
    return parts.some((p) => p.type !== "reasoning") ? [{ ...message, content: parts }] : []
  })
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
 * The user message as stored in history: optional reminder block, what the user typed, the
 * @-attached files, then the images (Claude Code's order: text first; the `[Image #N]`
 * labels refer to them).
 */
export function userMessage(input: string, reminders: string[], images: RunOptions["images"] = [], attachments: string[] = []): ModelMessage {
  if (reminders.length === 0 && images.length === 0 && attachments.length === 0) return { role: "user", content: input }
  return {
    role: "user",
    content: [
      ...(reminders.length > 0 ? [{ type: "text" as const, text: `<${REMINDER_TAG}>\n${reminders.join("\n\n")}\n</${REMINDER_TAG}>` }] : []),
      { type: "text" as const, text: input },
      ...attachments.map((text) => ({ type: "text" as const, text })),
      ...images.map((i) => ({ type: "image" as const, image: i.data, mediaType: i.mediaType })),
    ],
  }
}

/**
 * Visible text of a user message, without reminder blocks or attached files (for UIs
 * rebuilding transcripts, and the auto-mode classifier: a file's content is not the user's).
 */
export function visibleUserText(message: ModelMessage) {
  if (message.role !== "user") return ""
  if (typeof message.content === "string") return message.content.startsWith(`<${REMINDER_TAG}>`) ? "" : message.content
  return message.content
    .filter((p) => p.type === "text" && !p.text.startsWith(`<${REMINDER_TAG}>`) && !isAttachmentText(p.text))
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
  /** Text and tool calls of the step running or last finished (the stop gate reads the final step). */
  stepText?: string
  stepTools?: string[]
  /** The SDK's unified finish reason of the last step (stop, length…). */
  finish?: string
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
  /** Images in tool results reach the model (Prepared.images), as in the tool set. */
  images = false,
): AsyncGenerator<AgentEvent> {
  const started = new Map<string, number>()
  // The turn's completed steps so far, kept so an abort or failure keeps work whose tools
  // already ran (closeDanglingToolCalls patches calls left without a result). They are
  // stored as the SDK's own response messages would be: tool results through the same
  // conversion as the tool set (text, images only for a model that sees them, never the
  // chart payload), errors cleaned, provider metadata (Gemini thought signatures) kept.
  let stepText = ""
  const stepCalls: Omit<ToolCallPart, "type">[] = []
  const stepResults: Omit<ToolResultPart, "type">[] = []
  const flushProgress = () => {
    if (stepCalls.length === 0 && stepResults.length === 0 && !stepText) return
    const content = [
      ...(stepText ? [{ type: "text" as const, text: stepText }] : []),
      ...stepCalls.map((c) => ({ type: "tool-call" as const, ...c })),
    ]
    if (content.length > 0) outcome.progress.push({ role: "assistant", content })
    if (stepResults.length > 0) outcome.progress.push({ role: "tool", content: stepResults.map((r) => ({ type: "tool-result" as const, ...r })) })
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
          outcome.stepText = ""
          outcome.stepTools = []
          break
        case "reasoning-delta":
          outcome.reasoned = true
          yield { type: "progress" }
          break
        case "finish-step": {
          flushProgress()
          outcome.rawFinish = part.rawFinishReason
          outcome.finish = part.finishReason
          const note = (part.providerMetadata?.google as { finishMessage?: unknown } | undefined)?.finishMessage
          outcome.finishMessage = typeof note === "string" && note.trim() ? note.trim().slice(0, 300) : undefined
          // Every finished step is one model request, usage reported or not (quota counts requests).
          yield { type: "step" }
          const input = part.usage?.inputTokens
          const output = part.usage?.outputTokens
          if (input === undefined && output === undefined) break
          outcome.usage = { input: (outcome.usage?.input ?? 0) + (input ?? 0), output: (outcome.usage?.output ?? 0) + (output ?? 0) }
          yield { type: "step-usage", inputTokens: input ?? 0, outputTokens: output ?? 0 }
          break
        }
        case "text-delta":
          outcome.text += part.text
          outcome.stepText = (outcome.stepText ?? "") + part.text
          stepText += part.text
          yield { type: "text-delta", text: part.text }
          break
        case "tool-call":
          outcome.stepTools = [...(outcome.stepTools ?? []), part.toolName]
          started.set(part.toolCallId, Date.now())
          stepCalls.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
            ...(part.providerMetadata ? { providerOptions: part.providerMetadata } : {}),
          })
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
          stepResults.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: ok ? keptOutput(part.output, images) : { type: "error-text", value: toolErrorText(describeError(part.error)) },
          })
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
  effort?: Effort
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
  const loaded = new Set([...loadedTools(opts.history ?? []), ...modeTools, ...(opts.preload ?? [])])
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
    desk: opts.desk,
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
    effort: opts.effort,
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
  const providerOptions = mergeProviderOptions(thoughtOptions(p.target), effortOptions(p.target, p.effort))
  return { system, request, model, active: activeFor(p.built, request), providerOptions }
}

/**
 * Gemini streams its thoughts only when asked (`includeThoughts`); otherwise a thinking model
 * sends nothing until it answers, which the stall timer and the subagent watchdog cannot tell
 * from a hung request. opencode asks for them on every Google reasoning model too
 * (provider/transform.ts). Thoughts are never shown; they only count as progress.
 */
export function thoughtOptions(target: TargetLike & { provider: { models: Record<string, { reasoning?: boolean }> } }) {
  const info = target.provider.models[target.model]
  const npm = info?.provider?.npm ?? target.provider.npm
  if (npm !== "@ai-sdk/google" || !info?.reasoning) return undefined
  return { google: { thinkingConfig: { includeThoughts: true } } }
}

/** Whether the request's tool set has `name` (a final tool the caller registered). */
function registryHas(built: BuiltToolSet | undefined, name: string) {
  return !!built && name in built.tools
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

/**
 * What the next step's request will hold: the last request and its answer as the provider
 * counted them, plus what came after that answer (its tool results). Undefined usage: 0.
 */
function stepSize(usage: LanguageModelUsage | undefined, messages: readonly ModelMessage[]) {
  if (usage?.inputTokens === undefined) return 0
  const answeredAt = messages.findLastIndex((m) => m.role === "assistant")
  return usage.inputTokens + (usage.outputTokens ?? 0) + tokensOf(messages.slice(answeredAt + 1))
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
  // The same effort as the conversation's turns (config `effort` unless the caller passes one).
  const configured = (await loadConfig()).effort
  const effort = opts.effort ?? (isEffort(configured) ? configured : undefined)
  for (let attempt = 0; ; attempt++) {
    const prepared = await prepare({ ...opts, effort, history: head, input: "" }, {})
    const { system, request, model, active, providerOptions } = requestFor(prepared, [...head, { role: "user", content: opts.prompt }])
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
        providerOptions,
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

  const config = await loadConfig()
  // The main agent's effort comes from config; a subagent's is resolved by its manager.
  if (opts.role !== "subagent" && opts.effort === undefined && isEffort(config.effort)) opts = { ...opts, effort: config.effort }
  const prepared = await prepare(opts, extras)
  const { target, tools, built, assembled, supportsTools } = prepared
  const configured = config.maxSteps
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

  const user = userMessage(opts.input, assembled.reminders, opts.images, opts.attachments)
  // A vision model's screenshots stay in history; a model without vision gets placeholders.
  const notices = new RetryNotices()
  // A request that streams nothing for a long time is stalled, not slow: cut it (LLM_STALL_MS).
  const stall = new AbortController()
  let stalled = false
  const stallMs = opts.stallMs ?? stallWindow()
  const abortSignal = opts.signal ? AbortSignal.any([opts.signal, stall.signal]) : stall.signal
  const onStall = () => {
    stalled = true
    stall.abort()
  }
  const { system, request, model, providerOptions } = requestFor(prepared, [...opts.history, user], notices.options)
  let summarized = false
  /** Tool results pruned mid-turn (undefined: not near the threshold). */
  let midTurnPruned: number | undefined
  /** Tokens the mid-turn prune keeps out of the last request; the history still holds them. */
  let midTurnSaved = 0
  const nudge = nudgeAfterTools(target)
  // Visible tools at the current step; deferred tools join once loaded (tool search).
  let active = activeFor(built, request)
  let loaded = loadedTools(request)
  // Steps used by earlier runs of this turn: a recovery run counts from 0 again, but the step
  // cap (and its forced summary) is for the whole turn.
  let stepsUsed = 0

  /** One streamText run over `base`; `rescue` is a nudge (never stored) on its first step. */
  const run = (base: ModelMessage[], rescue?: Rescue) =>
    streamText({
      model,
      instructions: system,
      messages: base,
      tools,
      // A step that answers and closes the todo list ends the turn: no request after it.
      stopWhen: [isStepCount(Math.max(1, maxSteps - stepsUsed)), answeredAndClosedTodos, ...(opts.finalTool ? [hasToolCall(opts.finalTool)] : [])],
      // Every step exposes what the conversation has loaded so far, so a tool found by
      // tool_search is callable at the very next step.
      // Last allowed step: keep tools declared (some providers reject tool history otherwise)
      // but forbid calling them, so the turn always ends with an answer.
      // Message overrides carry forward to later steps, so every step rebuilds its messages from
      // the request plus what the model and tools produced: a nudge stays a one-step addition.
      prepareStep: ({ stepNumber, steps, initialMessages, responseMessages }) => {
        const rescueNow = stepNumber === 0 ? rescue : undefined
        if (!tools) return rescueNow ? { messages: withNudge([...initialMessages, ...responseMessages], rescueNow.nudge) } : undefined
        // Clean before activeFor reads them: the model never sees the SDK's raw error strings.
        let messages = cleanToolErrors([...initialMessages, ...responseMessages])
        // Near the threshold mid-turn: prune old tool results, and keep doing so for the rest of
        // the turn (switching back would grow past it again and break the provider's cache).
        if (midTurnPruned === undefined && opts.compactAt !== undefined && stepSize(steps.at(-1)?.usage, messages) >= opts.compactAt) midTurnPruned = 0
        if (midTurnPruned !== undefined) {
          const tools = pruneToolResults(messages)
          const files = pruneAttachments(tools.messages, 0)
          midTurnPruned = Math.max(midTurnPruned, tools.pruned + files.pruned)
          midTurnSaved = Math.max(0, tokensOf(messages) - tokensOf(files.messages))
          messages = files.messages
        }
        active = activeFor(built, messages)
        loaded = loadedTools(messages)
        if (stepsUsed + stepNumber < maxSteps - 1) {
          const afterTool = messages.at(-1)?.role === "tool"
          // A route that rejects user words after tool results (nudgeAfterTools) gets the
          // rescue without its text: tools off still makes the model answer.
          const tail = rescueNow ? (afterTool && !nudge ? undefined : rescueNow.nudge) : nudge && afterTool ? toolNudge(messages) : undefined
          const choice = rescueNow?.toolChoice === "none" || (rescueNow && !tail) ? { toolChoice: "none" as const } : {}
          return { ...(active ? { activeTools: active } : {}), ...choice, messages: tail ? withNudge(messages, tail) : messages }
        }
        if (opts.finalTool && registryHas(built, opts.finalTool)) {
          const prompt = opts.finalPrompt ?? SUMMARY_PROMPT
          return { toolChoice: { type: "tool", toolName: opts.finalTool }, activeTools: [opts.finalTool], messages: withNudge(messages, prompt) }
        }
        summarized = true
        return { toolChoice: "none", activeTools: active, messages: withNudge(messages, SUMMARY_PROMPT) }
      },
      experimental_repairToolCall: async ({ toolCall, error }) => repairCall(opts.registry, built, active, loaded, toolCall, error),
      abortSignal,
      providerOptions,
      // The model is wrapped with retry.ts (by kind of failure, shown to the user, Esc
      // cancels the wait); the SDK's blind retry would repeat a daily-quota 429.
      maxRetries: 0,
      onError: () => {}, // errors are read from the stream
    })

  /** The whole turn: text and usage summed over its runs. */
  const outcome: Outcome = { text: "", aborted: false, steps: 0, progress: [] }
  /** Response messages kept so far (a recovered run's broken final step is dropped). */
  let kept: ModelMessage[] = []
  const recoveries: RecoveryKind[] = []
  let rescue: Rescue | undefined
  // The request whose usage measures the context (the last run).
  let measured: { steps: PromiseLike<{ usage: LanguageModelUsage }[]> } | undefined
  let messages: ModelMessage[] | undefined
  /** The stop gate gave up: the turn ends without an answer. */
  let unanswered = false

  for (;;) {
    const base = [...request, ...kept]
    const result = run(base, rescue)
    const last: Outcome = { text: "", aborted: false, steps: 0, progress: [] }
    yield* relay(result, opts.registry, opts.signal, last, notices, { ms: stallMs, onStall }, prepared.images)
    stepsUsed += last.steps
    outcome.text += last.text
    outcome.steps += last.steps
    outcome.reasoned ||= last.reasoned
    outcome.rawFinish = last.rawFinish
    outcome.finishMessage = last.finishMessage
    if (last.usage) outcome.usage = { input: (outcome.usage?.input ?? 0) + last.usage.input, output: (outcome.usage?.output ?? 0) + last.usage.output }
    outcome.aborted = last.aborted
    outcome.failure = last.failure
    if (stalled) {
      outcome.aborted = false
      outcome.failure = new Error(stallMessage(stallMs))
    }
    outcome.progress = [...kept, ...last.progress]
    if (outcome.aborted || outcome.failure) break
    let response: ModelMessage[]
    try {
      response = cleanToolErrors(await result.responseMessages)
    } catch (error) {
      outcome.failure = error
      break
    }
    measured = result

    // A run with a final tool is judged by its caller (the subagent manager forces the tool).
    const verdict: Verdict = opts.finalTool
      ? { action: "accept" }
      : judgeStop(
          {
            text: last.stepText ?? "",
            toolNames: last.stepTools ?? [],
            finish: last.finish,
            rawFinish: last.rawFinish,
            reasoned: last.reasoned,
            afterTools: [...base, ...response].findLast((m) => m.role !== "assistant")?.role === "tool",
          },
          recoveries,
        )
    // No step left for another run: the cap's summary step had the last word.
    const capped = stepsUsed >= maxSteps
    const continuing = recoveries.at(-1) === "length"
    if (verdict.action === "accept" || (verdict.action === "continue" && verdict.kind === "length" && capped)) {
      messages = continuing ? continueAnswer(kept, response) : [...kept, ...response]
      break
    }
    if (verdict.action === "continue" && !capped) {
      recoveries.push(verdict.kind)
      // A cut answer stays and the rest is joined onto it; any other broken step is dropped.
      kept = verdict.kind === "length" ? (continuing ? continueAnswer(kept, response) : [...kept, ...response]) : [...kept, ...dropFinalText(response)]
      rescue = { nudge: verdict.nudge, toolChoice: verdict.toolChoice }
      yield { type: "notice", text: `${RESCUE_NOTICE[verdict.kind]} Đã nhắc model trả lời tiếp (${recoveries.length}/${MAX_RECOVERIES}).` }
      continue
    }
    // Gave up: say why, and keep a placeholder so the session file shows what happened.
    unanswered = true
    const why = emptyReason(outcome)
    const reason = why ? ` Lý do từ provider: ${why}.` : ""
    const usedTools = [...kept, ...response].some((m) => m.role === "tool")
    yield {
      type: "notice",
      text: usedTools
        ? `Model không trả lời sau khi gọi tool (câu trả lời rỗng).${reason} Kết quả tool ở phía trên; thử hỏi lại hoặc đổi model.`
        : `Model trả về câu trả lời rỗng.${reason} Thử hỏi lại hoặc đổi model.`,
    }
    messages = [...kept, ...dropFinalText(response), { role: "assistant", content: `(không có câu trả lời${why ? ` — ${why}` : ""})` }]
    break
  }

  if (midTurnPruned) {
    yield {
      type: "notice",
      text: `Context gần ngưỡng tự nén giữa lượt: các bước sau gửi kèm ${midTurnPruned} kết quả tool cũ đã dọn. Lượt sau sẽ nén hội thoại.`,
    }
  }

  if (messages && !outcome.aborted && !outcome.failure) {
    // Echoed todo lines never reach history, so a later turn has nothing to imitate (29/10).
    messages = stripEchoMessages(messages)
    // Answered with items of this turn's list still open: retire the list (never mark them done
    // for the model) and say which ones stay unconfirmed. No request is spent on it.
    let retiredTodos = 0
    if (!unanswered) {
      const retired = retireLeftTodos([...opts.history, user], messages)
      retiredTodos = retired.left.length
      messages = retired.messages
      if (retired.left.length > 0) yield { type: "notice", text: retiredNote(retired.left) }
    }
    if (summarized) yield { type: "notice", text: `Đã dùng hết ${maxSteps} bước gọi tool; câu trả lời là bản tổng kết.` }
    const tokens = measured ? await lastStepTokens(measured) : undefined
    // Measured on the pruned request: add back what the history still holds, so the next
    // turn sees the real size and compacts.
    const usage =
      tokens !== undefined
        ? { contextTokens: tokens + midTurnSaved, estimated: false, total: outcome.usage }
        : { contextTokens: estimateRequest(system, [...request, ...messages], built?.tokens), estimated: true, total: outcome.usage }
    yield {
      type: "done",
      messages: [user, ...messages],
      clock: assembled.clock,
      usage,
      outcome: "completed",
      ...(recoveries.length > 0 ? { recoveries: recoveries.map((kind, i) => ({ kind, attempt: i + 1 })) } : {}),
      ...(unanswered ? { unanswered } : {}),
      ...(retiredTodos > 0 ? { retiredTodos } : {}),
    }
    if (opts.hooks) void opts.hooks.emit({ type: "turn-end", sessionId, messages: [user, ...messages] })
    return
  }

  if (outcome.failure && !outcome.aborted) {
    // A model that answered in prose where the final tool was required: the caller decides.
    const kind = stalled ? "stall" : ToolChoiceViolationError.isInstance(outcome.failure) ? "tool-choice" : classifyFailure(outcome.failure).kind
    yield { type: "error", message: describeError(outcome.failure), kind }
  }
  // Aborted or failed mid-turn: keep the steps whose tools already ran (closeDanglingToolCalls
  // closes any call left without a result, so providers still accept the history), then the
  // partial text. The user message keeps its reminders, so the clock it carried still counts
  // as sent.
  const text = outcome.text
  const progress = closeDanglingToolCalls(outcome.progress, "Tool bị ngắt vì lượt bị dừng giữa chừng.").messages
  // No square brackets: the markdown renderer read "[Đã dừng]" as a link. The closed steps
  // already carry their text, so the trailing note appears only when nothing else closes the
  // turn — a resumed session must not show a step's text twice.
  const marker = outcome.aborted ? "(đã dừng)" : "(lỗi)"
  const closing: ModelMessage[] =
    progress.length === 0 ? [{ role: "assistant", content: text || marker }] : progress.at(-1)!.role === "tool" ? [{ role: "assistant", content: marker }] : []
  yield {
    type: "done",
    messages: [user, ...progress, ...closing],
    clock: assembled.clock,
    usage: {
      contextTokens: estimateRequest(system, [...request, ...progress, ...closing], built?.tokens),
      estimated: true,
      total: outcome.usage,
    },
    outcome: outcome.aborted ? "aborted" : "failed",
  }
}
