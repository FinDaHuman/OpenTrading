import type { ModelMessage } from "ai"
import { estimateTokens } from "./prompt/budget"
import { loadedTools } from "./tools/loaded"
import { compactCarry, compactPair, isCompactMarker } from "./compact-marker"
import { LOADED_PREFIX } from "./tools/search"
import { currentTodos } from "./tools/todos"
import { attachmentAttrs, attachmentKey, attachmentsOf, clearedAttachment, withoutOrphanStubs } from "./mentions"

/**
 * Conversation compaction (Claude Code /compact, opencode compaction, Codex compact):
 *
 * 1. Prune: old tool results (outside the last turns) become a one-line placeholder. Free —
 *    no request — and usually the bulk of the history (price tables, statements).
 * 2. Summarize: if still too large (or the user asked), the model condenses everything but
 *    the last turns into a structured summary that keeps every sourced figure verbatim.
 *
 * The result replaces history: [compact marker (user), summary (assistant), …last turns].
 * The marker carries what the harness derives from history (loaded tools, loaded skills, the
 * open todo list), so those survive the head being dropped.
 */

/**
 * Room kept free under the window for the answer and the summary request (opencode
 * reserves min(output, 20k) too).
 */
export const SUMMARY_RESERVE = 20_000
/** Default `autoCompactPercent`: compact at this share of (window − reserve). */
export const DEFAULT_COMPACT_PERCENT = 95
export const MIN_COMPACT_PERCENT = 50
/** Above this there is no room left for one more turn of tool results before the hard limit. */
export const MAX_COMPACT_PERCENT = 95
/** Smallest `compactWindow` cap accepted: the system prompt and tools alone take ~15k. */
export const MIN_COMPACT_WINDOW = 20_000

export interface ContextLimits {
  /** Tokens a request may hold: models.dev `limit.input` (else `limit.context`), capped by `compactWindow`. */
  window: number
  /** Kept free for the answer / summary. */
  reserve: number
  /** Context size at which the next turn compacts first. */
  threshold: number
  /** `compactWindow` lowered the model's window. */
  capped: boolean
}

export const clampPercent = (percent: number | undefined) =>
  percent === undefined || !Number.isFinite(percent)
    ? DEFAULT_COMPACT_PERCENT
    : Math.min(MAX_COMPACT_PERCENT, Math.max(MIN_COMPACT_PERCENT, Math.round(percent)))

/**
 * The whole window of the model by default, as Claude Code, opencode and Codex do. Some
 * models accept less input than their context (GPT-5: 400k context, 272k input): the input
 * limit is what a request must fit. Config `compactWindow` caps it (Gemini's free tier
 * allows 250k input tokens a minute, so a larger request can never pass), and
 * `autoCompactPercent` moves the threshold. Undefined when the model's window is unknown.
 */
export function contextLimits(
  limit: { context?: number; input?: number; output?: number } | undefined,
  opts: { cap?: number; percent?: number } = {},
): ContextLimits | undefined {
  const raw = limit?.input || limit?.context
  if (!raw) return undefined
  const capped = opts.cap !== undefined && opts.cap > 0 && opts.cap < raw
  const window = capped ? opts.cap! : raw
  const reserve = Math.min(limit?.output || SUMMARY_RESERVE, SUMMARY_RESERVE, Math.floor(window / 4))
  const threshold = Math.floor(((window - reserve) * clampPercent(opts.percent)) / 100)
  return { window, reserve, threshold, capped }
}

/**
 * Provider wording for "the request does not fit the context window": ours, plus opencode's
 * list (packages/llm/src/provider-error.ts) — Gemini says "The input token count (…) exceeds
 * the maximum number of tokens allowed (…)", which none of ours matched.
 */
const CONTEXT_OVERFLOW = [
  /context (length|window)|too long|maximum context|token limit|too many tokens|prompt is too long/i,
  /request_too_large|request entity too large/i,
  /input token count.*exceeds the maximum/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /exceeded model token limit/i,
  /prompt has [\d,]+ tokens?, but the configured context size is/i,
]
/** Quota and auth errors may mention tokens too; they are never a reason to retry. */
const NOT_OVERFLOW = /\b(429|401|403)\b|quota|rate.?limit|resource.?exhausted|too many requests/i

export const isContextOverflow = (message: string) => CONTEXT_OVERFLOW.some((p) => p.test(message)) && !NOT_OVERFLOW.test(message)
/** After a compaction that stays above the threshold, wait for this much growth. */
export const RECOMPACT_GROWTH_SHARE = 0.1
/** Turns kept verbatim after the summary. */
export const KEEP_TURNS = 2
/** If the kept turns alone exceed this share of the window, keep one turn. */
const TAIL_MAX_SHARE = 0.25
/** Tool results shorter than this are not worth pruning. */
const PRUNE_MIN_CHARS = 500
/** Old @-attachments are cleared before a request once this many tokens would be saved. */
export const ATTACHMENT_PRUNE_TOKENS = 20_000
/** Consecutive automatic failures before auto-compaction stops for the session. */
export const MAX_AUTO_FAILURES = 3

export const PRUNED_TEXT = "(đã dọn kết quả cũ để tiết kiệm context; gọi lại tool nếu cần số liệu này)"
/** Their results are small and carry state the harness or the model still needs. */
const PROTECTED = new Set(["todo_write", "load_skill", "ask_user"])

/** Head this large gets the lean summary variant (drops the analysis section). */
export const COMPACT_LEAN_TOKENS = 100_000

export type CompactVariant = "full" | "lean"

/**
 * Sent after the head when summarizing; the summary must stand in for everything above it.
 * One request, as Claude Code's /compact does: the model first inventories
 * the conversation in an <analysis> scratchpad, then writes the <summary>;
 * {@link formatCompactSummary} keeps only the summary.
 */
export function compactPrompt(instructions?: string, variant: CompactVariant = "full") {
  const sections =
    variant === "lean"
      ? [
          "## Yêu cầu của người dùng",
          "Mục tiêu và từng yêu cầu, giữ sát lời gốc.",
          "## Số liệu đã xác minh",
          "Bảng: chỉ tiêu | giá trị | đơn vị | nguồn | thời điểm. Chép nguyên văn, không làm tròn. Số nào không có nguồn và thời điểm thì bỏ.",
          "## Việc đang dở và bước tiếp theo",
          "Việc chưa xong và việc nên làm tiếp.",
        ]
      : [
          "## Yêu cầu của người dùng",
          "Mục tiêu và từng yêu cầu của người dùng, giữ sát lời gốc.",
          "## Ràng buộc và sở thích",
          "Điều người dùng đã nói về khẩu vị rủi ro, khung thời gian, mã đang quan tâm, cách trình bày mong muốn.",
          "## Số liệu đã xác minh",
          "Bảng: chỉ tiêu | giá trị | đơn vị | nguồn | thời điểm. Chép nguyên văn từ kết quả tool, không làm tròn, không đổi đơn vị. Số nào không có nguồn và thời điểm thì bỏ.",
          "## Phân tích và kết luận đã đưa ra",
          "Các nhận định chính, giả định đi kèm, rủi ro đã nêu.",
          "## Việc đang dở và bước tiếp theo",
          "Việc chưa xong và việc nên làm tiếp nếu người dùng muốn.",
        ]
  return [
    "Tóm tắt toàn bộ cuộc hội thoại ở trên để tiếp tục làm việc mà không cần đọc lại nó. Chỉ trả lời bằng chữ, không gọi tool. Viết bằng ngôn ngữ của cuộc hội thoại.",
    "",
    "Trước hết viết một khối <analysis> ngắn để kiểm kê, không nhận định: mỗi tool đã gọi và số lần; chuỗi số liệu đã lấy (mã, kỳ, nguồn); từng câu hỏi của người dùng; skill đã nạp. Khối này chỉ là nháp và sẽ bị bỏ.",
    "Sau đó viết bản tóm tắt trong khối <summary>, giữ đúng các mục sau, mục nào không có thì ghi \"(không có)\":",
    "",
    ...sections,
    ...(instructions?.trim() ? ["", `Yêu cầu thêm của người dùng cho bản tóm tắt: ${instructions.trim()}`] : []),
  ].join("\n")
}

/**
 * The summary without the <analysis> scratchpad. A reply without the tags is taken whole;
 * an <analysis> that never closes means the reply was cut off (undefined).
 */
export function formatCompactSummary(text: string): string | undefined {
  const opened = text.indexOf("<analysis>")
  if (opened >= 0 && text.indexOf("</analysis>", opened) < 0) return undefined
  const withoutAnalysis = text.replace(/<analysis>[\s\S]*?<\/analysis>/g, "")
  const summary = /<summary>([\s\S]*?)(?:<\/summary>|$)/.exec(withoutAnalysis)
  const body = (summary ? summary[1]! : withoutAnalysis).trim()
  return body || undefined
}

const isRealUser = (m: ModelMessage) => m.role === "user"

/** Turns: each starts at a user message; tool calls and their results stay in one turn. */
export function splitTurns(messages: readonly ModelMessage[]): ModelMessage[][] {
  const turns: ModelMessage[][] = []
  for (const message of messages) {
    if (isRealUser(message) || turns.length === 0) turns.push([message])
    else turns.at(-1)!.push(message)
  }
  return turns
}

/** What one image costs (Anthropic: about 1.6k tokens for a 1092×1092 picture). */
export const IMAGE_TOKENS = 1600

/** Estimated size of messages; an image counts as IMAGE_TOKENS, not as its base64 text. */
export const tokensOf = (messages: readonly ModelMessage[]) => {
  let images = 0
  const text = JSON.stringify(messages, function (this: Record<string, unknown>, key, value) {
    // Only the base64 of an image part (user image, tool image-data/media/file), not any long "data".
    const imagePart = this.type === "image" || this.type === "image-data" || this.type === "media" || this.type === "file" || "mediaType" in this
    if (imagePart && (key === "image" || key === "data") && typeof value === "string" && value.length > 1000) {
      images++
      return ""
    }
    return value
  })
  return estimateTokens(text) + images * IMAGE_TOKENS
}

type ResultPart = { type: string; toolName?: string; output?: { type?: string; value?: unknown } }

function firstLine(output: ResultPart["output"]): string | undefined {
  const value = output?.value
  if (typeof value === "string") return value.split("\n", 1)[0]
  if (output?.type === "content" && Array.isArray(value)) {
    const text = (value as { type?: string; text?: string }[]).find((p) => p?.type === "text")?.text
    return text?.split("\n", 1)[0]
  }
  return undefined
}

/** Replace large tool results outside the last `keepTurns` turns with a placeholder. */
/** The `<subagent_meta>` block of a spawn_subagent result, if any. */
function subagentMeta(output: unknown): string | undefined {
  const value = (output as { value?: unknown } | undefined)?.value
  if (typeof value !== "string") return undefined
  return /<subagent_meta>[\s\S]*?<\/subagent_meta>/.exec(value)?.[0]
}

export function pruneToolResults(messages: readonly ModelMessage[], keepTurns = KEEP_TURNS): { messages: ModelMessage[]; pruned: number } {
  const turns = splitTurns(messages)
  const old = Math.max(0, turns.length - keepTurns)
  let pruned = 0
  const out = turns.flatMap((turn, index) => {
    if (index >= old) return turn
    return turn.map((message) => {
      if (message.role !== "tool") return message
      const content = message.content.map((part) => {
        const p = part as ResultPart
        if (p.type !== "tool-result" || (p.toolName && PROTECTED.has(p.toolName))) return part
        const size = JSON.stringify(p.output ?? "").length
        const head = firstLine(p.output)
        if (size < PRUNE_MIN_CHARS || head === PRUNED_TEXT) return part
        pruned++
        // The loaded-tools line is how later turns know which deferred tools are callable;
        // a subagent's metadata block keeps its agent_id reachable for send_message.
        const meta = subagentMeta(p.output)
        const value = head?.startsWith(LOADED_PREFIX) ? `${head}\n${PRUNED_TEXT}` : meta ? `${PRUNED_TEXT}\n${meta}` : PRUNED_TEXT
        const failed = p.output?.type === "error-text" || p.output?.type === "error-json"
        return { ...part, output: { type: failed ? "error-text" : "text", value } } as typeof part
      })
      return { ...message, content } as ModelMessage
    })
  })
  return { messages: out, pruned }
}

/** Skills whose body was loaded with load_skill (tool-call inputs, and an earlier compaction's list). */
function loadedSkills(messages: readonly ModelMessage[]): string[] {
  const names = new Set<string>()
  for (const m of messages) {
    if (isCompactMarker(m)) for (const name of compactCarry(m).skills) names.add(name)
    if (m.role !== "assistant" || typeof m.content === "string") continue
    for (const p of m.content) {
      if (p.type === "tool-call" && p.toolName === "load_skill") {
        const name = (p.input as { name?: unknown })?.name
        if (typeof name === "string") names.add(name)
      }
    }
  }
  return [...names]
}

export interface CompactOptions {
  /** Tokens of the last request (provider usage), or undefined to estimate. */
  contextTokens?: number
  /** The model's limits (contextLimits); undefined → no auto threshold (manual only) and no tail cap. */
  limits?: ContextLimits
  /** Manual /compact: summarize even below the threshold. */
  manual?: boolean
  instructions?: string
  /** Summarize the head (everything but the kept turns). Throws on failure. */
  summarize: (head: ModelMessage[], instructions?: string) => Promise<string>
  /** Called right before the summary request is sent (it costs one request). */
  onSummarize?: () => void
}

export interface CompactResult {
  messages: ModelMessage[]
  before: number
  after: number
  pruned: number
  summary?: string
  /** Why summarizing failed (pruning, if any, still applied). */
  error?: string
}

/** Scale the measured context by how much the history shrank (system and tools are unchanged). */
function scaled(before: number, from: readonly ModelMessage[], to: readonly ModelMessage[]) {
  const a = tokensOf(from)
  const b = tokensOf(to)
  const fixed = Math.max(0, before - a)
  return Math.round(fixed + b)
}

/**
 * Files attached with `@` (mentions.ts) outside the last `keepTurns` turns lose their content
 * (path, lines and mtime stay). Only when that saves at least `minTokens`: each rewrite of old
 * history costs the provider's prefix cache, so it is done in batches (opencode's
 * PRUNE_MINIMUM is 20k). `0` prunes whatever there is (compaction).
 */
export function pruneAttachments(messages: readonly ModelMessage[], minTokens = ATTACHMENT_PRUNE_TOKENS, keepTurns = KEEP_TURNS): { messages: ModelMessage[]; pruned: number } {
  const turns = splitTurns(messages)
  const old = turns.slice(0, Math.max(0, turns.length - keepTurns)).reduce((n, t) => n + t.length, 0)
  // A later "unchanged, see above" stub still points at this content: it stays.
  const stubbedAt = new Map<string, number>()
  messages.forEach((message, index) => {
    for (const text of attachmentsOf(message)) {
      const key = attachmentKey(text)
      if (key && attachmentAttrs(text)?.da_gui) stubbedAt.set(key, index)
    }
  })
  let pruned = 0
  let saved = 0
  const out = messages.map((message, index) => {
    if (index >= old || message.role !== "user" || typeof message.content === "string" || attachmentsOf(message).length === 0) return message
    const content = message.content.map((part) => {
      const cleared = part.type === "text" ? clearedAttachment(part.text) : undefined
      if (!cleared || part.type !== "text") return part
      if ((stubbedAt.get(attachmentKey(part.text) ?? "") ?? -1) > index) return part
      pruned++
      saved += estimateTokens(part.text) - estimateTokens(cleared)
      return { ...part, text: cleared }
    })
    return { ...message, content } as ModelMessage
  })
  if (pruned === 0 || saved < minTokens) return { messages: [...messages], pruned: 0 }
  return { messages: out, pruned }
}

/** Before a request: clear old attachments once they add up (pruneAttachments). */
export function pruneAttachmentsForRequest(history: readonly ModelMessage[], contextTokens: number | undefined) {
  const { messages, pruned } = pruneAttachments(history)
  if (pruned === 0) return undefined
  return { messages, pruned, contextTokens: contextTokens === undefined ? undefined : scaled(contextTokens, history, messages) }
}

export async function compactHistory(history: readonly ModelMessage[], opts: CompactOptions): Promise<CompactResult> {
  const before = opts.contextTokens ?? tokensOf(history)
  const tools = pruneToolResults(history)
  const files = pruneAttachments(tools.messages, 0)
  const prunedMessages = files.messages
  const pruned = tools.pruned + files.pruned
  const afterPrune = scaled(before, history, prunedMessages)
  const base: CompactResult = { messages: prunedMessages, before, after: afterPrune, pruned }
  if (!opts.manual && opts.limits && afterPrune < opts.limits.threshold) return base

  const turns = splitTurns(prunedMessages)
  let keep = KEEP_TURNS
  if (opts.limits && tokensOf(turns.slice(-keep).flat()) > opts.limits.window * TAIL_MAX_SHARE) keep = 1
  // Too short to summarize: worth saying only when the user asked.
  if (turns.length <= keep) return { ...base, error: opts.manual && turns.length > 0 ? "Hội thoại còn quá ngắn để tóm tắt." : undefined }
  const head = turns.slice(0, -keep).flat()
  const tail = turns.slice(-keep).flat()

  let summary: string
  opts.onSummarize?.()
  try {
    summary = (await opts.summarize(head, opts.instructions)).trim()
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
  if (!summary) return { ...base, error: "Model trả về bản tóm tắt rỗng." }

  const carry = {
    tools: loadedTools(history),
    skills: loadedSkills(head),
    todos: currentTodos(history),
  }
  // A kept "unchanged, see above" file stub may point into the summarized head.
  const messages = withoutOrphanStubs([...compactPair(summary, carry), ...tail])
  return { messages, before, after: scaled(before, history, messages), pruned, summary }
}

/** Whether the next turn should compact first. */
export function shouldAutoCompact(opts: { contextTokens: number; limits?: ContextLimits; floor?: number; failures: number; disabled: boolean }) {
  if (opts.disabled || !opts.limits || opts.failures >= MAX_AUTO_FAILURES) return false
  if (opts.contextTokens < opts.limits.threshold) return false
  // Compacted already but still large: wait for real growth, or each turn would pay again —
  // but no further than half the room left under (window − reserve): with a threshold near
  // the window, 10% of a 1M window would lie past the window itself.
  if (opts.floor !== undefined) {
    const room = opts.limits.window - opts.limits.reserve - opts.floor
    const growth = Math.min(opts.limits.window * RECOMPACT_GROWTH_SHARE, Math.max(0, room / 2))
    if (opts.contextTokens < opts.floor + growth) return false
  }
  return true
}
