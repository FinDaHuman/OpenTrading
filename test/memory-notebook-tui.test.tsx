import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, readdirSync, rmSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { seedExample, LESSON_7 } from "./helpers/memory-notebook"
import { testClock } from "./helpers/memory-store"

// Config, the store and sessions go to a scratch home, never ~/.opentrading; no network.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-notebook-tui-"))
const savedHome = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"
const CATALOG = {
  groq: {
    id: "groq",
    name: "Groq",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/groq",
    models: { m: { id: "m", name: "M", tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 131072 } } },
  },
}
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  throw new Error(`no network in tests: ${url}`)
}) as typeof fetch

const { ConfigDialog } = await import("../src/tui/dialogs/config")
const { MemoryDialog } = await import("../src/tui/dialogs/memory")
const { App } = await import("../src/tui/app")
const { state, setState } = await import("../src/tui/state")
const { resetNotifications } = await import("../src/tui/notify")
const { closeMemory, createMemory, initRuntime, switchMemory } = await import("../src/core/runtime")
const { loadConfig, saveConfig } = await import("../src/core/config")
const { openMemoryStore } = await import("../src/core/memory/store/open")
const { FileMemory } = await import("../src/core/memory/file-memory")
const { NoopMemory } = await import("../src/core/memory/types")

const STORE = path.join(home, "memory.db")
const contender = path.join(import.meta.dir, "fixtures", "scripts", "memory-store-contender.ts")

type Runtime = ReturnType<typeof initRuntime>
let setup: Awaited<ReturnType<typeof testRender>> | undefined
let runtime: Runtime | undefined
const opened: { close(): void }[] = []

beforeEach(async () => {
  await saveConfig({ provider: "groq", model: "m", update: { check: false } })
})
afterEach(async () => {
  setup?.renderer.destroy()
  setup = undefined
  if (runtime) {
    closeMemory(runtime)
    switchMemory(runtime, new NoopMemory())
    await runtime.mcp.stop()
  }
  runtime = undefined
  for (const s of opened.splice(0)) s.close()
  resetNotifications()
  setState({ dialog: undefined, lines: [] })
  // Nothing may still hold the store: removing it fails on Windows otherwise.
  for (const name of readdirSync(home).filter((n) => n.startsWith("memory.db"))) rmSync(path.join(home, name))
})
afterAll(async () => {
  globalThis.fetch = realFetch
  if (savedHome === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = savedHome
  await rm(home, { recursive: true, force: true })
})

/** Another window's connection to the store, seeded with the spec's example. */
function otherWindow() {
  const store = openMemoryStore(STORE, { now: testClock(new Date("2026-10-20T03:00:00.000Z")).now })
  opened.push(store)
  return store
}

async function frameWith(text: string | ((f: string) => boolean)) {
  const ok = typeof text === "string" ? (f: string) => f.includes(text) : text
  let frame = ""
  for (let i = 0; i < 100 && !ok(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    await setup!.renderOnce()
    frame = setup!.captureCharFrame()
  }
  return frame
}
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10))
  expect(await check()).toBe(true)
}

async function openConfig(runtimeHome = home) {
  runtime = initRuntime({ home: runtimeHome, skills: () => [] })
  setState({ dialog: "config" })
  setup = await testRender(() => <ConfigDialog runtime={runtime!} />, { width: 110, height: 40 })
  await frameWith("Cài đặt")
}
/** Memory is the first row of /config: enter opens its three choices; type to filter, enter to pick. */
async function chooseMemory(filter: string) {
  setup!.mockInput.pressEnter()
  await frameWith("Sổ ghi nhớ")
  await setup!.mockInput.typeText(filter)
  await frameWith((f) => !f.includes("Memory cũ") || filter.startsWith("memory"))
  setup!.mockInput.pressEnter()
}

describe("/config: three memory choices", () => {
  test("Sổ ghi nhớ opens memory.db at once and is saved; Tắt closes it and the file can be deleted", async () => {
    await openConfig()
    await chooseMemory("so ghi")
    await until(() => runtime!.memory.id === "notebook")
    expect((await loadConfig()).memory).toEqual({ provider: "notebook" })
    expect(runtime!.registry.get("memory_read")?.source).toBe("memory:notebook")
    expect(existsSync(STORE)).toBe(true)
    expect(state.notification?.text).toContain("Đã bật sổ ghi nhớ")
    const list = await frameWith("Cài đặt")
    expect(list).toContain("Sổ ghi nhớ")
    await chooseMemory("tat")
    await until(() => runtime!.memory.id === "none")
    expect((await loadConfig()).memory).toEqual({ provider: "none" })
    expect(runtime!.registry.get("memory_read")).toBeUndefined()
    for (const name of readdirSync(home).filter((n) => n.startsWith("memory.db"))) rmSync(path.join(home, name))
    expect(existsSync(STORE)).toBe(false)
  })

  test("picking the notebook while it is open and healthy keeps the same provider (what was sent stays known)", async () => {
    await openConfig()
    await chooseMemory("so ghi")
    await until(() => runtime!.memory.id === "notebook")
    const first = runtime!.memory
    await frameWith("Cài đặt")
    await chooseMemory("so ghi")
    await until(() => state.notification?.text === "Đang chọn «Sổ ghi nhớ»; không đổi gì.")
    expect(runtime!.memory).toBe(first)
    expect(await runtime!.memory.index?.({ sessionId: "s" })).toBeUndefined()
    expect(runtime!.memory.instructions?.()).not.toContain("chưa được nạp")
  })

  test("picking 'Tắt' while memory is off says it is already chosen, and changes nothing", async () => {
    await openConfig()
    expect(runtime!.memory.id).toBe("none")
    const before = runtime!.memory
    await chooseMemory("tat")
    await until(() => state.notification?.text === "Đang chọn «Tắt»; không đổi gì.")
    expect(runtime!.memory).toBe(before)
  })

  test("the store opens in the runtime's own data folder, not wherever OPENTRADING_HOME points", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "ot-notebook-home-"))
    try {
      await openConfig(other)
      await chooseMemory("so ghi")
      await until(() => runtime!.memory.id === "notebook")
      expect(existsSync(path.join(other, "memory.db"))).toBe(true)
      expect(existsSync(STORE)).toBe(false)
    } finally {
      closeMemory(runtime!)
      switchMemory(runtime!, new NoopMemory())
      await rm(other, { recursive: true, force: true })
    }
  })

  test("the three choices are listed with the current one marked", async () => {
    await openConfig()
    setup!.mockInput.pressEnter()
    const f = await frameWith("Sổ ghi nhớ")
    expect(f).toContain("Tắt")
    expect(f).toContain("Memory cũ")
    expect(f).toMatch(/● Tắt/)
  })

  test("a store from a newer app: the reason and what to do, chat keeps working", async () => {
    otherWindow().close()
    opened.length = 0
    const raw = new Database(STORE)
    raw.run("PRAGMA user_version = 99")
    raw.close(true)
    await openConfig()
    await chooseMemory("so ghi")
    await until(() => runtime!.memory.id === "notebook")
    expect(state.notification?.level).toBe("error")
    expect(state.notification?.text).toContain("mới hơn")
    expect(state.notification?.text).toContain("chọn lại «Sổ ghi nhớ» trong /config")
    expect(runtime!.memory.instructions?.()).toContain("ràng buộc đã lưu chưa được nạp")
  })
})

describe("startup", () => {
  test("a notebook that failed to open is reported in the transcript when the app starts", async () => {
    otherWindow().close()
    opened.length = 0
    const raw = new Database(STORE)
    raw.run("PRAGMA user_version = 99")
    raw.close(true)
    runtime = initRuntime({ home, skills: () => [], memory: createMemory("notebook", home) })
    setup = await testRender(() => <App runtime={runtime!} onExit={() => {}} />, { width: 100, height: 32, exitOnCtrlC: false })
    await until(() => state.lines.some((l) => l.kind === "error" && "text" in l && String(l.text).includes("Sổ ghi nhớ chưa dùng được")))
  })
})

describe("/memory with the notebook", () => {
  async function openMemory() {
    runtime = initRuntime({ home, skills: () => [], memory: createMemory("notebook", home) })
    setState({ dialog: "memory" })
    setup = await testRender(() => <MemoryDialog memory={runtime!.memory} />, { width: 110, height: 40 })
  }
  async function openEntry(filter: string, title: string) {
    await setup!.mockInput.typeText(filter)
    await frameWith(filter)
    setup!.mockInput.pressEnter()
    return frameWith(title)
  }

  test("five groups with their counts; each row has its id or code and version", async () => {
    seedExample(otherWindow())
    await openMemory()
    const f = await frameWith("Quyết định")
    for (const heading of ["Ràng buộc (2)", "Cách trình bày (1)", "Luận điểm (3)", "Bài học (2)", "Quyết định (1)"]) {
      expect(f).toContain(heading)
    }
    expect(f).toMatch(/#1 Không dùng margin, kể cả T\+0\s+bản 2/)
    expect(f).toMatch(/HPG\s+bản 3 · đang theo dõi/)
    expect(f).toMatch(/HSG\s+bản 1 · đã bị bác bỏ/)
    expect(f).toContain("D1 Mua HPG")
  })

  test("a thesis in full: text, conditions, review date, saved date, source", async () => {
    seedExample(otherWindow())
    await openMemory()
    await frameWith("Quyết định")
    const f = await openEntry("HPG", "Hưởng lợi từ đầu tư công")
    for (const part of ["Hưởng lợi từ đầu tư công", "(1) Sai nếu biên gộp dưới 10% hai quý liền", "31/12/2026", "20/10/2026", "tự ghi"]) {
      expect(f).toContain(part)
    }
  })

  test("delete asks first; Esc keeps it, Enter deletes with the agreed wording", async () => {
    seedExample(otherWindow())
    await openMemory()
    await frameWith("Quyết định")
    await openEntry("dinh gia", "Dùng P/B và ROE")
    setup!.mockInput.pressKey("d")
    await frameWith("enter xoá · esc huỷ")
    setup!.mockInput.pressEscape()
    await frameWith((f) => !f.includes("enter xoá · esc huỷ"))
    expect(runtime!.memory.instructions?.()).toBeDefined()
    setup!.mockInput.pressKey("d")
    await frameWith("enter xoá · esc huỷ")
    setup!.mockInput.pressEnter()
    await until(() => state.notification?.text?.startsWith("Đã ngừng dùng") === true)
    expect(state.notification?.text).toBe(
      "Đã ngừng dùng bài học #7: model không còn nhận mục này. Nội dung đã gửi trước đây vẫn còn trong lịch sử các phiên đã dùng nó; trong hội thoại đang mở, model được dặn không dùng nữa. Bản đã gửi provider không thu hồi được.",
    )
    expect(await runtime!.memory.index?.({ sessionId: "s" })).not.toContain("#7")
  })

  test("changed elsewhere while on screen: not deleted, told the current version", async () => {
    const other = otherWindow()
    const { banks } = seedExample(other)
    await openMemory()
    await frameWith("Quyết định")
    await openEntry("dinh gia", "Dùng P/B và ROE")
    other.writer.reviseLesson(7, 1, LESSON_7(banks))
    setup!.mockInput.pressKey("d")
    await frameWith("enter xoá · esc huỷ")
    setup!.mockInput.pressEnter()
    await until(() => state.notification?.text?.startsWith("Mục này vừa được sửa") === true)
    expect(state.notification?.text).toBe("Mục này vừa được sửa ở nơi khác (đang là bản 2). Mở lại để xem bản mới.")
  })

  test("another window holding the write lock: 'busy' in under 2 seconds", async () => {
    seedExample(otherWindow())
    await openMemory()
    await frameWith("Quyết định")
    await openEntry("dinh gia", "Dùng P/B và ROE")
    const child = Bun.spawn([process.execPath, contender, "hold", STORE, "4000"], { stdout: "pipe", stderr: "inherit" })
    try {
      const reader = child.stdout.getReader()
      let out = ""
      while (!out.includes("held")) out += new TextDecoder().decode((await reader.read()).value)
      setup!.mockInput.pressKey("d")
      await frameWith("enter xoá · esc huỷ")
      const start = performance.now()
      setup!.mockInput.pressEnter()
      await until(() => state.notification?.text?.startsWith("Kho memory đang bận") === true)
      expect(performance.now() - start).toBeLessThan(2000)
      expect(state.notification?.text).toBe("Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại.")
    } finally {
      child.kill()
      await child.exited
    }
  }, 15_000)

  test("a store that breaks after a delete is shown as unreadable, not as an empty notebook", async () => {
    seedExample(otherWindow())
    await openMemory()
    await frameWith("Quyết định")
    await openEntry("Mua HPG", "Lý do:")
    // Deleting a decision touches only its own table; listing again reads constraints and fails.
    const raw = new Database(STORE)
    raw.run("DROP TABLE constraint_versions")
    raw.close(true)
    setup!.mockInput.pressKey("d")
    await frameWith("enter xoá · esc huỷ")
    setup!.mockInput.pressEnter()
    await until(() => state.notification?.text?.startsWith("Đã xoá quyết định D1") === true)
    const f = await frameWith("△")
    expect(f).toContain("△")
    expect(f).not.toContain("Sổ ghi nhớ còn trống")
  })

  test("the legacy file memory keeps its own /memory screen", async () => {
    const dir = path.join(home, "memory")
    const file = new FileMemory(dir)
    await file.add("Không dùng margin", { status: "active", via: "user" })
    setState({ dialog: "memory" })
    setup = await testRender(() => <MemoryDialog memory={file} />, { width: 110, height: 40 })
    const f = await frameWith("Memory · 1")
    expect(f).toContain("Không dùng margin")
    expect(f).not.toContain("Ràng buộc (")
    rmSync(dir, { recursive: true, force: true })
  })
})
