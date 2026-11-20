import { expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText, type ModelMessage } from "ai"
import { withCacheMarks } from "../src/core/agent"

const history: ModelMessage[] = [
  { role: "user", content: "Giá FPT?" },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "quote", input: { s: "FPT" } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "quote", output: { type: "text", value: "FPT 120.000" } }] },
]

test("#333: the last two messages get a cache breakpoint; the history itself is unchanged", () => {
  const marked = withCacheMarks(history)
  expect(marked.map((m) => Boolean(m.providerOptions?.anthropic))).toEqual([false, true, true])
  expect(history.every((m) => m.providerOptions === undefined)).toBe(true)
})

test("#333: the Anthropic request carries system + 2 message breakpoints (within the limit of 4)", async () => {
  let body = ""
  const anthropic = createAnthropic({
    apiKey: "test",
    fetch: (async (_url: string, init: RequestInit) => {
      body = String(init.body)
      return new Response(
        JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-test", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
        { headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch,
  })
  const result = await generateText({
    model: anthropic("claude-test"),
    system: { role: "system", content: "SYSTEM", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
    messages: withCacheMarks(history),
  })
  expect(JSON.stringify(result.warnings ?? [])).not.toContain("cacheControl")
  expect(body.match(/"cache_control"/g)?.length).toBe(3)
  // The tool result (last message) carries one: the next step reads everything before it from cache.
  const sent = JSON.parse(body) as { messages: { content: { type: string; cache_control?: unknown }[] }[] }
  expect(sent.messages.at(-1)!.content.at(-1)!.cache_control).toEqual({ type: "ephemeral" })
})
