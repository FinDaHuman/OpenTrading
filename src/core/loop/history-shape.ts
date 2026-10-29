import type { AssistantModelMessage, ModelMessage } from "ai"

type AssistantPart = Exclude<AssistantModelMessage["content"], string>[number]

/**
 * Past turns never end on a tool result in what is sent. A turn may stop right after a step
 * that answered and called a tool (stop-gate.ts answeredAndClosedTodos: answer + closing
 * todo_write), so history holds assistant [answer, call] → tool → next user message. Gemini
 * gets the tool result and the new question in one user content (providers.ts
 * mergeGeminiTurns) and reads it as "after the tool": on 30/10 gemini-3.1-flash-lite answered
 * "Đi sâu vào mã VCB" with a fragment continuing its previous closing line (3/3), while
 * assistant [call] → tool → assistant [answer] → user worked (3/3).
 *
 * So the answer text of such a step moves after its tool results, unchanged: no part is
 * invented, and the calls keep their parts (Gemini signs the first call, never the moved
 * text; only the current turn's signatures are checked). Only for the request: the session
 * file keeps the streamed order. Callers pass past turns only, never the running turn.
 */
export function answerAfterTools(messages: readonly ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    const next = messages[i + 1]
    const prev = out.at(-1)
    const endsTurn = message.role === "tool" && (next === undefined || next.role === "user")
    if (!endsTurn || prev?.role !== "assistant" || typeof prev.content === "string") {
      out.push(message)
      continue
    }
    const parts: AssistantPart[] = prev.content
    const text = parts.filter((p) => p.type === "text")
    const rest = parts.filter((p) => p.type !== "text")
    if (!text.some((p) => p.text.trim()) || !rest.some((p) => p.type === "tool-call")) {
      out.push(message)
      continue
    }
    out[out.length - 1] = { ...prev, content: rest }
    out.push(message, { role: "assistant", content: text.map(plainText) })
  }
  return out
}

/**
 * OpenAI's Responses API sends a text part with a stored item id as a reference to that item;
 * moved away from the reasoning and call items it came with, the reference may be refused.
 * Without the id it is sent as a plain assistant message, which is always accepted.
 */
function plainText(part: Extract<AssistantPart, { type: "text" }>): Extract<AssistantPart, { type: "text" }> {
  const openai = part.providerOptions?.openai
  if (!openai || !("itemId" in openai)) return part
  const { itemId: _, ...kept } = openai
  const { openai: __, ...others } = part.providerOptions!
  const providerOptions = Object.keys(kept).length > 0 ? { ...others, openai: kept } : others
  return Object.keys(providerOptions).length > 0 ? { ...part, providerOptions } : { type: "text", text: part.text }
}
