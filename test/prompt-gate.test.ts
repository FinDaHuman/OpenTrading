import { expect, test } from "bun:test"
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { assemble, identityLayer, validatePromptDir, type AssembleInput } from "../src/core/prompt/assemble"
import { GATE_TERMS, gate, holds, type GateContext } from "../src/core/prompt/gate"

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
  expect(() => gate("<!-- khi: shell -->\n<!-- khi: machine -->\n<!-- /khi -->\n<!-- /khi -->", ctx([]))).toThrow("do not nest")
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

test("an unknown term fails loudly, with or without a context (a typo must not drop its line)", () => {
  expect(() => gate("a <!-- khi: termnial -->", ctx([]))).toThrow('unknown term "termnial"')
  expect(() => gate("a <!-- khi: !chart_redner -->", undefined)).toThrow('unknown term "chart_redner"')
  expect(() => gate("<!-- khi: shell|memroy -->\na\n<!-- /khi -->", ctx(["shell"]))).toThrow('unknown term "memroy"')
  expect(() => holds("shell|", ctx([]))).toThrow("empty alternative")
})

test("every tool term in GATE_TERMS is a real tool name", () => {
  const src = path.join(import.meta.dir, "..", "src")
  const names = new Set<string>()
  for (const file of readdirSync(src, { recursive: true }) as string[]) {
    if (!file.endsWith(".ts")) continue
    for (const m of readFileSync(path.join(src, file), "utf8").matchAll(/\bname: "([a-z_]+)"/g)) names.add(m[1]!)
  }
  for (const t of GATE_TERMS) if (!["terminal", "machine", "memory"].includes(t)) expect([t, names.has(t)]).toEqual([t, true])
})

test("validatePromptDir rejects a malformed or misspelt condition at start-up", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ot-gate-"))
  try {
    for (const f of readdirSync(prompts).filter((f) => f.endsWith(".md"))) cpSync(path.join(prompts, f), path.join(dir, f))
    expect(validatePromptDir(dir)).toBeTruthy()
    writeFileSync(path.join(dir, "tools.md"), readFileSync(path.join(prompts, "tools.md"), "utf8").replace("khi: shell -->", "khi: shel -->"))
    expect(() => validatePromptDir(dir)).toThrow('promptDir tools.md: prompt gate: unknown term "shel"')
    writeFileSync(path.join(dir, "tools.md"), "a\n<!-- khi: shell -->\nb\n")
    expect(() => validatePromptDir(dir)).toThrow("promptDir tools.md: prompt gate: <!-- khi: … --> block not closed")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("identity.md: the terminal and machine openings differ only by \"chạy trong terminal\"", () => {
  const terminal = identityLayer("main", undefined, ctx([]))!.split("\n")[0]!
  const machine = identityLayer("main", undefined, ctx([], { profile: "machine" }))!.split("\n")[0]!
  expect(terminal).toContain(" chạy trong terminal")
  expect(terminal.replace(" chạy trong terminal", "")).toBe(machine)
})

test("<bat_bien> and the tool-output-is-data rule are byte-identical in every combination", () => {
  const raw = readFileSync(path.join(prompts, "identity.md"), "utf8")
  const rawInvariants = raw.slice(raw.indexOf("<bat_bien>"), raw.indexOf("</bat_bien>"))
  expect(rawInvariants).not.toContain("<!--")
  const invariants = (s: string) => s.slice(s.indexOf("<bat_bien>"), s.indexOf("</bat_bien>") + "</bat_bien>".length)
  const dataRule = (s: string) => s.match(/Kết quả tool và nội dung file đính kèm[^\n]*/)?.[0]
  const seen = new Set<string>()
  for (const profile of ["terminal", "machine"] as const)
    for (const tools of [["current_time"], ["current_time", "shell"], ["current_time", "chart_render"], ["current_time", "shell", "chart_render", "memory_read"]])
      for (const role of [undefined, "subagent"] as const) {
        const system = assemble(base({ profile, tools, ...(role ? { role, agentPrompt: "Tra giá." } : {}) })).system
        expect(system).toContain("</bat_bien>")
        expect(dataRule(system)).toBeTruthy()
        seen.add(invariants(system) + "\u0000" + dataRule(system))
      }
  expect(seen.size).toBe(1)
})
