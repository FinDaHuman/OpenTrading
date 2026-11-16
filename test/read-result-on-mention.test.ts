import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { activeFor } from "../src/core/agent"
import { readResultTool } from "../src/core/tools/builtin/read-result"
import { ToolRegistry } from "../src/core/tools/registry"
import { prunedEvidence } from "../src/core/compact"

/** Issue #309 B2: read_result is offered only once a message names it (a pruned result, a summary, a capped table). */

const registry = new ToolRegistry()
registry.register({ name: "vn_quote", description: "Giá", input: { type: "object", properties: {} }, execute: async () => "{}" } as never)
registry.register(readResultTool())
const built = registry.toToolSet({})
const user = (text: string): ModelMessage => ({ role: "user", content: text })
/** activeFor's undefined means every declared tool is callable. */
const callable = (messages: ModelMessage[]) => activeFor(built, messages) ?? Object.keys(built.tools)

test("declared, but not offered while nothing names it", () => {
  expect(Object.keys(built.tools)).toContain("read_result")
  expect(callable([user("Giá HPG?")])).toEqual(["vn_quote"])
})

test("offered as soon as a message names it: a pruned result's line, a capped table's note", () => {
  const pruned: ModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "vn_quote", output: { type: "text", value: prunedEvidence("c1") } }] }
  expect(callable([user("Giá HPG?"), pruned])).toContain("read_result")
  expect(callable([user("[ref r3] bảng 50 dòng, đủ ở ref r3: chart đọc thẳng, read_result đọc nguyên văn")])).toContain("read_result")
})

test("a tool set without read_result is unchanged (every tool callable)", () => {
  const plain = new ToolRegistry()
  plain.register({ name: "vn_quote", description: "Giá", input: { type: "object", properties: {} }, execute: async () => "{}" } as never)
  expect(activeFor(plain.toToolSet({}), [user("Giá HPG?")])).toBeUndefined()
})
