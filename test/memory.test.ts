import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HookBus } from "../src/core/hooks"

// Detailed memory behaviour lives in test/memory/*. This file covers the harness side: hooks and live switching.
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
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

test("createMemory: 'sqlite' (and the old name 'file') give the SQLite memory, anything else is off", async () => {
  const { createMemory } = await import("../src/core/runtime")
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-memory-"))
  dirs.push(home)
  for (const choice of ["sqlite", "file"] as const) {
    const m = createMemory(choice, home) as { id: string; close?: () => void }
    expect(m.id).toBe("sqlite")
    m.close?.()
  }
  expect(createMemory("none", home).id).toBe("none")
  expect(createMemory(undefined, home).id).toBe("none")
})

test("switching memory live swaps its tools and hooks and closes the old database", async () => {
  const { createMemory, initRuntime, switchMemory } = await import("../src/core/runtime")
  const { NoopMemory } = await import("../src/core/memory/types")
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-memory-"))
  dirs.push(home)
  const m = createMemory("sqlite", home) as ReturnType<typeof createMemory> & { list(): Promise<{ text: string }[]> }
  const runtime = initRuntime({ skills: () => [], memory: m, home })
  expect(runtime.registry.get("search_memory")).toBeDefined()
  expect(runtime.registry.get("propose_memory")).toBeUndefined() // the model has no write tool
  const saved = await runtime.hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "Ghi nhớ: Tôi không dùng margin" })
  expect(saved.context).toHaveLength(1)

  switchMemory(runtime, new NoopMemory())
  expect(runtime.memory.id).toBe("none")
  expect(runtime.registry.get("search_memory")).toBeUndefined()
  // The old provider's hook is detached: "Ghi nhớ" no longer saves anything.
  expect((await runtime.hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "Ghi nhớ: B" })).context).toEqual([])
  // and its database connection was closed
  expect(m.list()).rejects.toMatchObject({ code: "storage_failed" })

  const again = createMemory("sqlite", home) as typeof m
  switchMemory(runtime, again)
  expect(runtime.registry.get("search_memory")).toBeDefined()
  expect((await again.list()).map((i) => i.text)).toEqual(["[hồ sơ] Tôi không dùng margin"])
  ;(again as { close?: () => void }).close?.()
})
