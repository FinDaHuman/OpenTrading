import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import type { ModelMessage } from "ai"
import { HPG_BLOCK_V3, seedExample, LESSON_7 } from "./helpers/memory-notebook"
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
const { App, clearTranscript, compact } = await import("../src/tui/app")
const { userMessage } = await import("../src/core/agent")
const { renderLessonBlock } = await import("../src/core/memory/notebook/render")
const { state, setState } = await import("../src/tui/state")
const { resetNotifications } = await import("../src/tui/notify")
const { closeMemory, createMemory, initRuntime, switchMemory } = await import("../src/core/runtime")
const { loadConfig, saveConfig } = await import("../src/core/config")
const { openMemoryStore } = await import("../src/core/memory/store/open")
const { FileMemory } = await import("../src/core/memory/file-memory")
const { NoopMemory } = await import("../src/core/memory/types")
const { promptFile } = await import("../src/core/prompt/assemble")

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

  test("a store from a newer app: the reason and what to do; the notebook's system part is the guide alone", async () => {
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
    // No "not loaded" sentence any more: a turn is held before any request (memory/binding).
    expect(runtime!.memory.instructions?.()).toBe(promptFile("memory")!)
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
    await until(() => state.notification?.text?.startsWith("Đã xoá") === true)
    expect(state.notification?.text).toBe(
      "Đã xoá bài học #7 khỏi ứng dụng. Từ lượt sau, model không còn nhận nội dung này, kể cả trong lịch sử hội thoại và khi mở lại phiên cũ. Câu trả lời trước đó của model có thể đã nhắc lại nội dung này. Bản đã gửi provider không thu hồi được.",
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

// ── Spec 006: masking in the open conversation, on resume, on export ─────────────────────────────

describe("masking memory blocks (spec 006)", () => {
  const session = () => import("../src/tui/session")
  const LESSON_7_BLOCK = renderLessonBlock({
    id: 7,
    version: 1,
    title: "Định giá ngân hàng",
    summary: "Dùng P/B và ROE, không dùng P/E",
    appliesToDisplay: ["Ngân hàng"],
    exceptions: "Ngân hàng đang tái cơ cấu",
    detail: "So P/B với trung bình ngành",
    tags: ["định giá"],
    createdAt: "2026-10-20T03:00:00.000Z",
  })
  const MARK7 = "Dùng P/B và ROE"
  /** A turn whose memory_read result is lesson #7, and one whose reminder carries HPG version 3. */
  const readTurn = (): ModelMessage[] => [
    { role: "user", content: "Bài học định giá ngân hàng?" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "memory_read", input: { lesson: 7 } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "memory_read", output: { type: "text", value: LESSON_7_BLOCK } }] },
    { role: "assistant", content: "Đã xem." },
  ]
  const hpgTurn = (): ModelMessage[] => [
    userMessage("Hòa Phát?", [`<memory_lien_quan>\n- ${HPG_BLOCK_V3}\n</memory_lien_quan>`]),
    { role: "assistant", content: "HPG ổn." },
  ]
  const redactLines = async (file: string) =>
    (await readFile(file, "utf8"))
      .split("\n")
      .filter((l) => l.includes('"type":"redact"'))
      .map((l) => JSON.parse(l))

  /** A runtime with memory off (nothing holds memory.db), a fresh session holding `turns`, written to disk. */
  async function sessionWith(turns: ModelMessage[][]) {
    const s = await session()
    runtime = initRuntime({ home, skills: () => [] })
    await s.startSession(runtime, "startup")
    for (const t of turns) {
      s.recordTurn(t)
      setState("history", (h) => [...h, ...t])
    }
    const receipt = await s.currentSession().flush()
    expect(receipt.pending).toEqual([])
    return { s, id: s.currentSession().id, file: s.currentSession().path! }
  }

  afterEach(async () => {
    if (runtime) await (await session()).startSession(runtime, "clear")
    setState({ compacting: false, streaming: false })
  })

  test("deleted while idle: the open history is masked and one redact line is written", async () => {
    const other = otherWindow()
    seedExample(other)
    const { s, file } = await sessionWith([readTurn()])
    other.writer.deleteLesson(7, 1)
    await s.redactOpen(runtime!.redaction)
    expect(JSON.stringify(state.history)).not.toContain(MARK7)
    expect(JSON.stringify(state.history)).toContain("[Memory · bài học #7 đã bị người dùng xoá]")
    await s.currentSession().flush()
    expect(await redactLines(file)).toMatchObject([{ items: [{ kind: "lesson", id: 7, versions: [1] }] }])
  })

  test("a delete on the /memory screen masks the open conversation through the check it is given", async () => {
    const other = otherWindow()
    seedExample(other)
    const s = await session()
    runtime = initRuntime({ home, skills: () => [], memory: createMemory("notebook", home) })
    await s.startSession(runtime, "startup")
    s.recordTurn(readTurn())
    setState("history", readTurn())
    await s.currentSession().flush()
    setState({ dialog: "memory" })
    setup = await testRender(() => <MemoryDialog memory={runtime!.memory} redaction={runtime!.redaction} />, { width: 110, height: 40 })
    await frameWith("Quyết định")
    await setup.mockInput.typeText("dinh gia")
    await frameWith("dinh gia")
    setup.mockInput.pressEnter()
    await frameWith("Dùng P/B và ROE")
    setup.mockInput.pressKey("d")
    await frameWith("enter xoá · esc huỷ")
    setup.mockInput.pressEnter()
    await until(() => !JSON.stringify(state.history).includes(MARK7))
    await s.currentSession().flush()
    expect(await redactLines(s.currentSession().path!)).toHaveLength(1)
  })

  test("deleted while compacting: nothing then; the compaction masks first and writes exactly one line", async () => {
    const other = otherWindow()
    seedExample(other)
    const { s, file } = await sessionWith([readTurn()])
    other.writer.deleteLesson(7, 1)
    setState({ compacting: true, streaming: true })
    await s.redactOpen(runtime!.redaction)
    expect(JSON.stringify(state.history)).toContain(MARK7)
    setState({ compacting: false, streaming: false })
    // No network: the summary fails, but the masking at its start has happened.
    await compact(runtime!, "manual")
    expect(JSON.stringify(state.history)).not.toContain(MARK7)
    await s.redactOpen(runtime!.redaction)
    await s.currentSession().flush()
    expect(await redactLines(file)).toHaveLength(1)
  })

  test("/new while the compaction's redaction check is still waiting: the new session gets nothing of the old", async () => {
    const other = otherWindow()
    seedExample(other)
    const { s } = await sessionWith([readTurn()])
    other.writer.deleteLesson(7, 1)
    const { redactionDisk } = await import("../src/core/memory/redaction/check")
    let release: (v: "present") => void = () => {}
    const waiting = new Promise<"present">((r) => (release = r))
    let looked = false
    const spy = spyOn(redactionDisk, "probe").mockImplementation(() => {
      looked = true
      return waiting
    })
    try {
      const compacting = compact(runtime!, "manual")
      await until(() => looked)
      await clearTranscript(runtime!)
      release("present")
      expect(await compacting).toBe(false)
      expect(state.history).toEqual([])
      await s.currentSession().flush()
      const file = s.currentSession().path
      expect(file === undefined || (await redactLines(file)).length === 0).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  test("resume: a deleted item is masked, told once, and recorded; reading never changed the file before", async () => {
    const other = otherWindow()
    seedExample(other)
    const { s, id, file } = await sessionWith([readTurn(), hpgTurn()])
    await s.startSession(runtime!, "clear")
    other.writer.deleteLesson(7, 1)
    await s.resumeSession(runtime!, id)
    expect(JSON.stringify(state.history)).not.toContain(MARK7)
    expect(JSON.stringify(state.history)).toContain(HPG_BLOCK_V3.split("\n")[0]!.slice(1, -1))
    expect(state.lines.some((l) => "text" in l && l.text === "Đã che 1 mục memory đã xoá trong phiên này.")).toBe(true)
    await s.currentSession().flush()
    expect(await redactLines(file)).toHaveLength(1)
  })

  test("store moved away: held, told, file untouched; moved back: HPG verbatim, #7 masked and recorded", async () => {
    const other = otherWindow()
    seedExample(other)
    const { s, id, file } = await sessionWith([readTurn(), hpgTurn()])
    await s.startSession(runtime!, "clear")
    other.writer.deleteLesson(7, 1)
    for (const o of opened.splice(0)) o.close()
    const before = await readFile(file)
    renameSync(STORE, `${STORE}.away`)
    await s.resumeSession(runtime!, id)
    expect(state.lines.some((l) => "text" in l && l.text === "Không tìm thấy kho memory; các khối memory trong phiên này tạm được che cho tới khi có lại kho.")).toBe(true)
    // The history keeps the blocks: each request is held by the turn itself.
    expect(JSON.stringify(state.history)).toContain(MARK7)
    await s.currentSession().flush()
    expect((await readFile(file)).equals(before)).toBe(true)
    await s.startSession(runtime!, "clear")
    renameSync(`${STORE}.away`, STORE)
    await s.resumeSession(runtime!, id)
    expect(JSON.stringify(state.history)).not.toContain(MARK7)
    expect(JSON.stringify(state.history)).toContain("Hưởng lợi từ đầu tư công")
    await s.currentSession().flush()
    expect(await redactLines(file)).toHaveLength(1)
  })

  test("store re-created the same day (#7 with other content): told, nothing recorded, file untouched", async () => {
    const other = otherWindow()
    seedExample(other)
    const { s, id, file } = await sessionWith([readTurn()])
    await s.startSession(runtime!, "clear")
    for (const o of opened.splice(0)) o.close()
    for (const name of readdirSync(home).filter((n) => n.startsWith("memory.db"))) rmSync(path.join(home, name))
    const fresh = otherWindow()
    for (let i = 1; i <= 7; i++) fresh.writer.addLesson({ title: `Bài ${i}`, summary: "Khác hẳn" })
    const before = await readFile(file)
    await s.resumeSession(runtime!, id)
    expect(state.lines.some((l) => "text" in l && l.text.startsWith("Một số khối memory trong phiên này khác bản đang có trong kho"))).toBe(true)
    await s.currentSession().flush()
    expect((await readFile(file)).equals(before)).toBe(true)
  })

  test("silent: no store and no block in the session, no word about memory", async () => {
    const { s, id } = await sessionWith([[{ role: "user", content: "xin chào" }, { role: "assistant", content: "chào" }]])
    await s.startSession(runtime!, "clear")
    await s.resumeSession(runtime!, id)
    expect(state.lines.some((l) => "text" in l && /kho memory|khối memory/.test(l.text))).toBe(false)
  })

  test("/export reads with the masks and writes nothing", async () => {
    const other = otherWindow()
    seedExample(other)
    const { s, file } = await sessionWith([readTurn()])
    other.writer.deleteLesson(7, 1)
    const before = await readFile(file)
    const out = await s.transcriptOfCurrent(runtime!)
    expect(out!.text).not.toContain(MARK7)
    expect((await readFile(file)).equals(before)).toBe(true)
  })

  test("/export with blocks it cannot vouch for: the held notice, once per state, as on resume", async () => {
    const heldCount = (start: string) => state.lines.filter((l) => "text" in l && l.text.startsWith(start)).length
    // No store at all.
    const { s } = await sessionWith([readTurn()])
    const out = await s.transcriptOfCurrent(runtime!)
    expect(out!.text).not.toContain(MARK7)
    await s.transcriptOfCurrent(runtime!)
    expect(heldCount("Không tìm thấy kho memory;")).toBe(1)
    // A store whose #7 has other content (re-created the same day).
    const fresh = otherWindow()
    for (let i = 1; i <= 7; i++) fresh.writer.addLesson({ title: `Bài ${i}`, summary: "Khác hẳn" })
    await s.transcriptOfCurrent(runtime!)
    await s.transcriptOfCurrent(runtime!)
    expect(heldCount("Một số khối memory trong phiên này khác bản đang có trong kho")).toBe(1)
  })

  test("a redact line not saved is told like any unsaved write, and on leaving", async () => {
    const s = await session()
    runtime = initRuntime({ home, skills: () => [] })
    await s.startSession(runtime, "startup")
    const receipt = { saved: [], pending: [], pendingCompactions: 0, pendingRedactions: 1, indexPending: false, stopped: false, error: new Error("ổ đầy") }
    expect(s.receiptLines(s.currentSession(), receipt).map((l) => l.text)).toEqual([
      "Chưa lưu được dòng che mục memory đã xoá: ổ đầy. Sẽ thử lại ở lượt sau.",
    ])
    expect(s.leavingLine(s.currentSession(), receipt)?.text).toContain("1 dòng che mục memory đã xoá")
  })
})
