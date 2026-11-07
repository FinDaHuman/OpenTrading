import { afterAll, afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-memory-"))
const savedHome = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home

const { HookBus } = await import("../src/core/hooks")
const { cardsEnabled, loadConfig, memoryChoiceOf, saveConfig } = await import("../src/core/config")
const { migrateLegacyMemory } = await import("../src/core/memory/legacy")
const { createMemory } = await import("../src/core/runtime")
type MemoryProvider = import("../src/core/memory/types").MemoryProvider

afterEach(async () => {
  for (const name of await readdir(home)) await rm(path.join(home, name), { recursive: true, force: true })
})
afterAll(async () => {
  await rm(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = savedHome
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

/** A provider with one read-only tool and one hook, to watch switchMemory attach and detach them. */
function fakeProvider(): MemoryProvider & { heard: string[] } {
  const heard: string[] = []
  return {
    id: "fake",
    heard,
    tools: () => [
      { name: "fake_read", description: "đọc", input: z.object({}), readOnly: true, execute: async () => "ok" },
    ],
    register: (hooks) =>
      hooks.on("user-prompt", (e) => {
        heard.push(e.prompt)
        return undefined
      }),
  }
}

test("switching memory live swaps its tools and hooks", async () => {
  const { initRuntime, switchMemory } = await import("../src/core/runtime")
  const { NoopMemory } = await import("../src/core/memory/types")
  const m = fakeProvider()
  const runtime = initRuntime({ skills: () => [], memory: m })
  expect(runtime.registry.get("fake_read")).toBeDefined()
  await runtime.hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "A" })

  switchMemory(runtime, new NoopMemory())
  expect(runtime.memory.id).toBe("none")
  expect(runtime.registry.get("fake_read")).toBeUndefined()
  // The old provider's hook is detached.
  await runtime.hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "B" })
  expect(m.heard).toEqual(["A"])

  switchMemory(runtime, m)
  expect(runtime.registry.get("fake_read")).toBeDefined()
})

test("memoryChoiceOf: the removed legacy memory reads as the notebook, anything else unknown is off", () => {
  expect(memoryChoiceOf({})).toBe("none")
  expect(memoryChoiceOf({ memory: { provider: "none" } })).toBe("none")
  expect(memoryChoiceOf({ memory: { provider: "notebook" } })).toBe("notebook")
  expect(memoryChoiceOf({ memory: { provider: "file" } })).toBe("notebook")
  expect(memoryChoiceOf({ memory: { provider: "sqlite" as never } })).toBe("none")
})

test("cardsEnabled: on with the notebook unless switched off; never without the notebook", () => {
  expect(cardsEnabled({ memory: { provider: "notebook" } })).toBe(true)
  expect(cardsEnabled({ memory: { provider: "file" } })).toBe(true)
  expect(cardsEnabled({ memory: { provider: "notebook", cards: false } })).toBe(false)
  expect(cardsEnabled({ memory: { provider: "none", cards: true } })).toBe(false)
  expect(cardsEnabled({})).toBe(false)
})

test("createMemory: only off and the notebook exist; no legacy tool or hook is left", () => {
  expect(createMemory("none").id).toBe("none")
  const notebook = createMemory("notebook", home)
  expect(notebook.id).toBe("notebook")
  expect((notebook.tools?.() ?? []).map((t) => t.name)).toEqual(["memory_read"])
  notebook.register?.(new HookBus())?.()
})

const digest = async (file: string) => createHash("sha1").update(await readFile(file)).digest("hex")

test("migrateLegacyMemory: a config naming the legacy memory is written back as the notebook, said once; old files untouched", async () => {
  await saveConfig({ memory: { provider: "file" } })
  const folder = path.join(home, "memory")
  await mkdir(folder, { recursive: true })
  const files = ["a.md", "b.md", "c.md"].map((f) => path.join(folder, f))
  for (const [i, f] of files.entries()) await writeFile(f, `---\nid: "${i}"\nstatus: "active"\n---\nGhi chú ${i}\n`)
  const before = await Promise.all(files.map(digest))

  const notice = await migrateLegacyMemory(home)
  expect(notice).toContain("Memory cũ đã được gỡ")
  expect(notice).toContain(folder)
  expect(notice).toContain("/nho")
  expect(notice).toContain("/baihoc")
  expect((await loadConfig()).memory?.provider).toBe("notebook")
  expect(await Promise.all(files.map(digest))).toEqual(before)

  // Second start: nothing to move, nothing said.
  expect(await migrateLegacyMemory(home)).toBeUndefined()
})

test("migrateLegacyMemory: no old folder → moved, notice without a path; other configs untouched", async () => {
  await saveConfig({ memory: { provider: "file", cards: false } })
  const notice = await migrateLegacyMemory(home)
  expect(notice).toContain("Memory cũ đã được gỡ")
  expect(notice).not.toContain(path.join(home, "memory"))
  // Only the provider changes: the card switch the user set stays.
  expect((await loadConfig()).memory).toEqual({ provider: "notebook", cards: false })

  await saveConfig({ memory: { provider: "none" } })
  expect(await migrateLegacyMemory(home)).toBeUndefined()
  expect((await loadConfig()).memory?.provider).toBe("none")
})
