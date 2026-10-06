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
  const [first, ...rest] = result.output.split("\n")
  expect(first).toBe("Đã cập nhật việc cần làm: 1/3 xong.")
  expect(rest).toEqual(["[x] Lấy giá 30 phiên FPT", "[>] Lấy BCTC 4 quý", "[ ] So sánh với ngành", "[-] Bỏ phần vĩ mô"])
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
