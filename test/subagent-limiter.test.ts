import { expect, test } from "bun:test"
import { Limiter } from "../src/core/subagents/limiter"
import { fmtTokens, formatResult, parseTrailer, stripTrailer } from "../src/core/subagents/result"
import { noticesMessage, notificationText, splitNotices } from "../src/core/subagents/notification"
import { pruneToolResults } from "../src/core/compact"
import type { ModelMessage } from "ai"

const tick = () => new Promise((r) => setTimeout(r, 0))

test("limiter: free slots start at once, the rest wait in FIFO order", async () => {
  const limiter = new Limiter(() => 2)
  const a = await limiter.acquire()
  const b = await limiter.acquire()
  const order: string[] = []
  const c = limiter.acquire().then((release) => (order.push("c"), release))
  const d = limiter.acquire().then((release) => (order.push("d"), release))
  await tick()
  expect(limiter.stats()).toEqual({ running: 2, waiting: 2, max: 2 })
  a()
  a() // releasing twice frees one slot only
  await tick()
  expect(order).toEqual(["c"])
  expect(limiter.stats()).toEqual({ running: 2, waiting: 1, max: 2 })
  b()
  await tick()
  expect(order).toEqual(["c", "d"])
  ;(await c)()
  ;(await d)()
  expect(limiter.stats()).toEqual({ running: 0, waiting: 0, max: 2 })
})

test("limiter: aborting while queued leaves the queue; an aborted signal never takes a slot", async () => {
  const limiter = new Limiter(() => 1)
  const held = await limiter.acquire()
  const controller = new AbortController()
  const waiting = limiter.acquire(controller.signal)
  await tick()
  expect(limiter.stats().waiting).toBe(1)
  controller.abort()
  await expect(waiting).rejects.toThrow("Đã huỷ.")
  expect(limiter.stats()).toEqual({ running: 1, waiting: 0, max: 1 })
  await expect(limiter.acquire(controller.signal)).rejects.toThrow("Đã huỷ.")
  held()
  expect(limiter.stats().running).toBe(0)
})

test("limiter: raising the limit lets waiters in; lowering it stops nobody; nonsense counts as 1", async () => {
  let max = 1
  const limiter = new Limiter(() => max)
  const first = await limiter.acquire()
  let second: (() => void) | undefined
  void limiter.acquire().then((r) => (second = r))
  await tick()
  expect(second).toBeUndefined()
  max = 3
  limiter.drain()
  await tick()
  expect(second).toBeDefined()
  max = 1
  limiter.drain()
  expect(limiter.stats().running).toBe(2)
  first()
  second!()
  max = 0
  expect(limiter.stats().max).toBe(1)
  max = Number.NaN
  expect(limiter.stats().max).toBe(1)
})

test("result: trailer round-trips, report survives without it, token counts read compactly", () => {
  const output = formatResult(
    { id: "ag-abc123", type: "nghien-cuu" },
    { status: "completed", text: "FPT ổn.", toolCount: 6, usage: { input: 15_000, output: 3_234 }, durationMs: 42_400 },
  )
  expect(output).toContain("Người dùng không thấy kết quả này")
  expect(parseTrailer(output)).toEqual({ agentId: "ag-abc123", type: "nghien-cuu", status: "xong", tools: 6, tokens: 18_234, seconds: 42 })
  expect(stripTrailer(output)).toBe("FPT ổn.")
  expect(parseTrailer("old output")).toBeUndefined()

  const failed = formatResult(
    { id: "ag-x", type: "nghien-cuu" },
    { status: "failed", text: "một phần", error: "429", toolCount: 1, usage: { input: 1, output: 1 }, durationMs: 1000 },
  )
  expect(failed).toStartWith("⚠ Subagent gặp lỗi giữa chừng: 429.")
  expect(parseTrailer(failed)?.status).toBe("lỗi")

  expect(fmtTokens(850)).toBe("850")
  expect(fmtTokens(12_345)).toBe("12,3k")
  expect(fmtTokens(18_000)).toBe("18k")
  expect(fmtTokens(123_456)).toBe("123k")
})

test("notifications: built from a view, split back out of a user message (resume, session title)", () => {
  const view = {
    id: "ag-abc123",
    type: "nghien-cuu",
    description: "Định giá FPT",
    prompt: "x",
    background: true,
    model: "Groq · m",
    status: "completed" as const,
    createdAt: 0,
    startedAt: 1_000,
    endedAt: 43_000,
    tools: [],
    toolCount: 6,
    usage: { input: 15_000, output: 3_234 },
    text: "FPT ổn.",
  }
  const one = notificationText(view)
  expect(one).toContain("<thong_bao_subagent>\nagent_id: ag-abc123 · loại: nghien-cuu · mô tả: Định giá FPT · trạng thái: xong")
  expect(one).toContain("<ket_qua>\nFPT ổn.\n</ket_qua>")
  expect(one).toContain("6 tool · 18.234 token · 42s")
  const failed = notificationText({ ...view, id: "ag-def456", status: "failed", error: "429", text: "" })
  const message = `${noticesMessage([one, failed])}\n\ncòn câu hỏi của tôi`
  const { notices, rest } = splitNotices(message)
  expect(notices).toEqual([
    { agentId: "ag-abc123", type: "nghien-cuu", description: "Định giá FPT", status: "xong", stats: "6 tool · 18.234 token · 42s" },
    { agentId: "ag-def456", type: "nghien-cuu", description: "Định giá FPT", status: "lỗi", stats: "6 tool · 18.234 token · 42s" },
  ])
  expect(rest).toBe("còn câu hỏi của tôi")
  expect(splitNotices(noticesMessage([one])).rest).toBe("")
})

test("pruning old tool results keeps a subagent's metadata block (its agent_id stays usable)", () => {
  const report = formatResult(
    { id: "ag-abc123", type: "nghien-cuu" },
    { status: "completed", text: "x".repeat(2_000), toolCount: 1, usage: { input: 1, output: 1 }, durationMs: 1_000 },
  )
  const turn = (n: number): ModelMessage[] => [
    { role: "user", content: `câu ${n}` },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "spawn_subagent", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: `c${n}`, toolName: "spawn_subagent", output: { type: "text", value: report } }] },
    { role: "assistant", content: "xong" },
  ]
  const { messages, pruned } = pruneToolResults([...turn(1), ...turn(2), ...turn(3)])
  expect(pruned).toBe(1)
  const value = JSON.stringify(messages[2])
  expect(value).not.toContain("xxxxxxxxxx")
  expect(value).toContain("agent_id: ag-abc123")
})
