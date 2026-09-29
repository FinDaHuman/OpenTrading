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
  const out = await runTool(def({ maxOutputChars: 100, execute: async () => "x".repeat(500) }), {}, ctx(), new RwLock())
  expect(out.length).toBeLessThan(200)
  expect(out).toContain("đã lược")
})

test("a tool that ignores its signal still times out and releases the lock", async () => {
  const lock = new RwLock()
  const hang = def({ readOnly: false, timeoutMs: 50, execute: () => new Promise(() => {}) })
  await expect(runTool(hang, {}, ctx(), lock)).rejects.toThrow("quá thời gian")
  // The write lock must be free again.
  const ok = await runTool(def({ readOnly: false, execute: async () => "ok" }), {}, ctx(), lock)
  expect(ok).toBe("ok")
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

test("current_time reports Vietnam time", async () => {
  const tool = currentTimeTool(() => new Date("2026-09-28T02:30:00Z"))
  const out = (await tool.execute({}, ctx())) as string
  expect(out).toContain("Thứ hai, 28/09/2026 09:30:00")
  expect(out).toContain("+07:00")
})

test("load_skill lists skills and returns a body, unknown names are an error", async () => {
  const tool = loadSkillTool(() => [{ name: "devil-advocate", description: "phản biện", body: "BODY" }])
  expect(tool.description).toContain("devil-advocate: phản biện")
  expect(await tool.execute({ name: "devil-advocate" }, ctx())).toBe("BODY")
  await expect(tool.execute({ name: "x" }, ctx())).rejects.toThrow("Không có skill")
})

test("registry builds a sorted AI SDK tool set and unregisters by prefix", () => {
  const registry = new ToolRegistry()
  registry.register(def({ name: "mcp__demo__b", execute: async () => "" }))
  registry.register(def({ name: "a_tool", execute: async () => "" }))
  registry.register(def({ name: "mcp__demo__a", input: { type: "object", properties: {} }, execute: async () => "" }))
  expect(Object.keys(registry.toToolSet())).toEqual(["a_tool", "mcp__demo__a", "mcp__demo__b"])
  registry.unregister("mcp__demo__")
  expect(registry.list().map((t) => t.name)).toEqual(["a_tool"])
})
