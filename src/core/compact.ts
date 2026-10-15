import type { ModelMessage } from "ai"
import { estimateTokens } from "./prompt/budget"
import { loadedTools } from "./tools/loaded"
import { compactCarry, compactPair, isCompactMarker } from "./compact-marker"
import { LOADED_PREFIX } from "./tools/search"
import { currentTodos } from "./tools/todos"

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

/** Share of the (effective) context window at which the next turn compacts first. */
export const AUTO_COMPACT_SHARE = 0.8
/**
 * Effective window cap. Models now offer ~1M tokens, but every turn resends the whole
 * history (the user pays), answers degrade long before the limit, and old quotes go stale.
 * Claude Code and Codex let users cap it too. Config: `compactWindow`.
 */
export const DEFAULT_COMPACT_WINDOW = 200_000

export const effectiveWindow = (window: number | undefined, cap: number = DEFAULT_COMPACT_WINDOW) =>
  window ? Math.min(window, cap) : undefined

/** Provider wording for "the request does not fit the context window". */
const CONTEXT_OVERFLOW = /context (length|window)|too long|maximum context|token limit|too many tokens|prompt is too long/i
/** Quota and auth errors may mention tokens too; they are never a reason to retry. */
const NOT_OVERFLOW = /\b(429|401|403)\b|quota|rate.?limit|resource.?exhausted/i

export const isContextOverflow = (message: string) => CONTEXT_OVERFLOW.test(message) && !NOT_OVERFLOW.test(message)
/** After a compaction that stays above the threshold, wait for this much growth. */
export const RECOMPACT_GROWTH_SHARE = 0.1
/** Turns kept verbatim after the summary. */
export const KEEP_TURNS = 2
/** If the kept turns alone exceed this share of the window, keep one turn. */
const TAIL_MAX_SHARE = 0.25
/** Tool results shorter than this are not worth pruning. */
const PRUNE_MIN_CHARS = 500
/** Consecutive automatic failures before auto-compaction stops for the session. */
export const MAX_AUTO_FAILURES = 3

export const PRUNED_TEXT = "(đã dọn kết quả cũ để tiết kiệm context; gọi lại tool nếu cần số liệu này)"
/** Their results are small and carry state the harness or the model still needs. */
const PROTECTED = new Set(["todo_write", "load_skill", "ask_user"])

/** Phase 1 of analysis-first compaction (Claude Code pattern): before summarizing,
 * the model inventories the conversation structure into an <analysis> block —
 * tool-call counts, data series fetched, questions asked — so the summary (phase 2)
 * is built from the inventory instead of re-reading everything. Text only, no tools. */
export function compactAnalysisPrompt() {
  return [
    "Phân tích cấu trúc cuộc hội thoại ở trên để chuẩn bị tóm tắt. Chỉ trả lời bằng chữ, không gọi tool. Trả về đúng một khối <analysis> với các dòng:",
    "",
    "- tool: mỗi tool đã gọi và số lần (ví dụ: vn_quote_history x3).",
    "- du_lieu: chuỗi số liệu đã lấy (mã/kỳ/nguồn, ví dụ: HPG D 30 nến từ vn_quote_history).",
    "- cau_hoi: từng câu hỏi của người dùng, giữ sát lời gốc.",
    "- file_skill: file đã tạo/sửa, skill đã nạp.",
    "Không tóm tắt, không nhận định — chỉ kiểm kê.",
  ].join("\n")
}

/** Head this large gets the lean summary variant (drops the analysis section). */
export const COMPACT_LEAN_TOKENS = 100_000

export type CompactVariant = "full" | "lean"

/** Sent after the head when summarizing; the summary must stand in for everything above it. */
export function compactPrompt(instructions?: string, analysis?: string, variant: CompactVariant = "full") {
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
    "Tóm tắt toàn bộ cuộc hội thoại ở trên để tiếp tục làm việc mà không cần đọc lại nó. Chỉ trả lời bằng chữ, không gọi tool. Viết bằng ngôn ngữ của cuộc hội thoại. Giữ đúng các mục sau, mục nào không có thì ghi \"(không có)\":",
    "",
    ...(analysis?.trim()
      ? ["Khung phân tích đã có (dùng làm sườn, không tóm tắt lại nó):", `<analysis>\n${analysis.trim()}\n</analysis>`, ""]
      : []),
    ...sections,
    ...(instructions?.trim() ? ["", `Yêu cầu thêm của người dùng cho bản tóm tắt: ${instructions.trim()}`] : []),
  ].join("\n")
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
  /** Model context window; undefined → no auto threshold (manual only) and no tail cap. */
  window?: number
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

export async function compactHistory(history: readonly ModelMessage[], opts: CompactOptions): Promise<CompactResult> {
  const before = opts.contextTokens ?? tokensOf(history)
  const { messages: prunedMessages, pruned } = pruneToolResults(history)
  const afterPrune = scaled(before, history, prunedMessages)
  const base: CompactResult = { messages: prunedMessages, before, after: afterPrune, pruned }
  const threshold = opts.window ? opts.window * AUTO_COMPACT_SHARE : undefined
  if (!opts.manual && threshold !== undefined && afterPrune < threshold) return base

  const turns = splitTurns(prunedMessages)
  let keep = KEEP_TURNS
  if (opts.window && tokensOf(turns.slice(-keep).flat()) > opts.window * TAIL_MAX_SHARE) keep = 1
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
  const messages = [...compactPair(summary, carry), ...tail]
  return { messages, before, after: scaled(before, history, messages), pruned, summary }
}

/** Whether the next turn should compact first. */
export function shouldAutoCompact(opts: { contextTokens: number; window?: number; floor?: number; failures: number; disabled: boolean }) {
  if (opts.disabled || !opts.window || opts.failures >= MAX_AUTO_FAILURES) return false
  if (opts.contextTokens < opts.window * AUTO_COMPACT_SHARE) return false
  // Compacted already but still large: wait for real growth, or each turn would pay again.
  if (opts.floor !== undefined && opts.contextTokens < opts.floor + opts.window * RECOMPACT_GROWTH_SHARE) return false
  return true
}
