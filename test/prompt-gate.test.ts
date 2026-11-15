import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { assemble, identityLayer, type AssembleInput } from "../src/core/prompt/assemble"
import { gate, holds, type GateContext } from "../src/core/prompt/gate"

/** Conditional prompt lines (prompt/gate.ts): the system prompt carries only the rules the turn can use. */

const prompts = path.join(import.meta.dir, "..", "prompts")
const ctx = (tools: string[], over: Partial<GateContext> = {}): GateContext => ({ tools: new Set(tools), profile: "terminal", memory: false, ...over })
const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  tier: "B",
  tools: ["current_time", "shell", "chart_render"],
  skills: [],
  sticky: [],
  input: "Giá HPG?",
  now: new Date("2026-11-15T10:00:00+07:00"),
  ...over,
})

test("one line, a block, negation, alternatives and the profile", () => {
  const text = ["a", "b <!-- khi: shell -->", "c <!-- khi: !shell -->", "<!-- khi: chart_render|machine -->", "d", "e", "<!-- /khi -->", "f <!-- khi: shell, terminal -->"].join("\n")
  expect(gate(text, ctx(["shell"]))).toBe(["a", "b", "f"].join("\n"))
  expect(gate(text, ctx([], { profile: "machine" }))).toBe(["a", "c", "d", "e"].join("\n"))
  expect(gate(text, ctx(["chart_render", "shell"]))).toBe(["a", "b", "d", "e", "f"].join("\n"))
  expect(holds("memory", ctx([], { memory: true }))).toBe(true)
  expect(holds("!memory", ctx([], { memory: true }))).toBe(false)
})

test("no context keeps every line (the widest prompt) and still strips the markers", () => {
  expect(gate("a <!-- khi: shell -->\nb <!-- khi: !shell -->", undefined)).toBe("a\nb")
})

test("malformed blocks fail loudly instead of dropping the rest of a prompt", () => {
  expect(() => gate("<!-- khi: shell -->\na", ctx([]))).toThrow("not closed")
  expect(() => gate("a\n<!-- /khi -->", ctx([]))).toThrow("without an open block")
  expect(() => gate("<!-- khi: a -->\n<!-- khi: b -->\n<!-- /khi -->\n<!-- /khi -->", ctx([]))).toThrow("do not nest")
})

test("every bundled prompt file is well formed and no marker reaches the model", () => {
  for (const file of readdirSync(prompts).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(path.join(prompts, file), "utf8")
    expect(() => gate(text, ctx([]))).not.toThrow()
  }
  const variants: Partial<AssembleInput>[] = [
    {},
    { profile: "machine" },
    { tools: ["current_time"] },
    { tools: ["current_time", "shell", "read_result"], profile: "machine" },
    { role: "subagent", agentPrompt: "Tra giá." },
    { memoryInstructions: readFileSync(path.join(prompts, "memory.md"), "utf8"), tools: ["shell", "memory_read"] },
  ]
  for (const over of variants) {
    const system = assemble(base(over)).system
    expect([JSON.stringify(over), system.includes("<!--")]).toEqual([JSON.stringify(over), false])
  }
})

test("rules follow the tools: no chart advice without chart_render, no shell rule without shell", () => {
  const full = assemble(base()).system
  const bare = assemble(base({ tools: ["current_time"] })).system
  expect(full).toContain("ưu tiên vẽ biểu đồ")
  expect(bare).not.toContain("vẽ biểu đồ")
  expect(bare).toContain("trình bày bằng bảng")
  expect(full).toContain("chạy bằng `shell`")
  expect(bare).not.toContain("`shell`")
  expect(bare).toContain("Không có công cụ tính")
  expect(full).not.toContain("Không có công cụ tính")
})

test("a deferred tool counts as present: loading it later never changes the system prompt", () => {
  const deferred = assemble(base({ tools: ["current_time", "tool_search"], deferredTools: [{ server: "local", tools: ["chart_render", "shell"] }] })).system
  const loaded = assemble(base({ tools: ["current_time", "tool_search", "chart_render", "shell"], deferredTools: [{ server: "local", tools: ["chart_render", "shell"] }] })).system
  expect(deferred).toContain("ưu tiên vẽ biểu đồ")
  expect(deferred).toBe(loaded)
})

test("machine: identity does not claim a terminal; terminal does", () => {
  expect(assemble(base()).system).toContain("chạy trong terminal")
  expect(assemble(base({ profile: "machine" })).system).not.toContain("terminal")
})

test("memory_read is named only when the turn has it", () => {
  const memoryInstructions = readFileSync(path.join(prompts, "memory.md"), "utf8")
  expect(assemble(base({ memoryInstructions, tools: ["shell", "memory_read"] })).system).toContain("memory_read")
  expect(assemble(base({ memoryInstructions, tools: ["shell"] })).system).not.toContain("memory_read")
})

test("identityLayer without a context is the widest layer (sizing the constraints check)", () => {
  const widest = identityLayer("main")!
  expect(widest).not.toContain("<!--")
  expect(widest.length).toBeGreaterThanOrEqual(identityLayer("main", undefined, ctx([], { profile: "machine" }))!.length)
  expect(identityLayer("subagent")).toContain("<bat_bien>")
})
