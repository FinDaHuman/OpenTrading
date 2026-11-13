import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import {
  classifyOutcome,
  FAILURE_STREAK_NUDGE,
  failureNudge,
  gapsLine,
  turnFailures,
} from "../src/core/loop/failures"
import { blockedMessage, deniedMessage } from "../src/core/permission"
import { SOURCE_FAILED_PREFIX } from "../src/core/tools/outcome"
import { LOADED_PREFIX } from "../src/core/tools/search"
import { ToolTimeoutError } from "../src/core/tools/wrap"

type Call = { tool: string; input?: object; error?: string; text?: string }

const FAILED_SOURCE = `${SOURCE_FAILED_PREFIX} x: nguồn lỗi.\n{}`
const DOWN = 'MCP server "ot" lỗi tạm thời (HTTP 502) — có thể đang khởi động lại hoặc quá tải. Đã thử lại 2 lần.'

let id = 0
/** One step: its calls, and their results in one tool message. */
function step(...calls: Call[]): ModelMessage[] {
  const ids = calls.map(() => `c${++id}`)
  return [
    { role: "assistant", content: calls.map((c, i) => ({ type: "tool-call" as const, toolCallId: ids[i]!, toolName: c.tool, input: c.input ?? {} })) },
    {
      role: "tool",
      content: calls.map((c, i) => ({
        type: "tool-result" as const,
        toolCallId: ids[i]!,
        toolName: c.tool,
        output: c.error !== undefined ? { type: "error-text" as const, value: c.error } : { type: "text" as const, value: c.text ?? "ok" },
      })),
    },
  ]
}

const turn = (...steps: ModelMessage[][]): ModelMessage[] => [{ role: "user", content: "câu hỏi" }, ...steps.flat()]

test("every failure the harness writes gets its class", () => {
  const cases: [string, ReturnType<typeof classifyOutcome>][] = [
    [`${LOADED_PREFIX}mcp__ot__x\nTool mcp__ot__x chưa có trong bước này nên chưa chạy`, "deferred"],
    ["AI_ToolCallRepairError: Error repairing tool call: Error: Tool \"x\" chưa được nạp: gọi tool_search", "deferred"],
    ["Tham số không hợp lệ cho x:\n- f: thiếu (bắt buộc)", "invalid-call"],
    ['Không có tool "x".', "invalid-call"],
    ["Đã huỷ.", "aborted"],
    ["Tool bị ngắt vì lượt bị dừng giữa chừng.", "aborted"],
    ['MCP server "ot" đã hết quota trong ngày; không tự thử lại.', "quota"],
    ['MCP server "ot" bị giới hạn tốc độ (HTTP 429). Server yêu cầu chờ 45 giây trước khi gọi lại.', "rate-limited"],
    [new ToolTimeoutError("x", 60_000).message, "timeout"],
    ["MCP error -32001: Request timed out", "timeout"],
    [DOWN, "transport"],
    ['MCP server "ot" đang lỗi kết nối liên tiếp nên lần gọi này chưa được gửi đi.', "transport"],
    ['MCP server "ot" chưa kết nối: x. Xem /mcp.', "transport"],
    ["Error executing tool x: boom", "tool-error"],
  ]
  for (const [text, outcome] of cases) expect([text, classifyOutcome(false, text)]).toEqual([text, outcome])
  expect(classifyOutcome(true, "giá 98.5")).toBe("ok")
  expect(classifyOutcome(true, FAILED_SOURCE)).toBe("source-unavailable")
})

test("every denial counts as a denial, even when its words sound like another failure", () => {
  const texts = [
    deniedMessage({ allow: false, reason: "user" } as never),
    deniedMessage({ allow: false, reason: "cancelled" } as never),
    deniedMessage({ allow: false, reason: "rule" } as never),
    deniedMessage({ allow: false, reason: "blocked", message: "quá thời gian" } as never),
    deniedMessage({ allow: false, reason: "headless" } as never),
    blockedMessage("shell", { reason: "fetch failed" }),
  ]
  for (const text of texts) expect([text, classifyOutcome(false, text)]).toEqual([text, "denied"])
})

test("a failed source or connection is a gap; a repeat that works clears it", () => {
  const a = { tool: "mcp__ot__a", input: { s: "FPT" } }
  const b = { tool: "mcp__ot__b" }
  const messages = turn(step({ ...a, text: FAILED_SOURCE }, { ...b, error: DOWN }), step({ ...a, input: { s: "FPT" } }))
  expect(turnFailures(messages).gaps).toEqual(["b"])
})

test("an alternative the server named clears the gap once it works, in any order", () => {
  const failed = `${SOURCE_FAILED_PREFIX} a: lỗi. Gọi b ngay ở bước kế tiếp. Nếu vẫn không có, báo phần còn thiếu.\n{}\n[Nguồn: MCP ot]`
  expect(turnFailures(turn(step({ tool: "mcp__ot__a", text: failed }), step({ tool: "mcp__ot__b" }))).gaps).toEqual([])
  expect(turnFailures(turn(step({ tool: "mcp__ot__b" }, { tool: "mcp__ot__a", text: failed }))).gaps).toEqual([])
  expect(turnFailures(turn(step({ tool: "mcp__ot__a", text: failed }), step({ tool: "mcp__ot__c" }))).gaps).toEqual(["a"])
  expect(turnFailures(turn(step({ tool: "mcp__ot__a", text: failed }), step({ tool: "mcp__ot__b", error: DOWN }))).gaps).toEqual(["a", "b"])
})

test("the same tool with other arguments does not clear a gap", () => {
  const messages = turn(step({ tool: "mcp__ot__a", input: { s: "FPT" }, error: DOWN }), step({ tool: "mcp__ot__a", input: { s: "VCB" } }))
  expect(turnFailures(messages).gaps).toEqual(["a"])
})

test("a repeat with its keys in another order is the same call", () => {
  const messages = turn(step({ tool: "mcp__ot__a", input: { x: 1, y: 2 }, error: DOWN }), step({ tool: "mcp__ot__a", input: { y: 2, x: 1 } }))
  expect(turnFailures(messages).gaps).toEqual([])
})

test("only lost data is a gap: bad arguments, denials, loads and local tools are not", () => {
  const messages = turn(
    step(
      { tool: "mcp__ot__a", error: "Tham số không hợp lệ cho a:\n- f: thiếu" },
      { tool: "mcp__ot__b", error: `${LOADED_PREFIX}mcp__ot__b` },
      { tool: "mcp__ot__c", error: "Người dùng từ chối chạy tool này." },
      { tool: "shell", error: new ToolTimeoutError("shell", 1_000).message },
    ),
  )
  expect(turnFailures(messages).gaps).toEqual([])
})

test("a web read that failed is a gap too", () => {
  expect(turnFailures(turn(step({ tool: "web_fetch", error: "Hết thời gian chờ phản hồi." }))).gaps).toEqual(["web_fetch"])
})

test("only the last turn counts", () => {
  const earlier = turn(step({ tool: "mcp__ot__old", error: DOWN }))
  expect(turnFailures([...earlier, { role: "assistant", content: "x" }, ...turn(step({ tool: "mcp__ot__a" }))]).gaps).toEqual([])
})

test("a gap on several arguments of one tool is named once", () => {
  const messages = turn(step({ tool: "mcp__ot__a", input: { s: 1 }, error: DOWN }, { tool: "mcp__ot__a", input: { s: 2 }, error: DOWN }))
  expect(turnFailures(messages).gaps).toEqual(["a"])
})

test("the streak counts failed steps in a row, whatever the calls were", () => {
  const bad = (n: number) => step({ tool: `mcp__ot__t${n}`, input: { n }, error: "Tham số không hợp lệ cho x:\n- f: thiếu" })
  expect(turnFailures(turn(bad(1), bad(2), bad(1), bad(2))).streak).toBe(4)
  expect(turnFailures(turn(bad(1), step({ tool: "a" }), bad(2))).streak).toBe(1)
})

test("a step with one success breaks the streak; a failed source does not", () => {
  expect(turnFailures(turn(step({ tool: "a", error: "x" }, { tool: "b" }))).streak).toBe(0)
  expect(turnFailures(turn(step({ tool: "mcp__ot__a", text: FAILED_SOURCE }))).streak).toBe(1)
})

test("loads and denials neither add to the streak nor break it", () => {
  const load = step({ tool: "mcp__ot__b", error: `${LOADED_PREFIX}mcp__ot__b` })
  const denied = step({ tool: "shell", error: "Người dùng từ chối chạy tool này." })
  const bad = step({ tool: "a", error: "boom" })
  expect(turnFailures(turn(bad, load, denied, step({ tool: "a", input: { n: 1 }, error: "boom" }))).streak).toBe(2)
})

test("the reminder names the gaps, and the streak only once", () => {
  expect(failureNudge({ gaps: [], streak: 0 })).toBeUndefined()
  expect(failureNudge({ gaps: ["a", "b"], streak: 1 })).toContain("a, b")
  expect(failureNudge({ gaps: [], streak: FAILURE_STREAK_NUDGE })).toContain("bước liên tiếp")
  expect(failureNudge({ gaps: [], streak: FAILURE_STREAK_NUDGE + 1 })).toBeUndefined()
})

test("the line under the answer counts the sources", () => {
  expect(gapsLine(["a", "b"])).toBe("! 2 nguồn lỗi chưa khắc phục trong lượt này: a, b")
})

test("usable: only a tool other than the harness's own that returned data counts", () => {
  const search = { tool: "tool_search", text: `${LOADED_PREFIX}mcp__ot__a` }
  expect(turnFailures(turn(step(search), step({ tool: "mcp__ot__a", text: FAILED_SOURCE }))).usable).toBe(false)
  expect(turnFailures(turn(step({ tool: "todo_write" }, { tool: "load_skill" }), step({ tool: "mcp__ot__a", error: DOWN }))).usable).toBe(false)
  expect(turnFailures(turn(step({ tool: "mcp__ot__a", text: FAILED_SOURCE }), step({ tool: "mcp__ot__b" }))).usable).toBe(true)
  expect(turnFailures(turn(step({ tool: "current_time" }))).usable).toBe(true)
  // fetched: only a data tool (MCP, web) that returned data.
  expect(turnFailures(turn(step({ tool: "current_time" }, { tool: "mcp__ot__a", error: DOWN }))).fetched).toBe(false)
  expect(turnFailures(turn(step({ tool: "mcp__ot__a", text: FAILED_SOURCE }), step({ tool: "mcp__ot__b" }))).fetched).toBe(true)
})

test("gapsAnswer names every gap and states no figure", async () => {
  const { gapsAnswer } = await import("../src/core/loop/failures")
  const text = gapsAnswer(["vn_quote_history", "market_candles_batch"])
  expect(text).toContain("vn_quote_history, market_candles_batch")
  expect(text).not.toMatch(/\d/)
})
