import type { ModelMessage } from "ai"
import { replaceBlocks } from "../redaction/redact"
import { memoryLines } from "./history-blocks"

/** What stands under a block's label in what the summary model reads (spec 007, data-model §4). */
export const LABELS_ONLY_NOTE = "(nội dung đã lược khỏi bản tóm tắt; đọc bằng memory_read)"

/**
 * The messages a summary is written from, with every memory block cut down to its label (spec 007 YC-001).
 * A summary is plain text with no label, so a delete could never mask what it copied; the summary model never
 * sees the content instead. Blocks are found exactly as the redaction finds them (history-blocks.ts): only in
 * the notebook's two channels, so a label the user typed or another tool returned is left as it is. Messages
 * with no block are the same objects as before.
 */
export function labelsOnly(messages: readonly ModelMessage[]): ModelMessage[] {
  const { blocks } = memoryLines(messages)
  if (blocks.length === 0) return [...messages]
  return replaceBlocks(
    messages,
    blocks.map((block) => ({ block, text: `${block.label}\n${LABELS_ONLY_NOTE}` })),
  )
}
