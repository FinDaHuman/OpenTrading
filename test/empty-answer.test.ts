import { expect, test } from "bun:test"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { streamText } from "ai"
import { emptyReason } from "../src/core/agent"

/** A Gemini stream that ends with no text, the way an empty 11/10 answer may have looked. */
function geminiFetch(finishReason: string, finishMessage?: string) {
  const chunk = {
    candidates: [{ content: { role: "model", parts: [] }, finishReason, ...(finishMessage ? { finishMessage } : {}), index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
  }
  return (async () =>
    new Response(`data: ${JSON.stringify(chunk)}\n\n`, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch
}

test("Gemini's raw finish reason and finishMessage reach the finish-step part relay reads", async () => {
  const google = createGoogleGenerativeAI({ apiKey: "x", fetch: geminiFetch("UNEXPECTED_TOOL_CALL", "Unexpected tool call: web_search") })
  const result = streamText({ model: google("gemini-3.1-flash-lite"), prompt: "x", maxRetries: 0 })
  let raw: string | undefined
  let note: unknown
  for await (const part of result.stream) {
    if (part.type === "finish-step") {
      raw = part.rawFinishReason
      note = (part.providerMetadata?.google as { finishMessage?: unknown } | undefined)?.finishMessage
    }
  }
  expect(raw).toBe("UNEXPECTED_TOOL_CALL")
  expect(note).toBe("Unexpected tool call: web_search")
})

test("emptyReason names what the provider said, and stays quiet on a plain stop", () => {
  expect(emptyReason({ rawFinish: "UNEXPECTED_TOOL_CALL", finishMessage: "Unexpected tool call: web_search" })).toBe(
    "UNEXPECTED_TOOL_CALL — Unexpected tool call: web_search",
  )
  expect(emptyReason({ rawFinish: "MALFORMED_FUNCTION_CALL" })).toBe("MALFORMED_FUNCTION_CALL")
  expect(emptyReason({ rawFinish: "STOP", reasoned: true })).toBe("chỉ có phần suy luận, không có câu trả lời")
  expect(emptyReason({ rawFinish: "stop" })).toBeUndefined()
  expect(emptyReason({})).toBeUndefined()
})
