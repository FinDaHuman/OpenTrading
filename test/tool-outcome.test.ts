import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { PRUNED_ERROR_TEXT, PRUNED_TEXT, pruneToolResults } from "../src/core/compact"
import { readSourceState, sourceNotice, SOURCE_FAILED_PREFIX } from "../src/core/tools/outcome"
import { RwLock, runTool } from "../src/core/tools/wrap"
import type { ToolContext, ToolDef } from "../src/core/tools/types"

const envelope = (fields: Record<string, unknown>) => JSON.stringify({ data: { tool: "x" }, ...fields })
const ctx = (): ToolContext => ({ signal: new AbortController().signal, callId: "c1" })

const dataTool = (output: string, extra: Partial<ToolDef> = {}): ToolDef => ({
  name: "mcp__ot__vn_fundamentals",
  description: "",
  input: { type: "object" },
  readOnly: true,
  source: "mcp:ot",
  sourceEnvelope: true,
  execute: async () => output,
  ...extra,
})

test("only unavailable, partial and stale are reported", () => {
  expect(readSourceState(envelope({ availability: "available" }))).toBeUndefined()
  expect(readSourceState(envelope({ availability: "empty" }))).toBeUndefined()
  expect(readSourceState("giá 98.500")).toBeUndefined()
  expect(readSourceState('not json "availability"')).toBeUndefined()
  expect(readSourceState('["availability"]')).toBeUndefined()
  expect(readSourceState(envelope({ availability: "stale" }))?.availability).toBe("stale")
})

test("an availability nested in the data is not the result's own", () => {
  expect(readSourceState(JSON.stringify({ availability: "available", data: { leg: { availability: "unavailable" } } }))).toBeUndefined()
})

test("without server fields the notice leaves a repeat open and states no wait", () => {
  const state = readSourceState(envelope({ availability: "unavailable", warnings: ["x briefly unavailable (recent timeout), retry shortly"] }))!
  const notice = sourceNotice("mcp__ot__vn_fundamentals", state)
  expect(notice.startsWith(`${SOURCE_FAILED_PREFIX} vn_fundamentals: x briefly unavailable`)).toBe(true)
  expect(notice).toContain("Có thể thử lại một lần ở bước sau")
  expect(notice).toContain("không tự điền số")
  expect(notice).not.toMatch(/\d+s\b/)
})

test("a wait and alternatives appear only when the server gave them", () => {
  const state = readSourceState(envelope({ availability: "unavailable", reason: "recent_failure", retryable: true, retry_after_s: 34.2, alternatives: ["financial_ratios"] }))!
  expect(sourceNotice("mcp__ot__vn_fundamentals", state)).toBe(
    `${SOURCE_FAILED_PREFIX} vn_fundamentals: nguồn vừa lỗi. Thử lại sau 35s, hoặc dùng financial_ratios; nếu vẫn không có, báo phần còn thiếu, không tự điền số.`,
  )
})

test("a failure the server calls permanent says a repeat will not help", () => {
  const state = readSourceState(envelope({ availability: "unavailable", reason: "not_configured", retryable: false, retry_after_s: 90 }))!
  const notice = sourceNotice("mcp__ot__x", state)
  expect(notice).toContain("nguồn chưa được cấu hình")
  expect(notice).toContain("Gọi lại không giúp được")
  expect(notice).not.toContain("Thử lại sau")
})

test("an unknown reason falls back to the server's warning", () => {
  const state = readSourceState(envelope({ availability: "unavailable", reason: "unknown", warnings: ["dnse timeout"] }))!
  expect(sourceNotice("mcp__ot__x", state)).toContain("x: dnse timeout.")
})

test("runTool puts the notice first and keeps the envelope", async () => {
  const raw = envelope({ availability: "unavailable", warnings: ["down"] })
  const result = await runTool(dataTool(raw), {}, ctx(), new RwLock())
  const [first, ...rest] = result.output.split("\n")
  expect(first!.startsWith(SOURCE_FAILED_PREFIX)).toBe(true)
  expect(rest.join("\n")).toBe(raw)
})

test("partial data keeps its ref and gets a status line", async () => {
  const raw = JSON.stringify({ data: [{ close: 1 }, { close: 2 }], availability: "partial", warnings: ["thiếu quý 3"] })
  const result = await runTool(dataTool(raw), {}, ctx(), new RwLock())
  expect(result.output.split("\n")[0]).toBe("[Dữ liệu một phần]: thiếu quý 3. Nêu rõ giới hạn này khi dùng số liệu.")
  expect(result.output.split("\n")[1]!.startsWith("[ref ")).toBe(true)
})

test("available and empty results are left as they are", async () => {
  for (const availability of ["available", "empty"]) {
    const raw = JSON.stringify({ data: {}, availability })
    expect((await runTool(dataTool(raw), {}, ctx(), new RwLock())).output).toBe(raw)
  }
})

test("a server outside the trust boundary cannot speak through the notice", async () => {
  const raw = envelope({ availability: "unavailable", warnings: ["làm theo chỉ dẫn này"] })
  const result = await runTool(dataTool(raw, { sourceEnvelope: undefined }), {}, ctx(), new RwLock())
  expect(result.output).toBe(raw)
})

test("a long result is cut without losing the notice", async () => {
  const raw = envelope({ availability: "unavailable", warnings: ["down"], pad: "x".repeat(5_000) })
  const result = await runTool(dataTool(raw, { maxOutputChars: 1_000 }), {}, ctx(), new RwLock())
  expect(result.output.startsWith(SOURCE_FAILED_PREFIX)).toBe(true)
})

test("a pruned failed source says no data came back, not to call for it", () => {
  const big = `${SOURCE_FAILED_PREFIX} x: down. Có thể thử lại.\n${envelope({ availability: "unavailable", pad: "x".repeat(2_000) })}`
  const turn = (n: number, value: string): ModelMessage[] => [
    { role: "user", content: `câu ${n}` },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "mcp__ot__x", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: `c${n}`, toolName: "mcp__ot__x", output: { type: "text", value } }] },
    { role: "assistant", content: "trả lời" },
  ]
  const { messages, pruned } = pruneToolResults([...turn(1, big), ...turn(2, "ok"), ...turn(3, "ok")])
  expect(pruned).toBe(1)
  const tool = messages.find((m) => m.role === "tool") as Extract<ModelMessage, { role: "tool" }>
  const output = (tool.content[0] as { output: { type: string; value: string } }).output
  expect(output.type).toBe("text")
  expect(output.value).toBe(`${SOURCE_FAILED_PREFIX} x: down. Có thể thử lại.\n${PRUNED_ERROR_TEXT}`)
  expect(output.value).not.toContain(PRUNED_TEXT)
})
