import { expect, test } from "bun:test"
import { z } from "zod"
import { AskBroker, formatAskResult } from "../src/core/ask"
import { askUserTool, AskUserInput } from "../src/core/tools/builtin/ask-user"
import { RwLock, runTool } from "../src/core/tools/wrap"

const ctx = (signal = new AbortController().signal) => ({ signal, callId: "call_q" })
const tick = () => new Promise((r) => setTimeout(r, 5))
const q = {
  questions: [
    {
      header: "Khung TG",
      question: "Bạn đầu tư trong bao lâu?",
      options: [{ label: "Dưới 1 năm" }, { label: "1–3 năm" }, { label: "Trên 3 năm" }],
    },
  ],
}

test("schema: 1–4 questions, 2–4 options, short header, no duplicates", () => {
  expect(AskUserInput.safeParse(q).success).toBe(true)
  expect(AskUserInput.safeParse({ questions: [] }).success).toBe(false)
  expect(AskUserInput.safeParse({ questions: [{ ...q.questions[0], options: [{ label: "x" }] }] }).success).toBe(false)
  expect(AskUserInput.safeParse({ questions: [{ ...q.questions[0], header: "một nhãn quá dài" }] }).success).toBe(false)
  expect(AskUserInput.safeParse({ questions: [q.questions[0], q.questions[0]] }).success).toBe(false)
  expect(AskUserInput.safeParse({ questions: [{ ...q.questions[0], options: [{ label: "a" }, { label: "a" }] }] }).success).toBe(false)
})

test("without a UI the model is told to ask in plain text", async () => {
  const tool = askUserTool(new AskBroker())
  const out = await runTool(tool, q, ctx(), new RwLock())
  expect(out.output).toContain("hỏi bằng một câu hỏi ngắn")
})

test("answers come back in Claude Code's format; declining tells the model to stop", async () => {
  const broker = new AskBroker()
  broker.interactive = true
  const tool = askUserTool(broker)
  const running = runTool(tool, q, ctx(), new RwLock())
  await tick()
  const head = broker.head()!
  expect(head.callId).toBe("call_q")
  expect(head.questions[0]!.header).toBe("Khung TG")
  broker.respond(head.id, { "Bạn đầu tư trong bao lâu?": "1–3 năm" })
  expect((await running).output).toBe('Người dùng đã trả lời: "Bạn đầu tư trong bao lâu?"="1–3 năm". Tiếp tục dựa trên các câu trả lời này.')

  const declined = runTool(tool, q, ctx(), new RwLock())
  await tick()
  broker.respond(broker.head()!.id, undefined)
  expect((await declined).output).toContain("Dừng lại và chờ")
})

test("waiting for an answer neither times the tool out nor blocks a write tool", async () => {
  const broker = new AskBroker()
  broker.interactive = true
  const lock = new RwLock()
  const question = runTool({ ...askUserTool(broker), timeoutMs: 30 }, q, ctx(), lock)
  await tick()
  // A write tool needs the exclusive lock: it must not wait behind the open question.
  const write = await runTool(
    { name: "ghi", description: "", input: z.object({}), readOnly: false, execute: async () => "đã ghi" },
    {},
    ctx(),
    lock,
  )
  expect(write.output).toBe("đã ghi")
  await new Promise((r) => setTimeout(r, 60)) // past the 30 ms timeout
  broker.respond(broker.head()!.id, { "Bạn đầu tư trong bao lâu?": "Trên 3 năm" })
  expect((await question).output).toContain("Trên 3 năm")
})

test("aborting the turn cancels the open question", async () => {
  const broker = new AskBroker()
  broker.interactive = true
  const controller = new AbortController()
  const running = runTool(askUserTool(broker), q, ctx(controller.signal), new RwLock()).catch((e: Error) => e.message)
  await tick()
  expect(broker.head()).toBeDefined()
  controller.abort()
  await running
  expect(broker.head()).toBeUndefined()
  expect(formatAskResult({ answered: false, reason: "cancelled" })).toBe("Lượt hỏi đã bị huỷ.")
})
