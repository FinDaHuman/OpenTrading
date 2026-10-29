import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { isCompactMarker } from "../src/core/compact-marker"
import {
  type ContextLimits,
  contextLimits,
  isContextOverflow,
  MAX_AUTO_FAILURES,
  PRUNED_TEXT,
  formatCompactSummary,
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

/** Limits with a round threshold, independent of the reserve rules (tested on their own). */
const limits = (window: number, threshold = window * 0.8): ContextLimits => ({ window, reserve: 0, threshold, capped: false })

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
  const result = await compactHistory(history, { contextTokens: 8_400, limits: limits(10_000), summarize: neverSummarize })
  expect(result.summary).toBeUndefined()
  expect(result.error).toBeUndefined()
  expect(result.pruned).toBe(2)
  expect(result.after).toBeLessThan(result.before)
  expect(result.after).toBeLessThan(8_000)
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
    limits: limits(2_000),
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

test("auto-compaction triggers at the threshold, waits for growth after a compaction that stayed large, and stops after 3 failures", () => {
  const base = { limits: limits(100_000), failures: 0, disabled: false }
  expect(shouldAutoCompact({ ...base, contextTokens: 79_000 })).toBe(false)
  expect(shouldAutoCompact({ ...base, contextTokens: 81_000 })).toBe(true)
  expect(shouldAutoCompact({ ...base, contextTokens: 81_000, disabled: true })).toBe(false)
  expect(shouldAutoCompact({ ...base, contextTokens: 81_000, limits: undefined })).toBe(false)
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

test("one request: an <analysis> scratchpad then the <summary>; lean drops the analysis section", () => {
  const full = compactPrompt()
  expect(full).toContain("<analysis>")
  expect(full).toContain("<summary>")
  expect(full).toContain("không gọi tool")
  expect(full).toContain("## Phân tích và kết luận đã đưa ra")
  const lean = compactPrompt(undefined, "lean")
  expect(lean).toContain("## Số liệu đã xác minh")
  expect(lean).not.toContain("## Phân tích và kết luận đã đưa ra")
  expect(lean).not.toContain("## Ràng buộc và sở thích")
  // A figure only an earlier answer gave is not sourced to a tool (30/10, AAA "LNTT +29,3%").
  for (const prompt of [full, lean]) expect(prompt).toContain('ghi nguồn là "câu trả lời trước", không ghi tên tool')
})

test("the stored summary drops the scratchpad; a cut-off analysis is no summary", () => {
  const reply = "<analysis>\ntool: vn_quote_history x3\n</analysis>\n\n<summary>\n## Yêu cầu của người dùng\nĐịnh giá FPT\n</summary>"
  expect(formatCompactSummary(reply)).toBe("## Yêu cầu của người dùng\nĐịnh giá FPT")
  // Models that skip the tags: the reply is the summary.
  expect(formatCompactSummary("## Yêu cầu của người dùng\nX")).toBe("## Yêu cầu của người dùng\nX")
  // An unclosed </summary> (cut at the very end) still yields what was written.
  expect(formatCompactSummary("<analysis>a</analysis><summary>## Mục\nY")).toBe("## Mục\nY")
  expect(formatCompactSummary("<analysis>\ntool: x")).toBeUndefined()
  expect(formatCompactSummary("<analysis>a</analysis>")).toBeUndefined()
})

test("the whole window of the model by default: input limit first, a reserve for the answer, 95% of the rest", () => {
  // Gemini 3.5 Flash: 1M context, 65k output → reserve 20k, compact at ~977k.
  expect(contextLimits({ context: 1_048_576, output: 65_536 })).toEqual({ window: 1_048_576, reserve: 20_000, threshold: 977_147, capped: false })
  // GPT-5.x: 400k context but 272k input; the input limit is what a request must fit.
  expect(contextLimits({ context: 400_000, input: 272_000, output: 128_000 })).toEqual({ window: 272_000, reserve: 20_000, threshold: 239_400, capped: false })
  // A 200k model (Claude Code compacts at 167k).
  expect(contextLimits({ context: 200_000, output: 64_000 })?.threshold).toBe(171_000)
  // A small output limit is the reserve; a small window keeps at most a quarter of itself.
  expect(contextLimits({ context: 131_072, output: 8_192 })?.reserve).toBe(8_192)
  expect(contextLimits({ context: 32_768, output: 32_768 })).toEqual({ window: 32_768, reserve: 8_192, threshold: 23_347, capped: false })
  expect(contextLimits(undefined)).toBeUndefined()
  expect(contextLimits({ output: 8_192 })).toBeUndefined()
})

test("with a threshold near a 1M window, a compaction that stayed large is retried before the window is full", () => {
  const gemini = contextLimits({ context: 1_048_576, output: 65_536 })!
  const base = { limits: gemini, failures: 0, disabled: false }
  // Compacted to 990k (above the 977k threshold): 10% of the window would wait until 1.09M,
  // past the window; half the room left under window − reserve is 19,288 tokens.
  expect(shouldAutoCompact({ ...base, contextTokens: 1_000_000, floor: 990_000 })).toBe(false)
  expect(shouldAutoCompact({ ...base, contextTokens: 1_009_300, floor: 990_000 })).toBe(true)
  // Already past window − reserve: no wait at all.
  expect(shouldAutoCompact({ ...base, contextTokens: 1_030_000, floor: 1_030_000 })).toBe(true)
})

test("compactWindow caps the window (only when lower); autoCompactPercent is kept within 50–95", () => {
  const gemini = { context: 1_048_576, output: 65_536 }
  expect(contextLimits(gemini, { cap: 200_000 })).toEqual({ window: 200_000, reserve: 20_000, threshold: 171_000, capped: true })
  expect(contextLimits({ context: 131_072 }, { cap: 200_000 })?.capped).toBe(false)
  expect(contextLimits(gemini, { percent: 80 })?.threshold).toBe(822_860)
  expect(contextLimits(gemini, { percent: 100 })?.threshold).toBe(977_147)
  expect(contextLimits(gemini, { percent: 10 })?.threshold).toBe(514_288)
})

test("context-overflow wording is told apart from quota and auth errors", () => {
  expect(isContextOverflow("This model's maximum context length is 8192 tokens")).toBe(true)
  expect(isContextOverflow("prompt is too long: 210000 tokens > 200000 maximum")).toBe(true)
  // Gemini, Bedrock, llama.cpp/LM Studio wordings (opencode's list).
  expect(isContextOverflow("Lỗi 400: The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).")).toBe(true)
  expect(isContextOverflow("Input is too long for requested model.")).toBe(true)
  expect(isContextOverflow("request (40000 tokens) exceeds the available context size (32768 tokens)")).toBe(true)
  expect(isContextOverflow("Too many requests, please wait")).toBe(false)
  expect(isContextOverflow("Lỗi 429: Resource exhausted: input token count per minute")).toBe(false)
  expect(isContextOverflow("You exceeded your current quota")).toBe(false)
  expect(isContextOverflow("Invalid API key")).toBe(false)
})

test("a short history is no error for auto-compaction (only for /compact)", async () => {
  const auto = await compactHistory(turn(1), { contextTokens: 9_000, limits: limits(10_000), summarize: neverSummarize })
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

test("a harness reminder sent as the whole user message (continue after an overflow) is not shown as typed by the user", async () => {
  const { visibleUserText } = await import("../src/core/agent")
  const reminder = { role: "user", content: "<nhac_nho>\nTiếp tục.\n</nhac_nho>" } as ModelMessage
  expect(transcriptFromMessages([reminder, { role: "assistant", content: "xong" }])).toEqual([{ kind: "assistant", text: "xong" }])
  expect(visibleUserText(reminder)).toBe("")
  expect(transcriptFromMessages([{ role: "user", content: "hỏi" }])).toEqual([{ kind: "user", text: "hỏi" }])
})
