import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HookBus } from "../src/core/hooks"
import { FileMemory } from "../src/core/memory/file-memory"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function memory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-memory-"))
  dirs.push(dir)
  return { dir, memory: new FileMemory(dir) }
}

const ctx = { signal: new AbortController().signal, callId: "c" }

test("proposals stay pending and invisible until approved", async () => {
  const { memory: m } = await memory()
  const propose = m.tools().find((t) => t.name === "propose_memory")!
  expect(await propose.execute({ text: "Người dùng không giao dịch margin." }, ctx)).toContain("duyệt")
  const [item] = await m.list()
  expect(item).toMatchObject({ status: "pending", source: { via: "model" } })
  expect(await m.index()).toBeUndefined()
  expect(await m.recall("có nên dùng margin không")).toEqual([])

  await m.approve(item!.id)
  expect(await m.index()).toBe("- Người dùng không giao dịch margin.")
  expect((await m.recall("có nên dùng margin không")).map((i) => i.text)).toEqual(["Người dùng không giao dịch margin."])
})

test("reject and remove delete the file", async () => {
  const { memory: m } = await memory()
  const a = await m.add("A thích ngân hàng", { status: "pending", via: "model" })
  const b = await m.add("B tránh bất động sản", { status: "active", via: "user" })
  await m.reject(a.id)
  await m.remove(b.id)
  expect(await m.list()).toEqual([])
})

test("memories are readable markdown files", async () => {
  const { dir, memory: m } = await memory()
  const item = await m.add("Tôi nắm giữ 6–24 tháng", { status: "active", via: "user" })
  const text = await readFile(path.join(dir, `${item.id}.md`), "utf8")
  expect(text).toContain('status: "active"')
  expect(text.trim().endsWith("Tôi nắm giữ 6–24 tháng")).toBe(true)
})

test('"Ghi nhớ: …" saves an active memory through the user-prompt hook', async () => {
  const { memory: m } = await memory()
  const hooks = new HookBus()
  m.register(hooks)
  const outcome = await hooks.emit({ type: "user-prompt", sessionId: "s1", prompt: "Ghi nhớ: tôi không mua cổ phiếu UPCoM" })
  expect(outcome.context[0]).toContain("tôi không mua cổ phiếu UPCoM")
  expect(await m.list()).toMatchObject([{ status: "active", text: "tôi không mua cổ phiếu UPCoM", source: { via: "user", sessionId: "s1" } }])
  const plain = await hooks.emit({ type: "user-prompt", sessionId: "s1", prompt: "giá FPT hôm nay?" })
  expect(plain.context).toEqual([])
})

test("hook bus: block wins, context is collected, a failing hook is reported not thrown", async () => {
  const hooks = new HookBus()
  hooks.on("user-prompt", () => ({ additionalContext: "ngữ cảnh A" }))
  hooks.on("user-prompt", () => {
    throw new Error("hỏng")
  })
  hooks.on("user-prompt", (e) => (e.prompt.includes("nội gián") ? { block: "Yêu cầu vi phạm chính sách." } : undefined))
  const normal = await hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "xin chào" })
  expect(normal.block).toBeUndefined()
  expect(normal.context).toEqual(["ngữ cảnh A"])
  expect(normal.errors[0]).toContain("hỏng")
  const blocked = await hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "tin nội gián" })
  expect(blocked.block).toBe("Yêu cầu vi phạm chính sách.")
  const off = hooks.on("session-end", () => ({ additionalContext: "x" }))
  off()
  expect((await hooks.emit({ type: "session-end", sessionId: "s" })).context).toEqual([])
})

test("switching memory live swaps its tools and hooks", async () => {
  const { initRuntime, switchMemory } = await import("../src/core/runtime")
  const { NoopMemory } = await import("../src/core/memory/types")
  const { memory: m } = await memory()
  const runtime = initRuntime({ skills: () => [], memory: m })
  expect(runtime.registry.get("propose_memory")).toBeDefined()
  expect((await runtime.hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "Ghi nhớ: A" })).context).toHaveLength(1)

  switchMemory(runtime, new NoopMemory())
  expect(runtime.memory.id).toBe("none")
  expect(runtime.registry.get("propose_memory")).toBeUndefined()
  // The old provider's hook is detached: "Ghi nhớ" no longer saves anything.
  expect((await runtime.hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "Ghi nhớ: B" })).context).toEqual([])
  expect((await m.list()).map((i) => i.text)).toEqual(["A"])

  switchMemory(runtime, m)
  expect(runtime.registry.get("propose_memory")).toBeDefined()
})

test("one broken memory file is skipped and reported; the valid ones still reach index and recall", async () => {
  const { dir, memory: m } = await memory()
  await m.add("Người dùng không dùng margin", { status: "active", via: "user" })
  await Bun.write(path.join(dir, "corrupt.md"), '---\nid: "x\nscope: [user\n---\nhỏng')
  const items = await m.list()
  expect(items.map((i) => i.text)).toEqual(["Người dùng không dùng margin"])
  expect(m.problems()).toHaveLength(1)
  expect(m.problems()[0]).toContain("corrupt.md")
  expect(await m.index()).toContain("margin")
  expect((await m.recall("có dùng margin không")).map((i) => i.text)).toEqual(["Người dùng không dùng margin"])
})
