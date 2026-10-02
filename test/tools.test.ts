import { expect, test } from "bun:test"
import { z } from "zod"
import { currentTimeTool } from "../src/core/tools/builtin/current-time"
import { loadSkillTool } from "../src/core/tools/builtin/load-skill"
import { ToolRegistry } from "../src/core/tools/registry"
import type { ToolDef } from "../src/core/tools/types"
import { RwLock, runTool, truncate } from "../src/core/tools/wrap"

const ctx = () => ({ signal: new AbortController().signal, callId: "c1" })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function def(partial: Partial<ToolDef> & Pick<ToolDef, "execute">): ToolDef {
  return { name: "t", description: "", input: z.object({}), readOnly: true, ...partial }
}

test("truncate keeps head and tail with a marker", () => {
  const text = "A".repeat(700) + "B".repeat(300) + "C".repeat(1000)
  const out = truncate(text, 1000)
  expect(out.startsWith("A".repeat(700))).toBe(true)
  expect(out.endsWith("C".repeat(300))).toBe(true)
  expect(out).toContain("đã lược 1000 ký tự")
  expect(truncate("short", 1000)).toBe("short")
})

test("long output is truncated before the model sees it", async () => {
  const { output: out } = await runTool(def({ maxOutputChars: 100, execute: async () => "x".repeat(500) }), {}, ctx(), new RwLock())
  expect(out.length).toBeLessThan(200)
  expect(out).toContain("đã lược")
})

test("a tool that ignores its signal still times out and releases the lock", async () => {
  const lock = new RwLock()
  const hang = def({ readOnly: false, timeoutMs: 50, execute: () => new Promise(() => {}) })
  await expect(runTool(hang, {}, ctx(), lock)).rejects.toThrow("quá thời gian")
  // The write lock must be free again.
  const ok = await runTool(def({ readOnly: false, execute: async () => "ok" }), {}, ctx(), lock)
  expect(ok).toEqual({ output: "ok" })
})

test("errors are rethrown as Error with the tool's message", async () => {
  await expect(
    runTool(def({ execute: async () => { throw new Error("nguồn lỗi") } }), {}, ctx(), new RwLock()),
  ).rejects.toThrow("nguồn lỗi")
})

test("read-only tools overlap, write tools run one at a time", async () => {
  const lock = new RwLock()
  let active = 0
  let peak = 0
  const track = (readOnly: boolean) =>
    def({
      readOnly,
      execute: async () => {
        active++
        peak = Math.max(peak, active)
        await sleep(30)
        active--
        return "done"
      },
    })
  await Promise.all([runTool(track(true), {}, ctx(), lock), runTool(track(true), {}, ctx(), lock)])
  expect(peak).toBe(2)
  peak = 0
  await Promise.all([runTool(track(false), {}, ctx(), lock), runTool(track(false), {}, ctx(), lock)])
  expect(peak).toBe(1)
})

test("abort rejects a running tool", async () => {
  const controller = new AbortController()
  const running = runTool(def({ execute: () => new Promise(() => {}) }), {}, { signal: controller.signal, callId: "c" }, new RwLock())
  controller.abort()
  await expect(running).rejects.toThrow("Đã huỷ")
})

test("finished tool calls do not leave abort listeners on the turn's signal", async () => {
  const controller = new AbortController()
  let added = 0
  let removed = 0
  const add = controller.signal.addEventListener.bind(controller.signal)
  const remove = controller.signal.removeEventListener.bind(controller.signal)
  controller.signal.addEventListener = ((...args: Parameters<typeof add>) => (added++, add(...args))) as typeof add
  controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => (removed++, remove(...args))) as typeof remove
  for (let i = 0; i < 5; i++) await runTool(def({ execute: async () => "ok" }), {}, { signal: controller.signal, callId: "c" }, new RwLock())
  expect(added).toBeGreaterThan(0)
  expect(removed).toBe(added)
})

test("current_time reports Vietnam time", async () => {
  const tool = currentTimeTool(() => new Date("2026-09-28T02:30:00Z"))
  const out = (await tool.execute({}, ctx())) as string
  expect(out).toContain("Thứ hai, 28/09/2026 09:30:00")
  expect(out).toContain("+07:00")
})

test("load_skill returns a body, refuses manual skills and unknown names", async () => {
  const base = { description: "d", dir: "/skills/x", source: "bundled" as const, body: "BODY" }
  const tool = loadSkillTool(() => [
    { ...base, name: "devil-advocate", activation: "auto" },
    { ...base, name: "hand-only", activation: "manual" },
  ])
  expect(await tool.execute({ name: "devil-advocate" }, ctx())).toContain("BODY")
  await expect(tool.execute({ name: "hand-only" }, ctx())).rejects.toThrow("chỉ người dùng bật")
  await expect(tool.execute({ name: "x" }, ctx())).rejects.toThrow("Không có skill")
})

test("registry builds a sorted AI SDK tool set and unregisters by prefix", () => {
  const registry = new ToolRegistry()
  registry.register(def({ name: "mcp__demo__b", execute: async () => "" }))
  registry.register(def({ name: "a_tool", execute: async () => "" }))
  registry.register(def({ name: "mcp__demo__a", input: { type: "object", properties: {} }, execute: async () => "" }))
  expect(Object.keys(registry.toToolSet().tools)).toEqual(["a_tool", "mcp__demo__a", "mcp__demo__b"])
  registry.unregister("mcp__demo__")
  expect(registry.list().map((t) => t.name)).toEqual(["a_tool"])
})

test("prompt arguments: positional with free-text tail, by name, missing required", async () => {
  const { parsePromptArgs, promptUsage } = await import("../src/tui/commands")
  const args = [{ name: "ticker", required: true }, { name: "focus" }]
  expect(promptUsage(args)).toBe("<ticker> [focus]")
  expect(parsePromptArgs(args, "VCB biên lãi gộp")).toEqual({ values: { ticker: "VCB", focus: "biên lãi gộp" } })
  expect(parsePromptArgs(args, "VCB")).toEqual({ values: { ticker: "VCB" } })
  expect(parsePromptArgs(args, 'focus="nợ xấu" ticker=CTG')).toEqual({ values: { focus: "nợ xấu", ticker: "CTG" } })
  expect(parsePromptArgs(args, "ticker=CTG focus=nợ xấu ngắn hạn")).toEqual({ values: { ticker: "CTG", focus: "nợ xấu ngắn hạn" } })
  expect(parsePromptArgs(args, "")).toEqual({ error: "Thiếu ticker. Cách dùng: <ticker> [focus]" })
  expect(parsePromptArgs([{ name: "q", required: true }], "giá vàng hôm nay")).toEqual({ values: { q: "giá vàng hôm nay" } })
})
