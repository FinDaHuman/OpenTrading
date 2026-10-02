/**
 * Long-session compaction (OpenCode v1 formula, anchored summary with three finance sections).
 * Pure planning and input preparation: the agent loop decides when to call it and owns the model call.
 * The summary never contains memory content (only ids) and never restricted data, so purging a memory stays
 * effective after compaction; the originals stay in the session store.
 */

export const SUMMARY_SECTIONS = [
  "Mục tiêu",
  "Chỉ dẫn của user",
  "Phát hiện",
  "Việc đã làm",
  "Tài liệu/artifact liên quan",
  "Ràng buộc đang áp dụng",
  "Số liệu quan trọng kèm nguồn",
  "Bằng chứng đã dùng",
] as const

export interface CompactionLimits {
  /** Model context window in tokens. */
  context: number
  /** Model output limit in tokens, if known. */
  output?: number
}

export interface CompactionSettings {
  outputReserveMax: number
  tailMin: number
  tailMax: number
  summaryMaxTokens: number
  toolOutputMaxChars: number
}

export const DEFAULT_COMPACTION: CompactionSettings = {
  outputReserveMax: 20_000,
  tailMin: 2_000,
  tailMax: 15_000,
  summaryMaxTokens: 4_096,
  toolOutputMaxChars: 2_000,
}

export const reservedTokens = (limits: CompactionLimits, s = DEFAULT_COMPACTION) =>
  Math.min(s.outputReserveMax, limits.output ?? s.outputReserveMax)

/** Compact when the request would leave less than the output reserve free. */
export const shouldCompact = (tokens: number, limits: CompactionLimits, s = DEFAULT_COMPACTION) =>
  tokens >= limits.context - reservedTokens(limits, s)

/** Recent history kept verbatim: a quarter of the usable window, clamped. */
export function tailBudget(limits: CompactionLimits, s = DEFAULT_COMPACTION): number {
  const usable = Math.max(0, limits.context - reservedTokens(limits, s))
  return Math.min(s.tailMax, Math.max(s.tailMin, Math.floor(usable * 0.25)))
}

export interface HistoryEntry {
  seq: number
  role: "user" | "assistant" | "tool"
  text: string
  /** Estimated tokens; ceil(utf8 bytes / 4) when absent. */
  tokens?: number
  /** Ids of memories rendered into this entry (audit refs); used to describe memory without its content. */
  memoryIds?: string[]
  /** Entry derived from restricted data the user enabled for one turn: never summarized. */
  restricted?: boolean
}

export const estimate = (e: HistoryEntry) => e.tokens ?? Math.ceil(Buffer.byteLength(e.text, "utf8") / 4)

export interface CompactionPlan {
  /** Entries to summarize, oldest first. */
  head: HistoryEntry[]
  /** Entries kept verbatim after the summary. */
  tail: HistoryEntry[]
  /** Source sequences the summary must reference (INV-8). */
  sourceSeqs: number[]
}

/**
 * Split history into a head to summarize and a verbatim tail of about `tailBudget` tokens. The tail never starts
 * with a tool result, so a tool call and its result are never separated.
 */
export function planCompaction(
  entries: readonly HistoryEntry[],
  limits: CompactionLimits,
  s = DEFAULT_COMPACTION,
): CompactionPlan {
  const budget = tailBudget(limits, s)
  let start = entries.length
  let used = 0
  while (start > 0 && used + estimate(entries[start - 1]!) <= budget) {
    start--
    used += estimate(entries[start]!)
  }
  while (start < entries.length && entries[start]!.role === "tool") start++
  const head = entries.slice(0, start)
  return { head, tail: entries.slice(start), sourceSeqs: head.map((e) => e.seq) }
}

const MEMORY_BLOCK = /<(memory_context|memory_scoped)>[\s\S]*?<\/\1>/g

/**
 * Text handed to the compaction model: memory blocks become id lists, tool outputs are cut, restricted entries are
 * left out entirely. Returns the text and the source sequences it covers.
 */
export function compactionInput(
  head: readonly HistoryEntry[],
  s = DEFAULT_COMPACTION,
): { text: string; sourceSeqs: number[] } {
  const lines: string[] = []
  const seqs: number[] = []
  for (const e of head) {
    if (e.restricted) continue
    seqs.push(e.seq)
    let text = e.text.replace(MEMORY_BLOCK, () => `[memory: ${(e.memoryIds ?? []).join(", ") || "đã dùng"}]`)
    if (e.role === "tool" && text.length > s.toolOutputMaxChars)
      text = `${text.slice(0, s.toolOutputMaxChars)}\n[… đã cắt]`
    lines.push(`#${e.seq} ${e.role}: ${text}`)
  }
  return { text: lines.join("\n\n"), sourceSeqs: seqs }
}

/** Instructions for the compaction model: fixed headings, constraints verbatim, every figure with an evidence id. */
export function summaryInstructions(pinned: readonly string[], s = DEFAULT_COMPACTION): string {
  const constraints = pinned.length
    ? `Chép NGUYÊN VĂN từng ràng buộc sau vào mục "Ràng buộc đang áp dụng", ` +
      `mỗi ràng buộc một dòng bắt đầu bằng "- ":\n${pinned.map((p) => `- ${p}`).join("\n")}`
    : `Mục "Ràng buộc đang áp dụng" ghi "- (không có)" nếu không có ràng buộc.`
  return [
    `Tóm tắt phần hội thoại dưới đây, tối đa khoảng ${s.summaryMaxTokens} token, ` +
      `theo đúng các mục (tiêu đề "## <tên mục>"):`,
    SUMMARY_SECTIONS.map((h) => `## ${h}`).join("\n"),
    constraints,
    `Trong mục "Số liệu quan trọng kèm nguồn", mỗi dòng có con số phải kèm mã bằng chứng dạng [ev:<id>] ` +
      `đã xuất hiện trong hội thoại. Không có nguồn thì không ghi con số.`,
    "Không chép nội dung memory; chỉ giữ tham chiếu [memory: …].",
  ].join("\n\n")
}

export interface SummaryEvent {
  kind: "context.summary.created"
  summary: string
  sourceSeqs: number[]
  repaired: boolean
}
