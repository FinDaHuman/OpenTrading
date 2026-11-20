import { expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText, jsonSchema, stepCountIs, tool, wrapLanguageModel, type ModelMessage } from "ai"
import { anthropicCacheMiddleware, withCacheMarks } from "../src/core/agent"

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

test("#333: across the steps of one turn the breakpoint follows the end of each step's prompt; never more than 4", async () => {
  const bodies: { messages: { role: string; content: { type: string; cache_control?: unknown }[] }[] }[] = []
  const anthropic = createAnthropic({
    apiKey: "test",
    fetch: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      // Step 1 calls the tool, step 2 answers.
      const content = bodies.length === 1 ? [{ type: "tool_use", id: `t${bodies.length}`, name: "quote", input: { s: "FPT" } }] : [{ type: "text", text: "FPT 120.000" }]
      return new Response(
        JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-test", content, stop_reason: bodies.length === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
        { headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch,
  })
  await generateText({
    model: wrapLanguageModel({ model: anthropic("claude-test"), middleware: anthropicCacheMiddleware() }),
    system: { role: "system", content: "SYSTEM", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
    messages: [{ role: "user", content: "Giá FPT?" }],
    tools: { quote: tool({ inputSchema: jsonSchema({ type: "object", properties: { s: { type: "string" } } }), execute: async () => "FPT 120.000" }) },
    stopWhen: stepCountIs(2),
  })
  expect(bodies).toHaveLength(2)
  const marks = (b: (typeof bodies)[number]) => JSON.stringify(b).match(/"cache_control"/g)?.length ?? 0
  for (const b of bodies) expect(marks(b)).toBeLessThanOrEqual(4)
  // Step 2's prompt ends with the tool result: that is where its breakpoint is, so step 3 would read all of it.
  const last = bodies[1]!.messages.at(-1)!
  expect(last.content.at(-1)!.cache_control).toEqual({ type: "ephemeral" })
  expect(last.content.at(-1)!.type).toBe("tool_result")
})
