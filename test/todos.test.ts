import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { assemble } from "../src/core/prompt/assemble"
import { loadCalendar } from "../src/core/prompt/market-clock"
import { todoWriteTool } from "../src/core/tools/builtin/todo-write"
import { currentTodos, type Todo } from "../src/core/tools/todos"
import { runTool, RwLock } from "../src/core/tools/wrap"
import { visibleTodos } from "../src/tui/todo-panel"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
const run = (todos: Todo[]) => runTool(todoWriteTool(), { todos }, ctx(), new RwLock())
async function errorOf(todos: Todo[]) {
  try {
    await run(todos)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected todo_write to fail")
}

const LIST: Todo[] = [
  { content: "Lấy giá 30 phiên FPT", status: "completed" },
  { content: "Lấy BCTC 4 quý", status: "in_progress" },
  { content: "So sánh với ngành", status: "pending" },
  { content: "Bỏ phần vĩ mô", status: "cancelled" },
]

test("todo_write accepts a valid list and reports progress on the first line", async () => {
  const result = await run(LIST)
  // An instruction, not prose an answer could reuse (29/10), and no list to copy.
  expect(result.output.startsWith("[todo_write] Đã lưu (1/3 xong).")).toBe(true)
  expect(result.output).toContain("KHÔNG chép")
  expect(result.output).toContain("Làm tiếp: Lấy BCTC 4 quý.")
  expect(result.output).not.toContain("[x]")
  expect(todoWriteTool().summarize!({ todos: LIST })).toBe("Cập nhật việc cần làm (1/3 xong)")
})

test("todo_write rejects two in_progress items and duplicates with a fix-it message", async () => {
  const two = await errorOf([
    { content: "A", status: "in_progress" },
    { content: "B", status: "in_progress" },
  ])
  expect(two).toContain("chỉ để một việc đang làm")
  const dup = await errorOf([
    { content: "Lấy giá", status: "pending" },
    { content: "lấy giá ", status: "pending" },
  ])
  expect(dup).toContain("bị trùng")
  // An empty item fails the schema itself.
  expect(todoWriteTool().input.safeParse({ todos: [{ content: " ", status: "pending" }] }).success).toBe(false)
})

const call = (id: string, todos: unknown): ModelMessage => ({
  role: "assistant",
  content: [{ type: "tool-call", toolCallId: id, toolName: "todo_write", input: { todos } }],
})
const result = (id: string, error = false): ModelMessage => ({
  role: "tool",
  content: [
    { type: "tool-result", toolCallId: id, toolName: "todo_write", output: error ? { type: "error-text", value: "x" } : { type: "text", value: "ok" } },
  ],
})

test("currentTodos is the last accepted list in history; rejected calls are ignored", () => {
  const first: Todo[] = [{ content: "A", status: "in_progress" }]
  const bad = [
    { content: "A", status: "in_progress" },
    { content: "B", status: "in_progress" },
  ]
  const history: ModelMessage[] = [{ role: "user", content: "x" }, call("1", first), result("1"), call("2", bad), result("2", true)]
  expect(currentTodos(history)).toEqual(first)
  expect(currentTodos([])).toEqual([])
  expect(currentTodos([...history, call("3", []), result("3")])).toEqual([])
})

test("a list the model stops updating expires after two user turns (it belonged to an earlier question)", () => {
  const list: Todo[] = [{ content: "So sánh FPT, CMG", status: "in_progress" }]
  const turn = (text: string): ModelMessage[] => [
    { role: "user", content: text },
    { role: "assistant", content: "ok" },
  ]
  const written: ModelMessage[] = [{ role: "user", content: "so sánh" }, call("1", list), result("1")]
  expect(currentTodos(written)).toEqual(list) // recited on the next turn
  expect(currentTodos([...written, ...turn("tiếp")])).toEqual(list) // still in play
  expect(currentTodos([...written, ...turn("tiếp"), ...turn("giá VCB?")])).toEqual([]) // stale
  // Updating it keeps it alive.
  expect(currentTodos([...written, ...turn("tiếp"), { role: "user", content: "tiếp nữa" }, call("2", list), result("2")])).toEqual(list)
})

test("open todos are recited in the turn's reminder; a finished list is not", () => {
  const base = {
    tier: "B" as const,
    tools: ["todo_write"],
    skills: [],
    sticky: [],
    input: "tiếp",
    now: new Date("2026-09-28T10:00:00+07:00"),
    calendar: loadCalendar(),
  }
  const open = assemble({ ...base, todos: LIST })
  const block = open.reminders.find((r) => r.startsWith("<viec_can_lam>"))
  expect(block).toContain("[>] Lấy BCTC 4 quý")
  expect(open.system).not.toContain("viec_can_lam") // reminders never touch the cached system prompt
  const done = assemble({ ...base, todos: [{ content: "A", status: "completed" }] })
  expect(done.reminders.some((r) => r.startsWith("<viec_can_lam>"))).toBe(false)
  // Without the tool there is nothing to recite.
  expect(assemble({ ...base, tools: [], todos: LIST }).reminders.some((r) => r.startsWith("<viec_can_lam>"))).toBe(false)
})

test("the panel shows at most 6 rows: doing and waiting first, in the model's order", () => {
  const many: Todo[] = Array.from({ length: 9 }, (_, i) => ({ content: `V${i}`, status: i < 5 ? "completed" : i === 5 ? "in_progress" : "pending" }))
  const { items, hidden } = visibleTodos(many)
  expect(items.map((t) => t.content)).toEqual(["V0", "V5", "V6", "V7", "V8"])
  expect(hidden).toBe(4)
  expect(visibleTodos(LIST)).toEqual({ items: LIST, hidden: 0 })
})

test("an answer that leaves this turn's list open retires it: items unconfirmed, never marked done", async () => {
  const { retireLeftTodos, harnessMarks } = await import("../src/core/tools/todos")
  const list: Todo[] = [
    { content: "Lấy dữ liệu 3 mã", status: "completed" },
    { content: "Phân tích", status: "in_progress" },
    { content: "Kết luận", status: "pending" },
  ]
  const history: ModelMessage[] = [{ role: "user", content: "phân tích VCB, FPT, AAA" }]
  const turn: ModelMessage[] = [call("1", list), result("1"), { role: "assistant", content: "VCB tốt." }]
  const { messages, left } = retireLeftTodos(history, turn)
  expect(left).toEqual(list.slice(1))
  expect(harnessMarks(messages.at(-1)!).retiredTodos).toEqual(list.slice(1))
  // Not recited or pinned any more, and nothing claims the open items were done.
  expect(currentTodos([...history, ...messages])).toEqual([])
  expect(JSON.stringify(messages)).not.toContain('"status":"completed","content":"Phân tích"')
  // A closed list, or a list from an earlier turn the model did not touch, is left alone.
  const closed = list.map((t) => ({ ...t, status: "completed" as const }))
  expect(retireLeftTodos(history, [call("2", closed), result("2"), { role: "assistant", content: "Xong." }]).left).toEqual([])
  const earlier: ModelMessage[] = [...history, call("3", list), result("3"), { role: "assistant", content: "a" }, { role: "user", content: "giá VCB?" }]
  const untouched = retireLeftTodos(earlier, [{ role: "assistant", content: "57.200đ" }])
  expect(untouched.left).toEqual([])
  expect(harnessMarks(untouched.messages[0]!).retiredTodos).toBeUndefined()
})

test("the nudge names the running item once the list is two steps behind", async () => {
  const { toolNudge } = await import("../src/core/agent")
  const list: Todo[] = [{ content: "Lấy dữ liệu 3 mã", status: "in_progress" }, { content: "Kết luận", status: "pending" }]
  const step = (id: string): ModelMessage[] => [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: id, toolName: "current_time", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "current_time", output: { type: "text", value: "x" } }] },
  ]
  const base: ModelMessage[] = [{ role: "user", content: "x" }, call("1", list), result("1")]
  expect(toolNudge([...base, ...step("a")])).not.toContain("bước chưa cập nhật")
  expect(toolNudge([...base, ...step("a"), ...step("b")])).toContain('Đã 2 bước chưa cập nhật danh sách: nếu dữ liệu cho "Lấy dữ liệu 3 mã"')
})

test("a retired list is shown again on resume and in /export: the items stay unconfirmed", async () => {
  const { retireLeftTodos } = await import("../src/core/tools/todos")
  const { transcriptFromMessages } = await import("../src/core/session/transcript")
  const list: Todo[] = [{ content: "Kết luận", status: "in_progress" }]
  const { messages } = retireLeftTodos([{ role: "user", content: "x" }], [call("1", list), result("1"), { role: "assistant", content: "VCB tốt." }])
  const notes = transcriptFromMessages([{ role: "user", content: "x" }, ...messages]).filter((i) => i.kind === "note")
  expect(notes).toEqual([{ kind: "note", text: expect.stringContaining("[>] Kết luận") }])
  expect(notes[0]!.kind === "note" && notes[0]!.text).toContain("CHƯA được xác nhận là xong")
})
