import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { HookBus } from "../src/core/hooks"
import { FileMemory } from "../src/core/memory/file-memory"
import { notebookAdmin } from "../src/core/memory/notebook/admin"
import { UNLOADED_NOTE } from "../src/core/memory/notebook/render"
import { NoopMemory } from "../src/core/memory/types"
import { closeMemory, createMemory, switchMemory, type Runtime } from "../src/core/runtime"
import { ToolRegistry } from "../src/core/tools/registry"
import { LESSON_7, seedExample, useNotebookDir } from "./helpers/memory-notebook"

const nb = useNotebookDir()
const contender = path.join(import.meta.dir, "fixtures", "scripts", "memory-store-contender.ts")
const SID = { sessionId: "s1" }

/** A child holding the store's write lock; the test kills it in `finally` (Windows keeps the file locked). */
async function holdLock(mode: "hold" | "lock", file: string, ms: number) {
  const child = Bun.spawn([process.execPath, contender, mode, file, String(ms)], { stdout: "pipe", stderr: "inherit" })
  const reader = child.stdout.getReader()
  let out = ""
  while (!out.includes("held")) {
    const { value, done } = await reader.read()
    if (done) break
    out += new TextDecoder().decode(value)
  }
  expect(out).toContain("held")
  return child
}

/** recall, then turn-end carrying what recall returned, as the core does. */
async function turn(notebook: ReturnType<typeof nb.notebook>, hooks: HookBus, query: string, sessionId = "s1") {
  const items = (await notebook.recall(query, { sessionId })).map((i) => i.text)
  await hooks.emit({ type: "turn-end", sessionId, messages: [{ role: "user", content: items.map((t) => `- ${t}`).join("\n") }] })
  return items
}

/** The smallest stand-in for a runtime that switchMemory needs. */
const runtimeStub = () => ({ registry: new ToolRegistry(), hooks: new HookBus(), memory: new NoopMemory() }) as unknown as Runtime

describe("a store that cannot be opened", () => {
  test("newer schema: told on every channel, the error line once a session, no retry on its own", async () => {
    nb.store().close()
    nb.raw().run("PRAGMA user_version = 99")
    const notebook = nb.notebook()
    const hooks = new HookBus()
    notebook.register(hooks)
    const line = "[Memory · lỗi] Kho memory không mở được: kho do phiên bản OpenTrading mới hơn tạo."
    expect(notebook.problems()[0]).toContain(nb.file())
    expect(notebook.problems()[0]).toContain("chọn lại «Sổ ghi nhớ» trong /config")
    expect(await turn(notebook, hooks, "Hòa Phát?")).toEqual([line])
    expect(notebook.instructions()).toContain(UNLOADED_NOTE)
    expect(await turn(notebook, hooks, "Còn gì?")).toEqual([])
    expect(notebook.instructions()).toContain(UNLOADED_NOTE)
    expect(await turn(notebook, hooks, "Phiên mới", "s2")).toEqual([line])
    // Fixed behind its back, it still waits for the user to choose it again: no retry for this kind.
    nb.raw().run("PRAGMA user_version = 1")
    expect(await turn(notebook, hooks, "Thử lại?")).toEqual([])
    expect(notebook.instructions()).toContain(UNLOADED_NOTE)
    expect(await notebook.index(SID)).toBeUndefined()
  })

  test("busy while another window creates the store: the next turn retries once and recovers", async () => {
    const child = await holdLock("lock", nb.file(), 1500)
    try {
      const notebook = nb.notebook({ busyTimeoutMs: 100, retryBusyTimeoutMs: 100 })
      const hooks = new HookBus()
      notebook.register(hooks)
      expect(notebook.problems()[0]).toContain("bận")
      expect(notebook.problems()[0]).toContain("tự thử mở lại")
      expect(await turn(notebook, hooks, "a")).toEqual([
        "[Memory · lỗi] Kho memory không mở được: một cửa sổ OpenTrading khác đang nâng cấp kho.",
      ])
      await child.exited
      expect(await turn(notebook, hooks, "b")).toEqual([])
      expect(notebook.problems()).toEqual([])
      expect(notebook.instructions()).not.toContain(UNLOADED_NOTE)
      // A different failure later in the same session is told again.
      nb.raw().run("DROP TABLE constraints")
      expect(await turn(notebook, hooks, "c")).toEqual(["[Memory · lỗi] Kho memory không mở được: kho báo lỗi khi đọc."])
    } finally {
      child.kill()
      await child.exited
    }
  }, 15_000)

  test("a store broken mid-session: error state, nothing thrown, nothing passed off as empty", async () => {
    seedExample(nb.store())
    const notebook = nb.notebook()
    expect(await notebook.recall("Hòa Phát?", SID)).toHaveLength(1)
    nb.raw().run("DROP TABLE thesis_versions")
    const items = await notebook.recall("Hòa Phát?", { sessionId: "s2" })
    expect(items.map((i) => i.text)).toEqual(["[Memory · lỗi] Kho memory không mở được: kho báo lỗi khi đọc."])
    expect(notebook.instructions()).toContain(UNLOADED_NOTE)
    expect(notebook.problems()[0]).toContain(nb.file())
  })
})

describe("switching and closing", () => {
  test("switching to 'off' closes the store: memory_read is gone and the file can be deleted at once", () => {
    const seeder = nb.store()
    seedExample(seeder)
    const notebook = nb.notebook()
    const rt = runtimeStub()
    switchMemory(rt, notebook)
    expect(rt.registry.get("memory_read")?.source).toBe("memory:notebook")
    switchMemory(rt, new NoopMemory())
    expect(rt.registry.get("memory_read")).toBeUndefined()
    // The seeding connection is another window; close it too, then nothing holds the file.
    seeder.close()
    for (const name of readdirSync(nb.dir())) rmSync(path.join(nb.dir(), name))
    expect(existsSync(nb.file())).toBe(false)
  })

  test("closeMemory (the app's exit path) closes the notebook's store: the file can be deleted at once", () => {
    const seeder = nb.store()
    seedExample(seeder)
    seeder.close()
    const rt = runtimeStub()
    switchMemory(rt, createMemory("notebook", nb.dir()))
    expect(rt.memory.id).toBe("notebook")
    expect(rt.registry.get("memory_read")).toBeDefined()
    closeMemory(rt)
    closeMemory(rt)
    for (const name of readdirSync(nb.dir())) rmSync(path.join(nb.dir(), name))
    expect(existsSync(nb.file())).toBe(false)
  })

  test("the legacy file memory is unchanged by switching back and forth", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ot-filemem-"))
    try {
      const file = new FileMemory(dir)
      await file.add("Không dùng margin", { status: "active", via: "user" })
      const before = await file.list()
      const rt = runtimeStub()
      switchMemory(rt, file)
      switchMemory(rt, nb.notebook())
      switchMemory(rt, file)
      expect(await file.list()).toEqual(before)
      expect(notebookAdmin(file)).toBeUndefined()
      expect(notebookAdmin(new NoopMemory())).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the /memory handle (admin)", () => {
  test("only the notebook has one; it lists the five groups the user stored", () => {
    seedExample(nb.store())
    const admin = notebookAdmin(nb.notebook())!
    expect(admin.path).toBe(nb.file())
    const entries = admin.entries()
    const count = (g: string) => entries.filter((e) => e.group === g).length
    expect([count("constraint"), count("style"), count("thesis"), count("lesson"), count("decision")]).toEqual([2, 1, 3, 2, 1])
    const hpg = entries.find((e) => e.group === "thesis" && e.title === "HPG")!
    expect(hpg.version).toBe(3)
    expect(hpg.detail).toContain("Hưởng lợi từ đầu tư công")
    expect(hpg.detail).toContain("(1) Sai nếu biên gộp dưới 10% hai quý liền")
    expect(hpg.detail).toContain("31/12/2026")
    expect(hpg.detail).toContain("20/10/2026")
    expect(hpg.detail).toContain("tự ghi")
    const decision = entries.find((e) => e.group === "decision")!
    expect(decision.title).toBe("D1 Mua HPG")
  })

  test("deleting the version on screen works and says what it does and does not do", () => {
    seedExample(nb.store())
    const notebook = nb.notebook()
    const admin = notebookAdmin(notebook)!
    expect(admin.remove("lesson", { id: 7, version: 1 })).toEqual({
      ok: true,
      message:
        "Đã ngừng dùng bài học #7: model không còn nhận mục này. Nội dung đã gửi trước đây vẫn còn trong lịch sử các phiên đã dùng nó; trong hội thoại đang mở, model được dặn không dùng nữa. Bản đã gửi provider không thu hồi được.",
    })
    expect(admin.remove("thesis", { id: 2, version: 3 })).toMatchObject({ ok: true, message: expect.stringMatching(/^Đã ngừng dùng luận điểm HPG: /) })
    expect(admin.remove("decision", { id: 1 })).toMatchObject({ ok: true })
    expect(admin.entries().some((e) => e.group === "lesson" && e.id === 7)).toBe(false)
  })

  test("a version changed elsewhere is not deleted: conflict with the current version", () => {
    const other = nb.store()
    const { banks } = seedExample(other)
    const admin = notebookAdmin(nb.notebook())!
    other.writer.reviseLesson(7, 1, LESSON_7(banks))
    expect(admin.remove("lesson", { id: 7, version: 1 })).toEqual({
      ok: false,
      reason: "conflict",
      currentVersion: 2,
      message: "Mục này vừa được sửa ở nơi khác (đang là bản 2). Mở lại để xem bản mới.",
    })
    other.writer.deleteLesson(3, 1)
    expect(admin.remove("lesson", { id: 3, version: 1 })).toMatchObject({ ok: false, reason: "deleted" })
    other.writer.deleteThesis(2, 3)
    expect(admin.remove("thesis", { id: 2, version: 3 })).toMatchObject({ ok: false, reason: "deleted" })
  })

  test("another window holding the write lock: 'busy' in under 2 seconds, nothing deleted", async () => {
    seedExample(nb.store())
    const admin = notebookAdmin(nb.notebook())!
    const child = await holdLock("hold", nb.file(), 4000)
    try {
      const start = performance.now()
      expect(admin.remove("lesson", { id: 7, version: 1 })).toEqual({
        ok: false,
        reason: "busy",
        message: "Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại.",
      })
      expect(performance.now() - start).toBeLessThan(2000)
    } finally {
      child.kill()
      await child.exited
    }
    expect(admin.entries().some((e) => e.group === "lesson" && e.id === 7)).toBe(true)
  }, 15_000)

  test("a store that did not open: no entries, the reason instead", () => {
    nb.store().close()
    nb.raw().run("PRAGMA user_version = 99")
    const admin = notebookAdmin(nb.notebook())!
    expect(admin.entries()).toEqual([])
    expect(admin.problem()).toContain("mới hơn")
    expect(admin.remove("lesson", { id: 7, version: 1 })).toMatchObject({ ok: false, reason: "failed" })
  })

  test("after the notebook is switched off the handle no longer reads or deletes", () => {
    seedExample(nb.store())
    const notebook = nb.notebook()
    const admin = notebookAdmin(notebook)!
    notebook.close()
    expect(admin.entries()).toEqual([])
    expect(admin.remove("lesson", { id: 7, version: 1 })).toMatchObject({ ok: false, reason: "failed" })
  })

  test("outside the notebook's own folder, only the /memory dialogs import the admin handle", () => {
    const root = path.resolve(import.meta.dir, "..", "src")
    const admin = path.join(root, "core", "memory", "notebook", "admin")
    const own = path.join("core", "memory", "notebook") + path.sep
    const allowed = [path.join("tui", "dialogs", "memory.tsx"), path.join("tui", "dialogs", "notebook.tsx")]
    const importers: string[] = []
    // Every relative import (static or dynamic) resolved to a file, so "./admin" and "../core/…/admin" both count.
    const imports = (file: string) =>
      [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(\s*)["'](\.[^"']*)["']/g)].map((m) =>
        path.resolve(path.dirname(file), m[1]!).replace(/\.(tsx?|js)$/, ""),
      )
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && imports(full).includes(admin)) importers.push(path.relative(root, full))
      }
    }
    walk(root)
    expect(importers.length).toBeGreaterThan(0)
    expect(importers.filter((f) => !f.startsWith(own) && !allowed.includes(f))).toEqual([])
  })
})
