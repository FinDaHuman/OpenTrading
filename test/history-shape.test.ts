import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { answerAfterTools } from "../src/core/loop/history-shape"

const sig = { google: { thoughtSignature: "sig-1" } }
const call = (id = "c1", name = "todo_write") => ({ type: "tool-call" as const, toolCallId: id, toolName: name, input: {}, providerOptions: sig })
const result = (id = "c1", name = "todo_write"): ModelMessage => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: id, toolName: name, output: { type: "text", value: "ok" } }],
})
const roles = (messages: ModelMessage[]) => messages.map((m) => m.role)

/** Turn 1 of 30/10: the answer and the closing todo_write in one step, the turn ended there. */
const turn: ModelMessage[] = [
  { role: "user", content: "Phân tích 3 mã VCB, FPT, AAA" },
  {
    role: "assistant",
    content: [{ type: "reasoning", text: "nghĩ" }, { type: "text", text: "Dưới đây là phân tích…" }, call()],
  },
  result(),
]

test("an answer beside the turn's last call moves after the tool results, parts unchanged", () => {
  const out = answerAfterTools([...turn, { role: "user", content: "Đi sâu vào mã VCB" }])
  expect(roles(out)).toEqual(["user", "assistant", "tool", "assistant", "user"])
  // The call keeps its signature and the reasoning stays with it.
  expect(out[1]!.content).toEqual([{ type: "reasoning", text: "nghĩ" }, call()])
  expect(out[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "Dưới đây là phân tích…" }] })
})

test("history that ends on such a step (the last past turn) is reshaped too", () => {
  expect(roles(answerAfterTools(turn))).toEqual(["user", "assistant", "tool", "assistant"])
})

test("idempotent, and the input is not mutated", () => {
  const copy = structuredClone(turn)
  const once = answerAfterTools(turn)
  expect(answerAfterTools(once)).toEqual(once)
  expect(turn).toEqual(copy)
})

test("left alone: a call without text, a step in the middle of a turn, a text-only answer", () => {
  // A subagent's final tool (tra_ket_qua): nothing to move, nothing invented.
  const noText: ModelMessage[] = [{ role: "user", content: "x" }, { role: "assistant", content: [call("r", "tra_ket_qua")] }, result("r", "tra_ket_qua")]
  expect(answerAfterTools(noText)).toEqual(noText)
  // A preamble and a call followed by more steps: the tool result is not the turn's end.
  const middle: ModelMessage[] = [
    { role: "user", content: "x" },
    { role: "assistant", content: [{ type: "text", text: "Để mình lấy dữ liệu." }, call()] },
    result(),
    { role: "assistant", content: "Kết quả." },
  ]
  expect(answerAfterTools(middle)).toEqual(middle)
  // Whitespace is no answer.
  const blank: ModelMessage[] = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: "\n\n" }, call()] }, result()]
  expect(answerAfterTools(blank)).toEqual(blank)
  const plain: ModelMessage[] = [{ role: "user", content: "x" }, { role: "assistant", content: "Trả lời." }]
  expect(answerAfterTools(plain)).toEqual(plain)
})

test("a moved text drops only OpenAI's stored item id (sent as a plain message, not an item reference)", () => {
  const history: ModelMessage[] = [
    { role: "user", content: "x" },
    {
      role: "assistant",
      content: [{ type: "text", text: "Trả lời.", providerOptions: { openai: { itemId: "msg_1", phase: "final" }, other: { k: 1 } } }, call()],
    },
    result(),
  ]
  expect(answerAfterTools(history).at(-1)).toEqual({
    role: "assistant",
    content: [{ type: "text", text: "Trả lời.", providerOptions: { openai: { phase: "final" }, other: { k: 1 } } }],
  })
  const only: ModelMessage[] = [
    { role: "user", content: "x" },
    { role: "assistant", content: [{ type: "text", text: "Trả lời.", providerOptions: { openai: { itemId: "msg_1" } } }, call()] },
    result(),
  ]
  expect(answerAfterTools(only).at(-1)).toEqual({ role: "assistant", content: [{ type: "text", text: "Trả lời." }] })
})

test("every past turn is reshaped, the text keeps its own provider options", () => {
  const text = { type: "text" as const, text: "Trả lời 2.", providerOptions: { google: { thoughtSignature: "t" } } }
  const history: ModelMessage[] = [
    ...turn,
    { role: "user", content: "tiếp" },
    { role: "assistant", content: [text, call("c2")] },
    result("c2"),
  ]
  const out = answerAfterTools(history)
  expect(roles(out)).toEqual(["user", "assistant", "tool", "assistant", "user", "assistant", "tool", "assistant"])
  expect(out.at(-1)).toEqual({ role: "assistant", content: [text] })
})
