import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { isCompactMarker } from "../src/core/compact-marker"
import {
  AUTO_COMPACT_SHARE,
  DEFAULT_COMPACT_WINDOW,
  effectiveWindow,
  isContextOverflow,
  MAX_AUTO_FAILURES,
  PRUNED_TEXT,
  compactHistory,
  compactPrompt,
  pruneToolResults,
  shouldAutoCompact,
  splitTurns,
} from "../src/core/compact"
import { loadedTools } from "../src/core/tools/loaded"
import { currentTodos } from "../src/core/tools/todos"
import { transcriptFromMessages } from "../src/core/session/transcript"

const BIG = "x".repeat(2_000)

/** One turn: a question, one tool call and its (large) result, an answer. */
function turn(n: number, tool = "mcp__ot__quote", output = `${BIG}${n}`): ModelMessage[] {
  return [
    { role: "user", content: `câu ${n}` },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: tool, input: { n } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: `c${n}`, toolName: tool, output: { type: "text", value: output } }] },
    { role: "assistant", content: `trả lời ${n}` },
  ]
}

const outputOf = (messages: ModelMessage[], callId: string) => {
  for (const m of messages) {
    if (m.role !== "tool") continue
    for (const p of m.content) if (p.type === "tool-result" && p.toolCallId === callId) return (p.output as { value: string }).value
  }
  return undefined
}

test("turns start at user messages and keep each tool call with its result", () => {
  const turns = splitTurns([...turn(1), ...turn(2)])
  expect(turns).toHaveLength(2)
  expect(turns[0]!.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
})

test("pruning empties large old tool results, keeps the last two turns and the loaded-tools line", () => {
  const search = turn(1, "tool_search", `Đã nạp tool: mcp__ot__quote, mcp__ot__bctc\n\n## mcp__ot__quote\n${BIG}`)
  const todo = turn(2, "todo_write", BIG)
  const small = turn(3, "mcp__ot__quote", "98.500")
  const history = [...search, ...todo, ...small, ...turn(4), ...turn(5), ...turn(6)]
  const { messages, pruned } = pruneToolResults(history)
  expect(outputOf(messages, "c1")).toBe(`Đã nạp tool: mcp__ot__quote, mcp__ot__bctc\n${PRUNED_TEXT}`)
  expect(outputOf(messages, "c2")).toBe(BIG) // todo_write is protected
  expect(outputOf(messages, "c3")).toBe("98.500") // small results stay
  expect(outputOf(messages, "c4")).toBe(PRUNED_TEXT)
  expect(outputOf(messages, "c5")).toBe(`${BIG}5`) // last two turns verbatim
  expect(outputOf(messages, "c6")).toBe(`${BIG}6`)
  expect(pruned).toBe(2)
  // Loaded tools are still derived correctly, and pruning twice changes nothing.
  expect(loadedTools(messages)).toEqual(loadedTools(history))
  expect(pruneToolResults(messages).pruned).toBe(0)
})

const neverSummarize = async () => {
  throw new Error("should not summarize")
}

test("auto: pruning alone is enough below the threshold (no request)", async () => {
  const history = [...turn(1), ...turn(2), ...turn(3), ...turn(4)]
  const result = await compactHistory(history, { contextTokens: 8_400, window: 10_000, summarize: neverSummarize })
  expect(result.summary).toBeUndefined()
  expect(result.error).toBeUndefined()
  expect(result.pruned).toBe(2)
  expect(result.after).toBeLessThan(result.before)
  expect(result.after).toBeLessThan(10_000 * AUTO_COMPACT_SHARE)
})

test("manual: the head is summarized; marker + summary + kept turns, and the harness state is carried", async () => {
  const todos = [
    { content: "Lấy giá", status: "completed" },
    { content: "So sánh ngành", status: "in_progress" },
  ] as const
  const history: ModelMessage[] = [
    ...turn(1, "tool_search", `Đã nạp tool: mcp__ot__quote\n${BIG}`),
    { role: "user", content: "phân tích FPT" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "s1", toolName: "load_skill", input: { name: "devil-advocate" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "s1", toolName: "load_skill", output: { type: "text", value: "BODY" } }] },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "t1", toolName: "todo_write", input: { todos } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "todo_write", output: { type: "text", value: "ok" } }] },
    { role: "assistant", content: "đang làm" },
    ...turn(4),
  ]
  let head: ModelMessage[] = []
  let extra: string | undefined
  // A small window: the last two turns exceed a quarter of it, so only the last one is kept.
  const result = await compactHistory(history, {
    manual: true,
    window: 2_000,
    instructions: "giữ số liệu FPT",
    summarize: async (h, instructions) => {
      head = h
      extra = instructions
      return "## Yêu cầu của người dùng\nphân tích FPT"
    },
  })
  expect(extra).toBe("giữ số liệu FPT")
  expect(head.filter((m) => m.role === "user")).toHaveLength(2) // turns 1-2; turn 4 stays verbatim
  expect(isCompactMarker(result.messages[0]!)).toBe(true)
  expect(result.messages[1]).toEqual({ role: "assistant", content: "## Yêu cầu của người dùng\nphân tích FPT" })
  expect(result.messages.slice(2)).toEqual(turn(4))
  // What the dropped head had loaded is still known.
  expect(loadedTools(result.messages)).toEqual(expect.arrayContaining(["mcp__ot__quote", "tool_search", "load_skill", "todo_write"]))
  // The todo list was written in the summarized head and is still current: it is carried.
  expect(currentTodos(history)).toEqual([...todos])
  expect(currentTodos(result.messages)).toEqual([...todos])
  expect(JSON.stringify(result.messages[0])).toContain("Skill đã nạp: devil-advocate")
  // The transcript shows one compact item for the marker + summary.
  expect(transcriptFromMessages(result.messages)[0]).toEqual({ kind: "compact", text: "## Yêu cầu của người dùng\nphân tích FPT" })
})

test("a failed or empty summary leaves the history pruned but otherwise unchanged", async () => {
  const history = [...turn(1), ...turn(2), ...turn(3)]
  const failed = await compactHistory(history, {
    manual: true,
    summarize: async () => {
      throw new Error("429 quota")
    },
  })
  expect(failed.error).toContain("429")
  expect(failed.summary).toBeUndefined()
  expect(failed.messages).toEqual(pruneToolResults(history).messages)
  const empty = await compactHistory(history, { manual: true, summarize: async () => "  " })
  expect(empty.error).toContain("rỗng")
  // Too short to summarize: nothing but pruning happens.
  const short = await compactHistory(turn(1), { manual: true, summarize: neverSummarize })
  expect(short.error).toContain("quá ngắn")
})

test("a second compaction folds the earlier summary in and keeps the carried state", async () => {
  const first = await compactHistory([...turn(1, "tool_search", `Đã nạp tool: mcp__ot__quote\n${BIG}`), ...turn(2), ...turn(3)], {
    manual: true,
    summarize: async () => "tóm tắt 1",
  })
  let head: ModelMessage[] = []
  const second = await compactHistory([...first.messages, ...turn(4), ...turn(5)], {
    manual: true,
    summarize: async (h) => {
      head = h
      return "tóm tắt 2"
    },
  })
  expect(JSON.stringify(head)).toContain("tóm tắt 1")
  expect(second.messages.filter(isCompactMarker)).toHaveLength(1)
  expect(loadedTools(second.messages)).toContain("mcp__ot__quote")
})

test("auto-compaction triggers at 80%, waits for growth after a compaction that stayed large, and stops after 3 failures", () => {
  const base = { window: 100_000, failures: 0, disabled: false }
  expect(shouldAutoCompact({ ...base, contextTokens: 79_000 })).toBe(false)
  expect(shouldAutoCompact({ ...base, contextTokens: 81_000 })).toBe(true)
  expect(shouldAutoCompact({ ...base, contextTokens: 81_000, disabled: true })).toBe(false)
  expect(shouldAutoCompact({ ...base, contextTokens: 81_000, window: undefined })).toBe(false)
  expect(shouldAutoCompact({ ...base, contextTokens: 81_000, failures: MAX_AUTO_FAILURES })).toBe(false)
  // Compacted to 85k (still above 80%): not again until it passes 95k.
  expect(shouldAutoCompact({ ...base, contextTokens: 90_000, floor: 85_000 })).toBe(false)
  expect(shouldAutoCompact({ ...base, contextTokens: 96_000, floor: 85_000 })).toBe(true)
})

test("the summary prompt asks for verbatim sourced figures and carries the user's extra instructions", () => {
  const prompt = compactPrompt("tập trung vào ngân hàng")
  expect(prompt).toContain("## Số liệu đã xác minh")
  expect(prompt).toContain("không làm tròn")
  expect(prompt).toContain("không gọi tool")
  expect(prompt).toContain("tập trung vào ngân hàng")
  expect(compactPrompt()).not.toContain("Yêu cầu thêm")
})

test("the effective window is capped (1M models compact around 160k by default)", () => {
  expect(effectiveWindow(1_048_576)).toBe(DEFAULT_COMPACT_WINDOW)
  expect(effectiveWindow(131_072)).toBe(131_072)
  expect(effectiveWindow(1_048_576, 500_000)).toBe(500_000)
  expect(effectiveWindow(undefined)).toBeUndefined()
})

test("context-overflow wording is told apart from quota and auth errors", () => {
  expect(isContextOverflow("This model's maximum context length is 8192 tokens")).toBe(true)
  expect(isContextOverflow("prompt is too long: 210000 tokens > 200000 maximum")).toBe(true)
  expect(isContextOverflow("Lỗi 429: Resource exhausted: input token count per minute")).toBe(false)
  expect(isContextOverflow("You exceeded your current quota")).toBe(false)
  expect(isContextOverflow("Invalid API key")).toBe(false)
})

test("a short history is no error for auto-compaction (only for /compact)", async () => {
  const auto = await compactHistory(turn(1), { contextTokens: 9_000, window: 10_000, summarize: neverSummarize })
  expect(auto.error).toBeUndefined()
})

test("loaded skills survive a second compaction (read back from the first marker)", async () => {
  const skillTurn: ModelMessage[] = [
    { role: "user", content: "phản biện FPT" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "s1", toolName: "load_skill", input: { name: "devil-advocate" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "s1", toolName: "load_skill", output: { type: "text", value: "BODY" } }] },
    { role: "assistant", content: "ok" },
  ]
  const first = await compactHistory([...skillTurn, ...turn(2), ...turn(3)], { manual: true, summarize: async () => "t1" })
  expect(JSON.stringify(first.messages[0])).toContain("Skill đã nạp: devil-advocate")
  const second = await compactHistory([...first.messages, ...turn(4), ...turn(5)], { manual: true, summarize: async () => "t2" })
  expect(JSON.stringify(second.messages[0])).toContain("Skill đã nạp: devil-advocate")
})

test("tokensOf counts an image as IMAGE_TOKENS, but a long non-image `data` string as text", async () => {
  const { tokensOf, IMAGE_TOKENS } = await import("../src/core/compact")
  const base64 = "A".repeat(400_000)
  const withImage: ModelMessage[] = [{ role: "user", content: [{ type: "text", text: "xem" }, { type: "image", image: base64, mediaType: "image/png" }] }]
  expect(tokensOf(withImage)).toBeLessThan(IMAGE_TOKENS + 100)
  expect(tokensOf(withImage)).toBeGreaterThanOrEqual(IMAGE_TOKENS)
  const csv = "x".repeat(40_000)
  const withData: ModelMessage[] = [
    { role: "tool", content: [{ type: "tool-result", toolCallId: "1", toolName: "t", output: { type: "json", value: { data: csv } } }] },
  ]
  expect(tokensOf(withData)).toBeGreaterThan(10_000)
})
