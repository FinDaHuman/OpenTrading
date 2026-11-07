import type { ModelMessage } from "ai"
import { OPEN_TAG, stripCardBlocks, type RawCardBlock } from "./block"

/**
 * A turn's messages with every card block taken out of the assistant's text (spec 007 YC-017), on every turn,
 * cards on or off: a model that imitates a block never gets one into history. `last` is the block that ends
 * the final answer: the last message is the assistant's, has no tool call, and its last text part ends with
 * the only block of the turn. Messages nothing changed are the same objects.
 */
export function stripCardMessages(messages: readonly ModelMessage[]): { messages: ModelMessage[]; last?: RawCardBlock } {
  let blocks = 0
  let last: RawCardBlock | undefined
  const finalIndex = messages.length - 1
  const out = messages.map((message, index): ModelMessage => {
    if (message.role !== "assistant") return message
    const final = index === finalIndex
    if (typeof message.content === "string") {
      if (!message.content.includes(OPEN_TAG)) return message
      const r = stripCardBlocks(message.content)
      blocks += message.content.split(OPEN_TAG).length - 1
      if (final) last = r.last
      return { ...message, content: r.text || "(đã có câu trả lời)" }
    }
    const hasCall = message.content.some((p) => p.type === "tool-call")
    const lastText = message.content.findLastIndex((p) => p.type === "text")
    let changed = false
    const content = message.content.map((part, i) => {
      if (part.type !== "text" || !part.text.includes(OPEN_TAG)) return part
      const r = stripCardBlocks(part.text)
      blocks += part.text.split(OPEN_TAG).length - 1
      if (final && !hasCall && i === lastText) last = r.last
      changed = true
      return { ...part, text: r.text }
    })
    return changed ? ({ ...message, content } as ModelMessage) : message
  })
  // Two blocks in the turn, wherever they are: no card (design-v5 §6, one structure only).
  return { messages: out, last: blocks === 1 ? last : undefined }
}
