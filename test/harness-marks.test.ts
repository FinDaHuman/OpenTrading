import { expect, test } from "bun:test"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createMistral } from "@ai-sdk/mistral"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText, type ModelMessage } from "ai"
import { HARNESS_OPTIONS } from "../src/core/tools/todos"

/** History whose last answer carries the harness's retire mark (todos.ts retireLeftTodos). */
const history: ModelMessage[] = [
  { role: "user", content: "phân tích VCB" },
  {
    role: "assistant",
    content: [{ type: "text", text: "VCB tốt." }],
    providerOptions: { [HARNESS_OPTIONS]: { retiredTodos: [{ content: "Kết luận", status: "in_progress" }] } },
  },
  { role: "user", content: "còn FPT?" },
]

function capture() {
  const bodies: string[] = []
  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } })
  }) as unknown as typeof globalThis.fetch
  return { bodies, fetch }
}

async function send(model: Parameters<typeof streamText>[0]["model"]) {
  const result = streamText({ model, messages: history, maxRetries: 0, onError: () => {} })
  for await (const _ of result.fullStream) {
    // drain
  }
}

test("the harness's own marks never reach a provider", async () => {
  const sent: string[] = []
  const via = async (make: (fetch: typeof globalThis.fetch) => Parameters<typeof streamText>[0]["model"]) => {
    const c = capture()
    await send(make(c.fetch))
    sent.push(...c.bodies)
  }
  await via((fetch) => createGoogleGenerativeAI({ apiKey: "x", fetch })("gemini-3.1-flash-lite"))
  await via((fetch) => createGroq({ apiKey: "x", fetch })("tooly"))
  await via((fetch) => createAnthropic({ apiKey: "x", fetch })("claude-x"))
  await via((fetch) => createOpenAI({ apiKey: "x", fetch })("gpt-x"))
  await via((fetch) => createMistral({ apiKey: "x", fetch })("mistral-x"))
  await via((fetch) => createOpenAICompatible({ name: "nv", baseURL: "https://x.test/v1", apiKey: "x", fetch })("m"))
  expect(sent.length).toBeGreaterThanOrEqual(6)
  for (const body of sent) {
    expect(body).toContain("VCB tốt.")
    expect(body).not.toContain(HARNESS_OPTIONS)
    expect(body).not.toContain("retiredTodos")
  }
})

test("a past turn reshaped by answerAfterTools (call, result, answer) is accepted by every provider's serializer", async () => {
  const { answerAfterTools } = await import("../src/core/loop/history-shape")
  const reshaped = answerAfterTools([
    { role: "user", content: "phân tích VCB" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "VCB tốt." },
        { type: "tool-call", toolCallId: "t1", toolName: "todo_write", input: { todos: [] } },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "todo_write", output: { type: "text", value: "ok" } }] },
    { role: "user", content: "còn FPT?" },
  ])
  const sent: string[] = []
  const via = async (make: (fetch: typeof globalThis.fetch) => Parameters<typeof streamText>[0]["model"]) => {
    const c = capture()
    const result = streamText({ model: make(c.fetch), messages: reshaped, maxRetries: 0, onError: () => {} })
    for await (const _ of result.fullStream) {
      // drain
    }
    sent.push(...c.bodies)
  }
  await via((fetch) => createGoogleGenerativeAI({ apiKey: "x", fetch })("gemini-3.1-flash-lite"))
  await via((fetch) => createGroq({ apiKey: "x", fetch })("tooly"))
  await via((fetch) => createAnthropic({ apiKey: "x", fetch })("claude-x"))
  await via((fetch) => createOpenAI({ apiKey: "x", fetch })("gpt-x"))
  await via((fetch) => createMistral({ apiKey: "x", fetch })("mistral-x"))
  await via((fetch) => createOpenAICompatible({ name: "nv", baseURL: "https://x.test/v1", apiKey: "x", fetch })("m"))
  expect(sent.length).toBeGreaterThanOrEqual(6)
  for (const body of sent) {
    expect(body.indexOf("todo_write")).toBeGreaterThan(-1)
    // Each serializer keeps the answer after the call and before the new question.
    expect(body.indexOf("VCB tốt.")).toBeGreaterThan(body.indexOf("todo_write"))
    expect(body.indexOf("còn FPT?")).toBeGreaterThan(body.indexOf("VCB tốt."))
  }
})

test("openai responses: a moved answer is sent as a plain message, not a reference to its stored item", async () => {
  const { answerAfterTools } = await import("../src/core/loop/history-shape")
  const reshaped = answerAfterTools([
    { role: "user", content: "phân tích VCB" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "VCB tốt.", providerOptions: { openai: { itemId: "msg_1" } } },
        { type: "tool-call", toolCallId: "t1", toolName: "todo_write", input: { todos: [] } },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "todo_write", output: { type: "text", value: "ok" } }] },
    { role: "user", content: "còn FPT?" },
  ])
  const c = capture()
  const result = streamText({ model: createOpenAI({ apiKey: "x", fetch: c.fetch })("gpt-x"), messages: reshaped, maxRetries: 0, onError: () => {} })
  for await (const _ of result.fullStream) {
    // drain
  }
  const body = c.bodies.join("")
  expect(body).toContain("VCB tốt.")
  expect(body).not.toContain("msg_1")
})
