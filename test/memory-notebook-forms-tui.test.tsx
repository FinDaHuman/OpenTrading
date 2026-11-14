import { afterAll, afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { DECISION_MARKER, HPG_V3, seedExample, seedRenamed } from "./helpers/memory-notebook"
import { testClock } from "./helpers/memory-store"
import { pastEnterGrace, realClock } from "./helpers/clock"

// Config, the store, sessions and the prompt history go to a scratch home, never ~/.opentrading.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-notebook-forms-"))
const savedHome = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"
setDefaultTimeout(20_000)
for (const env of ["GROQ_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "NVIDIA_API_KEY"]) {
  delete process.env[env]
}
const CATALOG = {
  groq: {
    id: "groq",
    name: "Groq",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/groq",
    models: { m: { id: "m", name: "M", tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 131072 } } },
  },
}

/** Every request but the model catalog: the notebook commands must make none. */
const requests: string[] = []
const bodies: { messages: { role: string; content?: unknown }[] }[] = []
/** The turns' own requests (streamed), not the side ones such as the session title: that one may come in before the turn ends. */
const mainBodies = () => bodies.filter((b) => (b as { stream?: boolean }).stream)
let reply = "Đã rõ."
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  requests.push(url)
  if (url.endsWith("/chat/completions")) {
    const request = JSON.parse(String(init?.body)) as { messages: { role: string; content?: unknown }[]; stream?: boolean }
    bodies.push(request)
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const body = chunk({ role: "assistant", content: "" }) + chunk({ content: reply }) + chunk({}, "stop") + "data: [DONE]\n\n"
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
  }
  throw new Error(`no network in tests: ${url}`)
}) as typeof fetch

const { App } = await import("../src/tui/app")
const { state, setState } = await import("../src/tui/state")
const { resetNotifications } = await import("../src/tui/notify")
const { closeMemory, createMemory, initRuntime, switchMemory } = await import("../src/core/runtime")
const { saveConfig } = await import("../src/core/config")
const { setKey } = await import("../src/core/auth")
const { openMemoryStore } = await import("../src/core/memory/store/open")
const { NoopMemory } = await import("../src/core/memory/types")
const { historyFile, historyFlushed, resetHistory } = await import("../src/tui/prompt/history")
const { sessionsDir } = await import("../src/core/session/store")
const { startSession } = await import("../src/tui/session")

const STORE = path.join(home, "memory.db")
const LEGACY = path.join(home, "memory")
const KEY = "sk-ant-api03-" + "Zx9Yw8Vu7Ts6Rq5P".repeat(3)
const MARK = "MARKER-form-2b7e"

type Runtime = ReturnType<typeof initRuntime>
type MemoryChoice = Parameters<typeof createMemory>[0]
let setup: Awaited<ReturnType<typeof testRender>> | undefined
let runtime: Runtime | undefined
const opened: { close(): void }[] = []

beforeEach(async () => {
  await saveConfig({ provider: "groq", model: "m", update: { check: false } })
  requests.length = 0
  bodies.length = 0
  reply = "Đã rõ."
})
afterEach(async () => {
  realClock()
  setup?.renderer.destroy()
  setup = undefined
  if (runtime) {
    // A turn here opened a session file; the next test file must start on a fresh, unsaved session.
    await startSession(runtime, "clear")
    closeMemory(runtime)
    switchMemory(runtime, new NoopMemory())
    await runtime.mcp.stop()
  }
  runtime = undefined
  for (const s of opened.splice(0)) s.close()
  resetNotifications()
  setState({ dialog: undefined, lines: [], notebookForm: undefined, notebookFormDirty: false, notebookFormAskLeave: false })
  await historyFlushed()
  resetHistory()
  rmSync(historyFile(), { force: true })
  rmSync(LEGACY, { recursive: true, force: true })
  rmSync(sessionsDir(), { recursive: true, force: true })
  rmSync(path.join(home, "auth.json"), { force: true })
  // Nothing may still hold the store: removing it fails on Windows otherwise.
  for (const name of readdirSync(home).filter((n) => n.startsWith("memory.db"))) rmSync(path.join(home, name))
})
afterAll(async () => {
  globalThis.fetch = realFetch
  if (savedHome === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = savedHome
  await rm(home, { recursive: true, force: true })
})

/** Another window's connection to the store. */
function otherWindow() {
  const store = openMemoryStore(STORE, { now: testClock(new Date("2026-10-20T03:00:00.000Z")).now })
  opened.push(store)
  return store
}

async function start(choice: MemoryChoice = "notebook", height = 44) {
  runtime = initRuntime({ home, skills: () => [], memory: createMemory(choice, home) })
  setup = await testRender(() => <App runtime={runtime!} onExit={() => {}} />, { width: 110, height, exitOnCtrlC: false })
  await frameWith("Hỏi về thị trường")
}

/**
 * The first rendered frame that has `text`. Always renders first (a check such as "no longer shows X" must not
 * pass on the empty frame before any render) and fails on timeout instead of returning the last frame.
 */
async function frameWith(text: string | ((f: string) => boolean)) {
  const ok = typeof text === "string" ? (f: string) => f.includes(text) : text
  let frame = ""
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 10))
    await setup!.renderOnce()
    frame = setup!.captureCharFrame()
    if (ok(frame)) return frame
  }
  throw new Error(`frame never showed ${typeof text === "string" ? JSON.stringify(text) : "the expected state"}:
${frame}`)
}
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10))
  expect(await check()).toBe(true)
}

async function history(): Promise<{ text: string; ts?: number; pastes?: Record<string, string> }[]> {
  await historyFlushed()
  if (!existsSync(historyFile())) return []
  return readFileSync(historyFile(), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}
const historyRaw = async () => {
  await historyFlushed()
  return existsSync(historyFile()) ? readFileSync(historyFile(), "utf8") : ""
}

async function type(text: string) {
  await setup!.mockInput.typeText(text)
  await frameWith(text.slice(-12))
}
const enter = () => setup!.mockInput.pressEnter()
const ctrlC = () => setup!.mockInput.pressKey("c", { ctrl: true })
async function escTwice() {
  setup!.mockInput.pressEscape()
  await frameWith("Esc lần nữa")
  setup!.mockInput.pressEscape()
}

/** Every file under the sessions folder, as one string. */
async function sessionFiles(): Promise<string> {
  const dir = sessionsDir()
  if (!existsSync(dir)) return ""
  const files = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile())
  return files.map((e) => readFileSync(path.join(e.parentPath, e.name), "utf8")).join("\n")
}

describe("prompt history keeps only the command name (four ways out of the box)", () => {
  test("Enter: '/nho …' is remembered as '/nho'; ↑ brings back '/nho'", async () => {
    await start()
    await type("/nho Không dùng margin")
    enter()
    await until(() => state.dialog === "notebook-form")
    expect(await history()).toEqual([expect.objectContaining({ text: "/nho" })])
    expect(state.notebookForm).toMatchObject({ group: "constraint", text: "Không dùng margin" })
    expect(requests).toEqual([])
  })

  test("Esc twice and Ctrl+C on an unsent '/luandiem …' keep only '/luandiem'", async () => {
    await start()
    await type("/luandiem HPG Hưởng lợi từ đầu tư công")
    await escTwice()
    await frameWith((f) => !f.includes("Hưởng lợi"))
    await type("/luandiem HPG Hưởng lợi từ đầu tư công")
    ctrlC()
    await frameWith((f) => !f.includes("Hưởng lợi"))
    const raw = await historyRaw()
    expect((await history()).map((h) => h.text)).toEqual(["/luandiem"])
    expect(raw).not.toContain("HPG")
    expect(raw).not.toContain("Hưởng lợi")
  })

  test("picking /baihoc in the '/' list remembers '/baihoc' and opens its form", async () => {
    await start()
    await type("/baihoc")
    await frameWith("enter chạy")
    enter()
    await until(() => state.dialog === "notebook-form")
    expect(state.notebookForm).toMatchObject({ group: "lesson" })
    expect((await history()).map((h) => h.text)).toEqual(["/baihoc"])
  })

  test("a 2,000-character paste reaches the form whole; the history has no paste", async () => {
    await start()
    const pasted = Array.from({ length: 20 }, (_, i) => `${MARK}-${String(i).padStart(2, "0")}`.padEnd(99, "x")).join("\n")
    expect(pasted.length).toBe(1_999)
    await type("/nho ")
    await setup!.mockInput.pasteBracketedText(pasted)
    await frameWith("Pasted text")
    enter()
    await until(() => state.dialog === "notebook-form")
    expect(state.notebookForm).toMatchObject({ group: "constraint", text: pasted })
    const entries = await history()
    expect(entries).toEqual([{ text: "/nho", ts: expect.any(Number) }])
    expect(await historyRaw()).not.toContain(MARK)
  })

  test("'/NHO …' is /nho; a chat line is remembered whole as before", async () => {
    await setKey("groq", "gsk_test_1234567890abcdefgh")
    await start()
    await type("/NHO Không dùng margin")
    enter()
    await until(() => state.dialog === "notebook-form")
    setState({ dialog: undefined, notebookForm: undefined })
    await frameWith("Hỏi về thị trường")
    await type("Phân tích HPG")
    enter()
    await until(() => !state.streaming && mainBodies().length === 1)
    expect((await history()).map((h) => h.text)).toEqual(["/nho", "Phân tích HPG"])
  })
})

describe("a notebook command while the notebook cannot be used", () => {
  test("off: told how to turn it on, the text stays in the box, nothing opened or created", async () => {
    await start("none")
    await type("/nho Không dùng margin")
    enter()
    const f = await frameWith("Sổ ghi nhớ đang tắt")
    expect(state.notification?.text).toBe(
      "Sổ ghi nhớ đang tắt; /nho chưa lưu gì. Bật trong /config (mục Memory → Sổ ghi nhớ) rồi gõ lại.",
    )
    expect(f).toContain("/nho Không dùng margin")
    expect(state.dialog).toBeUndefined()
    expect(existsSync(STORE)).toBe(false)
    // Cleared afterwards with Esc Esc: still only the name.
    await escTwice()
    await frameWith((f) => !f.includes("/nho Không dùng margin"))
    expect((await history()).map((h) => h.text)).toEqual(["/nho"])
  })

  test("a config still naming the removed legacy memory: the notebook opens, said once; the legacy folder is unchanged", async () => {
    const { loadConfig, memoryChoiceOf, saveConfig } = await import("../src/core/config")
    const config = path.join(home, "config.json")
    const before = existsSync(config) ? readFileSync(config, "utf8") : undefined
    try {
      await saveConfig({ memory: { provider: "file" } })
      mkdirSync(LEGACY, { recursive: true })
      writeFileSync(path.join(LEGACY, "old.md"), '---\nid: "1"\nstatus: "active"\n---\nKhông dùng margin\n')
      const legacyBefore = readFileSync(path.join(LEGACY, "old.md"), "utf8")
      await start(memoryChoiceOf(await loadConfig()))
      await frameWith("Memory cũ đã được gỡ")
      expect(runtime!.memory.id).toBe("notebook")
      expect((await loadConfig()).memory?.provider).toBe("notebook")
      const said = state.lines.filter((l) => l.kind === "info" && l.text.includes("Memory cũ đã được gỡ"))
      expect(said).toHaveLength(1)
      expect((said[0] as { text: string }).text).toContain(LEGACY)
      expect(readFileSync(path.join(LEGACY, "old.md"), "utf8")).toBe(legacyBefore)
    } finally {
      if (before === undefined) rmSync(config, { force: true })
      else writeFileSync(config, before)
    }
  })

  test("a store that failed to open: the reason and path, no form, the file untouched", async () => {
    otherWindow().close()
    opened.length = 0
    const raw = new Database(STORE)
    raw.run("PRAGMA user_version = 99")
    raw.close(true)
    const before = readFileSync(STORE)
    await start("notebook")
    await type("/luandiem HPG")
    enter()
    await frameWith("Sổ ghi nhớ chưa mở được")
    expect(state.notification?.text).toStartWith("Sổ ghi nhớ chưa mở được: ")
    expect(state.notification?.text).toContain(STORE)
    expect(state.dialog).toBeUndefined()
    expect(readFileSync(STORE).equals(before)).toBe(true)
  })
})


// ---------------------------------------------------------------------------------------------------------
// Forms. Keys: Tab moves between fields and buttons, a number picks an option or a choice, Enter on the
// confirm button saves. Nothing else saves.

const tab = (n = 1) => {
  for (let i = 0; i < n; i++) setup!.mockInput.pressTab()
}
const key = (k: string) => setup!.mockInput.pressKey(k)
const notice = () => state.notification?.text ?? ""
/** A frame as one line: long lines wrap at the pane's width. */
const flat = (frame: string) => frame.replace(/\s+/g, " ")

/** Types a notebook command into the prompt and waits for its form. */
async function command(text: string, title: string) {
  await type(text)
  enter()
  await until(() => state.dialog === "notebook-form")
  return frameWith(title)
}

/** Tab from the focused field `fieldsBefore` times to reach "[ Xác nhận ]", then Enter. */
async function confirm(fieldsBefore: number) {
  tab(fieldsBefore)
  await frameWith("Xác nhận")
  enter()
}

const CONSTRAINT_HINT = "( ) 1. Ràng buộc — điều bạn không bao giờ muốn vi phạm; luôn gửi cho model, không bao giờ cắt"
const STYLE_HINT = "( ) 2. Cách trình bày — bạn muốn câu trả lời trông thế nào"
const GUIDE =
  "Không ghi giá, số liệu hiện hành hay dự báo; model lấy số mới bằng tool. Ngưỡng của bạn (tối đa 20%, Sai nếu biên gộp dưới 10%) thì được."

/** Closes every connection to the store, then reads memory.db and its WAL as text. */
function storeBytes(): string {
  for (const s of opened.splice(0)) s.close()
  if (runtime) {
    closeMemory(runtime)
    switchMemory(runtime, new NoopMemory())
  }
  return readdirSync(home)
    .filter((n) => n.startsWith("memory.db"))
    .map((n) => readFileSync(path.join(home, n)).toString("utf8"))
    .join("")
}

describe("/nho: the remember form", () => {
  test("opens with the text, no section chosen, the criteria, the constraints in force; confirm is off", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    const f = flat(await command("/nho Không bán khống", "Ghi nhớ"))
    for (const part of [
      "Không bán khống",
      CONSTRAINT_HINT,
      STYLE_HINT,
      "Ràng buộc đang có (2 · 58/1.500 ký tự): #1 Không dùng margin, kể cả T+0 · #4 Tối đa 20% danh mục cho một mã",
      "Chọn ngăn trước khi xác nhận.",
      GUIDE,
    ]) {
      expect(f).toContain(part)
    }
    expect(f).not.toContain("agent con chưa nhận")
    await confirm(2)
    await frameWith("Xác nhận")
    expect(state.dialog).toBe("notebook-form")
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })

  test("Ràng buộc: saved as #5 version 1, typed by hand; the constraint set moves; the next turn sends it", async () => {
    const other = otherWindow()
    seedExample(other)
    await setKey("groq", "gsk_test_1234567890abcdefgh")
    await start()
    await command("/nho Không bán khống", "Ghi nhớ")
    tab()
    key("1")
    // Sub-agents now get every constraint too: the form no longer says they do not.
    const f = await frameWith("Tổng ràng buộc sau khi lưu")
    expect(f).not.toContain("agent con chưa nhận")
    await confirm(1)
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu ràng buộc #5 (bản 1). Có hiệu lực từ lượt hỏi kế tiếp.")
    expect(other.reader.constraint(5)).toMatchObject({ kind: "constraint", version: 1, text: "Không bán khống", source: "manual" })
    expect(other.reader.constraintSet()).toBe(6)
    expect(requests).toEqual([])
    await type("Phân tích HPG")
    enter()
    await until(() => !state.streaming && mainBodies().length === 1)
    expect(JSON.stringify(mainBodies()[0]!.messages.filter((m) => m.role === "system"))).toContain("[#5 · bản 1] Không bán khống")
  })

  test("Cách trình bày: saved, the constraint set stays", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/nho Có nguồn ở cuối", "Ghi nhớ")
    tab()
    key("2")
    await frameWith("(•) 2. Cách trình bày")
    await confirm(1)
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu cách trình bày #5 (bản 1). Có hiệu lực từ lượt hỏi kế tiếp.")
    expect(other.reader.constraintSet()).toBe(5)
  })

  test("over the 1,500 total: shown as 1.530/1.500, not confirmable, nothing cut or saved", async () => {
    const other = otherWindow()
    seedExample(other)
    // 58 already; seven of 198 and one of 6 bring the active total to 1,450.
    for (let i = 0; i < 7; i++) other.writer.addConstraint({ kind: "constraint", text: String(i).repeat(198) })
    other.writer.addConstraint({ kind: "constraint", text: "abcdef" })
    await start()
    await command("/nho " + "m".repeat(80), "Ghi nhớ")
    tab()
    key("1")
    const f = flat(await frameWith("1.530/1.500"))
    expect(f).toContain("Tổng ràng buộc sau khi lưu: 1.530/1.500 ký tự")
    expect(f).toContain("Vượt tổng 1.500 ký tự cho ràng buộc. Rút gọn hoặc xoá bớt ràng buộc cũ trong /memory.")
    await confirm(1)
    await frameWith("Vượt tổng")
    expect(state.dialog).toBe("notebook-form")
    expect(other.reader.constraints("constraint")).toHaveLength(10)
  })

  test("/nho alone opens an empty text field", async () => {
    seedExample(otherWindow())
    await start()
    await command("/nho", "Ghi nhớ")
    expect(state.notebookForm).toMatchObject({ group: "constraint", text: "" })
  })

  test("a key in the text: refused by the store; the message, history, session and store never hold it", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/nho dùng key " + KEY, "Ghi nhớ")
    tab()
    key("1")
    await confirm(1)
    const f = await frameWith("chuỗi giống khoá bí mật")
    expect(f).toContain("Kho memory không lưu khoá; bỏ chuỗi đó rồi lưu lại.")
    expect(state.dialog).toBe("notebook-form")
    expect(notice()).toContain("chuỗi giống khoá bí mật")
    expect(notice()).not.toContain(KEY)
    expect(state.lines.map((l) => JSON.stringify(l)).join("")).not.toContain(KEY)
    expect(await historyRaw()).not.toContain(KEY)
    expect(await sessionFiles()).not.toContain(KEY)
    expect(storeBytes()).not.toContain(KEY.slice(0, 24))
  })

  test("the same text as #1 (case, spaces): warned, saved when the user says so", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/nho không   dùng margin, kể cả t+0", "Ghi nhớ")
    tab()
    key("1")
    await frameWith("Trùng ràng buộc #1.")
    await confirm(1)
    await frameWith("Vẫn lưu")
    expect(other.reader.constraints("constraint")).toHaveLength(2)
    key("1")
    await until(() => state.dialog === undefined)
    expect(other.reader.constraint(5)).toMatchObject({ text: "không   dùng margin, kể cả t+0" })
  })

  test("Enter in the text field moves on, it never saves", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/nho Không bán khống", "Ghi nhớ")
    enter()
    key("1")
    await frameWith("(•) 1. Ràng buộc")
    expect(state.dialog).toBe("notebook-form")
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })

  test("Esc after typing asks first; dropping closes and saves nothing", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/nho Không bán khống", "Ghi nhớ")
    await setup!.mockInput.typeText(" nữa")
    await frameWith("khống nữa")
    setup!.mockInput.pressEscape()
    await frameWith("Bỏ nội dung đang sửa?")
    // Enter keeps the draft; only "1" drops it.
    enter()
    expect(flat(await frameWith("khống nữa"))).not.toContain("Bỏ nội dung đang sửa?")
    expect(state.dialog).toBe("notebook-form")
    setup!.mockInput.pressEscape()
    await frameWith("Bỏ nội dung đang sửa?")
    key("1")
    await until(() => state.dialog === undefined)
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })

  test("Ctrl+C after typing asks like Esc; untouched it closes at once; other dialogs still close at once", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/nho Không bán khống", "Ghi nhớ")
    await setup!.mockInput.typeText(" nữa")
    await frameWith("khống nữa")
    ctrlC()
    await frameWith("Bỏ nội dung đang sửa?")
    expect(state.dialog).toBe("notebook-form")
    expect(state.notebookFormAskLeave).toBe(false)
    key("2")
    await frameWith("khống nữa")
    await new Promise((r) => setTimeout(r, 850))
    ctrlC()
    await frameWith("Bỏ nội dung đang sửa?")
    key("1")
    await until(() => state.dialog === undefined)
    expect(other.reader.constraints("constraint")).toHaveLength(2)

    await new Promise((r) => setTimeout(r, 850))
    await command("/nho Không bán khống", "Ghi nhớ")
    ctrlC()
    await until(() => state.dialog === undefined)

    await new Promise((r) => setTimeout(r, 850))
    await type("/memory")
    enter()
    await until(() => state.dialog === "memory")
    ctrlC()
    await until(() => state.dialog === undefined)
  })
})

describe("a notebook command is not a chat turn", () => {
  test("after a real turn: the session file never gets what the form held; a reply saying '/nho …' opens nothing", async () => {
    const other = otherWindow()
    seedExample(other)
    await setKey("groq", "gsk_test_1234567890abcdefgh")
    await start()
    reply = "/nho Được dùng margin"
    await type("Phân tích HPG")
    enter()
    await until(() => !state.streaming && mainBodies().length === 1)
    await frameWith("Được dùng margin")
    expect(state.dialog).toBeUndefined()
    expect(other.reader.constraints("constraint")).toHaveLength(2)
    await until(async () => (await sessionFiles()).includes("Phân tích HPG"))

    const before = requests.length
    await command("/nho Không bán khống " + MARK, "Ghi nhớ")
    tab()
    key("1")
    await confirm(1)
    await until(() => state.dialog === undefined)
    expect(other.reader.constraint(5)).toMatchObject({ text: "Không bán khống " + MARK })
    expect(requests.length).toBe(before)
    expect(await sessionFiles()).not.toContain(MARK)
    expect(await historyRaw()).not.toContain(MARK)
  })

  test("no provider connected: the whole command runs with no request at all", async () => {
    const other = otherWindow()
    seedExample(other)
    await saveConfig({ update: { check: false } })
    await start()
    await command("/nho Không bán khống", "Ghi nhớ")
    tab()
    key("1")
    await confirm(1)
    await until(() => state.dialog === undefined)
    expect(other.reader.constraint(5)).toMatchObject({ text: "Không bán khống" })
    expect(requests).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------
// /luandiem. Field order of an existing subject: text, the conditions, review date, detail; then the buttons
// "Thêm điều kiện" and "Xác nhận". A new subject has its own four fields first: kind, sector, other
// aliases, uppercase only.

const contender = path.join(import.meta.dir, "fixtures", "scripts", "memory-store-contender.ts")
const backspace = (n: number) => {
  for (let i = 0; i < n; i++) setup!.mockInput.pressBackspace()
}

describe("/luandiem: a thesis, version by version", () => {
  test("an existing thesis opens on its current version", async () => {
    seedExample(otherWindow())
    await start()
    const f = flat(await command("/luandiem hpg", "Luận điểm HPG"))
    for (const part of [
      "Đang sửa từ bản 3",
      "Hưởng lợi từ đầu tư công",
      "Điều kiện 1",
      "Sai nếu biên gộp dưới 10% hai quý liền",
      "Điều kiện 2",
      "Sai nếu tồn kho tăng quá 30%",
      "31/12/2026",
      "Đầu tư công giải ngân mạnh năm 2026",
    ]) {
      expect(f).toContain(part)
    }
    expect(f).toContain("28/160")
  })

  test("changing condition 2 shows the change against version 3, then saves version 4", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    await start()
    await command("/luandiem HPG", "Luận điểm HPG")
    tab(2)
    backspace(3)
    await setup!.mockInput.typeText("25%")
    await frameWith("quá 25%")
    await confirm(4)
    const f = flat(await frameWith("Chỗ khác nhau so với bản 3"))
    expect(f).toContain("Điều kiện 2 bản 3: Sai nếu tồn kho tăng quá 30%")
    expect(f).toContain("bản mới: Sai nếu tồn kho tăng quá 25%")
    expect(f).not.toContain("Văn bản bản 3")
    expect(other.reader.thesis(hpg)?.version).toBe(3)
    key("1")
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu luận điểm HPG bản 4.")
    expect(other.reader.thesis(hpg)).toMatchObject({ version: 4, conditions: [expect.any(String), "Sai nếu tồn kho tăng quá 25%"] })
    expect(other.reader.thesisVersion(hpg, 3)).toMatchObject({ validTo: expect.any(String) })
  })

  test("a code not in the notebook: the subject's fields, then the subject and thesis version 1", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    const f = flat(await command("/luandiem FPT", "Luận điểm mới FPT"))
    for (const part of ["Chủ đề mới", "Loại", "(•) 1. mã", "Ngành", "Có sẵn: Thép, Ngân hàng", "Bí danh khác", "Chỉ khớp khi viết hoa"]) {
      expect(f).toContain(part)
    }
    tab()
    await setup!.mockInput.typeText("Công nghệ")
    tab()
    await setup!.mockInput.typeText("FPT Corp")
    tab(2)
    await setup!.mockInput.typeText("Chuyển đổi số")
    await frameWith("Chuyển đổi số")
    await confirm(5)
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu luận điểm FPT bản 1.")
    const fpt = other.reader.subjectByAlias("fpt corp")!
    expect(fpt).toMatchObject({ kind: "ticker", display: "FPT", currentVersion: 1 })
    expect(other.reader.subject(fpt.sectorId!)).toMatchObject({ kind: "sector", display: "Công nghệ" })
  })

  test("written again after a delete: 'bản trước đã xoá', saved as version 4", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    other.writer.deleteThesis(hpg, 3)
    await start()
    const f = await command("/luandiem HPG", "Luận điểm HPG")
    expect(f).toContain("Luận điểm mới (bản trước đã xoá)")
    await setup!.mockInput.typeText("Viết lại")
    await confirm(5)
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu luận điểm HPG bản 4.")
  })

  test("eight conditions: no ninth; each shows n/160", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    other.writer.saveThesis(hpg, 3, { text: "Tám điều kiện", conditions: Array.from({ length: 8 }, (_, i) => `Sai nếu ${i + 1}`) })
    await start()
    const f = flat(await command("/luandiem HPG", "Luận điểm HPG"))
    expect(f).toContain("Điều kiện 8")
    expect(f).toContain("9/160")
    expect(f).toContain("Tối đa 8 điều kiện.")
    // Text, 8 conditions, date, detail: the 11th Tab is "Thêm điều kiện".
    tab(11)
    enter()
    const after = flat(await frameWith("Tối đa 8 điều kiện."))
    expect(after).not.toContain("Điều kiện 9")
  })

  test("a refuted thesis: told the new version goes back to 'đang theo dõi'", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    other.writer.setThesisState(hpg, 3, "refuted")
    await start()
    const f = flat(await command("/luandiem HPG", "Luận điểm HPG"))
    expect(f).toContain("Lưu bản mới đưa trạng thái về «đang theo dõi».")
  })

  test("/luandiem alone asks for the code first; nothing confirmable until then", async () => {
    seedExample(otherWindow())
    await start()
    const f = flat(await command("/luandiem", "Luận điểm mới"))
    expect(f).toContain("Gõ mã hoặc tên chủ đề rồi Enter.")
    await setup!.mockInput.typeText("VCB")
    await frameWith("VCB")
    enter()
    await frameWith("Luận điểm VCB")
    expect(state.notebookForm).toMatchObject({ group: "thesis", alias: "VCB" })
  })

  test("a price in a condition warns without blocking; 'biên gộp dưới 10%' does not", async () => {
    const other = otherWindow()
    const { vcb } = seedExample(other)
    await start()
    await command("/luandiem VCB", "Luận điểm VCB")
    await setup!.mockInput.typeText("Biên gộp dưới 10% thì bán")
    tab()
    await setup!.mockInput.typeText("Sai nếu giá về dưới 20.000 đồng")
    const f = flat(await frameWith("Có vẻ đây là giá hoặc dự báo"))
    expect(f).toContain("Sổ ghi nhớ không phải nguồn số liệu; model sẽ lấy số mới bằng tool. Vẫn lưu nếu đây là ngưỡng của bạn.")
    await confirm(4)
    await frameWith("Vẫn lưu")
    key("1")
    await until(() => state.dialog === undefined)
    expect(other.reader.thesis(vcb)).toMatchObject({ version: 1, conditions: ["Sai nếu giá về dưới 20.000 đồng"] })
  })

  test("a retired code of another subject makes a new subject; that subject stays as it was", async () => {
    const other = otherWindow()
    seedExample(other)
    const renamed = seedRenamed(other)
    const before = other.reader.subject(renamed)
    await start()
    const f = flat(await command("/luandiem ABC", "Luận điểm mới ABC"))
    expect(f).toContain(
      `«ABC» từng là bí danh của chủ đề #${renamed} (nay là XYZ), đã thôi dùng ngày 20/10/2026. ` +
        `Lưu sẽ tạo chủ đề mới ABC; muốn viết luận điểm cho chủ đề #${renamed} thì gõ /luandiem XYZ.`,
    )
    tab(4)
    await setup!.mockInput.typeText("Mã mới")
    await confirm(5)
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu luận điểm ABC bản 1.")
    const abc = other.reader.subjectByAlias("ABC")!
    expect(abc.id).not.toBe(renamed)
    expect(abc.currentVersion).toBe(1)
    expect(other.reader.subject(renamed)).toEqual(before!)
  })

  test("another alias already used by HPG: nothing saved, the subject named", async () => {
    const other = otherWindow()
    seedExample(other)
    const count = other.reader.subjects().length
    await start()
    await command("/luandiem FPT", "Luận điểm mới FPT")
    tab(2)
    await setup!.mockInput.typeText("HPG")
    tab(2)
    await setup!.mockInput.typeText("Chuyển đổi số")
    await confirm(5)
    await frameWith("Bí danh «HPG» đang thuộc chủ đề HPG.")
    expect(notice()).toBe("Bí danh «HPG» đang thuộc chủ đề HPG.")
    expect(state.dialog).toBe("notebook-form")
    expect(other.reader.subjects()).toHaveLength(count)
  })
})

describe("two windows on one entry", () => {
  test("saved elsewhere meanwhile: nothing written, the differences field by field, the draft kept", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    await start()
    await command("/luandiem HPG", "Luận điểm HPG")
    tab(2)
    backspace(3)
    await setup!.mockInput.typeText("25%")
    await frameWith("quá 25%")
    other.writer.saveThesis(hpg, 3, { ...HPG_V3, text: "Hưởng lợi từ đầu tư công và giá thép phục hồi" })
    await confirm(4)
    await frameWith("Chỗ khác nhau so với bản 3")
    key("1")
    const f = flat(await frameWith("vừa được sửa ở nơi khác"))
    expect(f).toContain("Mục này vừa được sửa ở nơi khác (đang là bản 4).")
    expect(f).toContain("Văn bản bản 4: Hưởng lợi từ đầu tư công và giá thép phục hồi")
    expect(f).toContain("của bạn: Hưởng lợi từ đầu tư công")
    expect(f).toContain("Điều kiện 2 bản 4: Sai nếu tồn kho tăng quá 30%")
    expect(f).toContain("của bạn: Sai nếu tồn kho tăng quá 25%")
    expect(f).toContain("[1] Lưu bản của tôi thành bản 5")
    expect(f).toContain("[2] Bỏ bản của tôi, xem bản 4")
    expect(f).toContain("[3] Sửa tiếp")
    expect(other.reader.thesis(hpg)?.version).toBe(4)

    key("1")
    const review = flat(await frameWith("Chỗ khác nhau so với bản 4"))
    expect(review).toContain("Điều kiện 2 bản 4: Sai nếu tồn kho tăng quá 30%")
    key("1")
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu luận điểm HPG bản 5.")
    expect(other.reader.thesis(hpg)).toMatchObject({
      version: 5,
      text: "Hưởng lợi từ đầu tư công",
      conditions: [HPG_V3.conditions[0], "Sai nếu tồn kho tăng quá 25%"],
    })
    expect(other.reader.thesisVersion(hpg, 4)).toMatchObject({ text: "Hưởng lợi từ đầu tư công và giá thép phục hồi" })
  })

  test("'Bỏ bản của tôi, xem bản 4' loads version 4 into the form", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    await start()
    await command("/luandiem HPG", "Luận điểm HPG")
    tab(2)
    backspace(3)
    await setup!.mockInput.typeText("25%")
    other.writer.saveThesis(hpg, 3, { ...HPG_V3, text: "Bản của cửa sổ kia" })
    await confirm(4)
    await frameWith("Chỗ khác nhau so với bản 3")
    key("1")
    await frameWith("vừa được sửa ở nơi khác")
    key("2")
    const f = flat(await frameWith("Đang sửa từ bản 4"))
    expect(f).toContain("Bản của cửa sổ kia")
    expect(f).toContain("Sai nếu tồn kho tăng quá 30%")
  })

  test("a constraint deleted elsewhere: told so, saved as a new one when asked", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    setState({ notebookForm: { group: "constraint", edit: { id: 1 } }, dialog: "notebook-form" })
    await frameWith("Sửa ràng buộc #1")
    await setup!.mockInput.typeText(" luôn")
    await frameWith("T+0 luôn")
    other.writer.deleteConstraint(1, 2)
    await confirm(1)
    await frameWith("Chỗ khác nhau so với bản 2")
    key("1")
    const f = flat(await frameWith("đã bị xoá ở nơi khác"))
    expect(f).toContain("Mục này đã bị xoá ở nơi khác.")
    expect(f).toContain("[1] Lưu thành ràng buộc mới")
    expect(f).toContain("[2] Huỷ")
    key("1")
    await until(() => state.dialog === undefined)
    expect(other.reader.constraint(5)).toMatchObject({ text: "Không dùng margin, kể cả T+0 luôn", version: 1 })
  })

  test("another window holding the write lock: 'busy' in under 2 seconds, the form and store unchanged", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/nho Không bán khống", "Ghi nhớ")
    tab()
    key("1")
    tab()
    await frameWith("Xác nhận")
    const child = Bun.spawn([process.execPath, contender, "hold", STORE, "4000"], { stdout: "pipe", stderr: "inherit" })
    try {
      const reader = child.stdout.getReader()
      let out = ""
      while (!out.includes("held")) out += new TextDecoder().decode((await reader.read()).value)
      const started = performance.now()
      enter()
      await until(() => notice().startsWith("Kho memory đang bận"))
      expect(performance.now() - started).toBeLessThan(2000)
      expect(notice()).toBe("Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại.")
      expect(state.dialog).toBe("notebook-form")
      expect(flat(await frameWith("Không bán khống"))).toContain("Không bán khống")
    } finally {
      child.kill()
      await child.exited
    }
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------------------------------------
// /quyetdinh. Fields: action, reason, expectation, confidence, review date, what would change my mind,
// then (when the subject has a thesis) which version it rests on; then "Xác nhận".

const LOCAL_ONLY = "Nhật ký quyết định chỉ nằm trên máy này; không bao giờ được gửi cho model. Đây không phải lệnh giao dịch."

async function fillDecision(action: string, reason: string) {
  await setup!.mockInput.typeText(action)
  tab()
  await setup!.mockInput.typeText(reason)
  await frameWith(reason.slice(-10))
}

describe("/quyetdinh: the decision log rests on what the form showed", () => {
  test("the form shows thesis version 3 verbatim, says it stays on this machine; saved with basis 3", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    await setKey("groq", "gsk_test_1234567890abcdefgh")
    await start()
    const f = flat(await command("/quyetdinh HPG", "Quyết định HPG"))
    for (const part of [
      LOCAL_ONLY,
      "Căn cứ: luận điểm HPG bản 3",
      "Hưởng lợi từ đầu tư công",
      "(1) Sai nếu biên gộp dưới 10% hai quý liền",
      "(2) Sai nếu tồn kho tăng quá 30%",
      "1. Gắn bản 3",
      "2. Không gắn luận điểm",
      "Kỳ vọng",
      "Mức tự tin",
      "Ngày xem lại",
      "Điều gì làm đổi ý",
    ]) {
      expect(f).toContain(part)
    }
    await fillDecision("Mua HPG", "Biên gộp hồi phục " + MARK)
    await confirm(6)
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã ghi quyết định D2 (căn cứ: luận điểm HPG bản 3).")
    expect(other.reader.decision(2)).toMatchObject({ subjectId: hpg, basis: { version: 3 }, constraintSet: 5, action: "Mua HPG" })
    expect(requests).toEqual([])
    await type("Phân tích HPG")
    enter()
    await until(() => !state.streaming && mainBodies().length === 1)
    expect(JSON.stringify(bodies)).not.toContain(MARK)
  })

  test("a newer version saved elsewhere: asked; 'Bản 3' keeps the version the user saw", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    await start()
    await command("/quyetdinh HPG", "Quyết định HPG")
    await fillDecision("Mua HPG", "Biên gộp hồi phục")
    other.writer.saveThesis(hpg, 3, { text: "Bản bốn", conditions: [] })
    await confirm(6)
    const f = flat(await frameWith("vừa có bản 4"))
    expect(f).toContain("Luận điểm HPG vừa có bản 4 (bạn đang xem bản 3). Gắn quyết định với:")
    expect(f).toContain("[1] Bản 3, bản bạn đã xem")
    expect(f).toContain("[2] Xem bản 4 trước")
    expect(f).toContain("[3] Huỷ")
    expect(other.reader.decisions()).toHaveLength(1)
    key("1")
    await until(() => state.dialog === undefined)
    expect(other.reader.decision(2)).toMatchObject({ basis: { version: 3 } })
  })

  test("'Xem bản 4 trước' shows version 4; only a second confirm saves, with basis 4", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    await start()
    await command("/quyetdinh HPG", "Quyết định HPG")
    await fillDecision("Mua HPG", "Biên gộp hồi phục")
    other.writer.saveThesis(hpg, 3, { text: "Bản bốn", conditions: [] })
    await confirm(6)
    await frameWith("vừa có bản 4")
    key("2")
    const f = flat(await frameWith("Căn cứ: luận điểm HPG bản 4"))
    expect(f).toContain("Bản bốn")
    expect(f).toContain("Mua HPG")
    expect(other.reader.decisions()).toHaveLength(1)
    // Focus stays on "Xác nhận": a second, deliberate press saves.
    enter()
    await until(() => state.dialog === undefined)
    expect(other.reader.decision(2)).toMatchObject({ basis: { version: 4 } })
  })

  test("the version shown was deleted meanwhile: nothing written, the draft kept", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    await start()
    await command("/quyetdinh HPG", "Quyết định HPG")
    await fillDecision("Mua HPG", "Biên gộp hồi phục")
    other.writer.deleteThesis(hpg, 3)
    await confirm(6)
    const f = flat(await frameWith("vừa bị xoá"))
    expect(f).toContain("Luận điểm HPG bản 3 vừa bị xoá. Ghi quyết định không gắn luận điểm, hoặc huỷ.")
    expect(other.reader.decisions()).toHaveLength(1)
    key("2")
    expect(flat(await frameWith("Mua HPG"))).toContain("Biên gộp hồi phục")
    expect(other.reader.decisions()).toHaveLength(1)
  })

  test("no thesis yet: said so, saved with no basis", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    const f = flat(await command("/quyetdinh VCB", "Quyết định VCB"))
    expect(f).toContain("VCB chưa có luận điểm")
    await fillDecision("Mua VCB", "Định giá thấp")
    await confirm(5)
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã ghi quyết định D2 (căn cứ: không có luận điểm).")
    expect(other.reader.decision(2)).toMatchObject({ basis: "none" })
  })

  test("a ticker not in the notebook is created, with no thesis", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    const f = flat(await command("/quyetdinh mwg", "Quyết định MWG"))
    expect(f).toContain("MWG chưa có trong sổ; lưu sẽ tạo chủ đề MWG (loại mã).")
    await fillDecision("Mua MWG", "Bán lẻ hồi phục")
    await confirm(5)
    await until(() => state.dialog === undefined)
    const mwg = other.reader.subjectByAlias("MWG")!
    expect(mwg).toMatchObject({ kind: "ticker", display: "MWG" })
    expect(mwg.currentVersion).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------------
// /baihoc. Fields: title, summary, applies to, exceptions, detail, tags; then "Xác nhận".

const HARD_RULE = "Câu này có dạng một luật cứng («không bao giờ»). Bài học chỉ được model đọc khi cần, không luôn được áp dụng. Muốn luôn áp dụng thì lưu thành ràng buộc."

async function fillLesson(title: string, summary: string) {
  await setup!.mockInput.typeText(title)
  tab()
  await setup!.mockInput.typeText(summary)
  await frameWith(summary.slice(-10))
}

describe("/baihoc: lessons, and hard rules saved in the wrong place", () => {
  test("a lesson with a tag is saved as #8", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/baihoc", "Bài học mới")
    await fillLesson("Giải ngân từng phần", "Không dồn tiền vào một lần mua")
    tab(4)
    await setup!.mockInput.typeText("rủi ro")
    await confirm(1)
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu bài học #8 (bản 1).")
    expect(other.reader.lesson(8)).toMatchObject({ title: "Giải ngân từng phần", tags: ["rủi ro"], appliesTo: [] })
  })

  test("'Không bao giờ bắt đáy' warns; 'Lưu thành ràng buộc' opens /nho with it, section chosen", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/baihoc", "Bài học mới")
    await fillLesson("Không bao giờ bắt đáy", "Chờ xu hướng rõ")
    expect(flat(await frameWith("luật cứng"))).toContain(HARD_RULE)
    await confirm(5)
    const f = flat(await frameWith("Lưu thành ràng buộc"))
    expect(f).toContain("[1] Lưu thành ràng buộc")
    expect(f).toContain("[2] Vẫn lưu bài học")
    key("1")
    const g = flat(await frameWith("Ghi nhớ"))
    expect(state.notebookForm).toMatchObject({ group: "constraint", text: "Không bao giờ bắt đáy", kind: "constraint" })
    expect(g).toContain("(•) 1. Ràng buộc")
    expect(g).toContain("Không bao giờ bắt đáy")
    expect(g).toContain("Mở từ form bài học: chỉ giữ câu này; các ô khác của bài học không được lưu.")
    // What came over from the lesson is not saved anywhere: leaving asks first.
    await until(() => state.notebookFormDirty)
    setup!.mockInput.pressEscape()
    await frameWith("Bỏ nội dung đang sửa?")
    expect(other.reader.lessons()).toHaveLength(2)
  })

  test("from an edited lesson, 'Lưu thành ràng buộc' opens a new constraint, not an edit of the one with the lesson's number", async () => {
    const other = otherWindow()
    seedExample(other)
    // Constraints and lessons are numbered apart: a constraint #7 next to lesson #7 is what the bug opened
    // for editing, with its text in place of the rule (and saving changed it).
    while (!other.reader.constraint(7)) other.writer.addConstraint({ kind: "constraint", text: `Ràng buộc khác ${Date.now()}` })
    const seventh = other.reader.constraint(7)
    await start()
    setState({ notebookForm: { group: "lesson", edit: { id: 7 } }, dialog: "notebook-form" })
    await frameWith("Sửa bài học #7")
    tab()
    await setup!.mockInput.typeText(". Tuyệt đối không bắt đáy")
    await confirm(5)
    await frameWith("Lưu thành ràng buộc")
    key("1")
    await frameWith("Mở từ form bài học")
    // Nothing of the lesson's request is left: setState("notebookForm", {...}) merged its edit: { id: 7 }.
    expect(state.notebookForm).toEqual({ group: "constraint", text: expect.stringContaining("Tuyệt đối không bắt đáy"), kind: "constraint", fromLesson: true })
    const form = flat(await frameWith("Ghi nhớ"))
    expect(form).not.toContain("Sửa ràng buộc")
    expect(form).toContain("Tuyệt đối không bắt đáy")
    expect(other.reader.constraint(7)).toEqual(seventh)
  })

  test("'tuyệt đối không' in the summary warns too; 'Dùng P/B và ROE, không dùng P/E' does not", async () => {
    seedExample(otherWindow())
    await start()
    await command("/baihoc", "Bài học mới")
    await fillLesson("Định giá bảo hiểm", "Dùng P/B và ROE, không dùng P/E")
    expect(flat(await frameWith("không dùng P/E"))).not.toContain("luật cứng")
    tab()
    await setup!.mockInput.typeText(" ")
    setState({ dialog: undefined })
    await frameWith("Hỏi về thị trường")
    await command("/baihoc", "Bài học mới")
    await fillLesson("Giải ngân", "tuyệt đối không dồn một lần")
    expect(flat(await frameWith("luật cứng"))).toContain("(«tuyệt đối không»)")
  })

  test("an 'applies to' name not in the notebook: asked to create the sector, then saved with both", async () => {
    const other = otherWindow()
    const { banks } = seedExample(other)
    await start()
    await command("/baihoc", "Bài học mới")
    await fillLesson("Định giá tài chính", "Dùng P/B")
    tab()
    await setup!.mockInput.typeText("Ngân hàng, Chứng khoán")
    await confirm(4)
    const f = flat(await frameWith("Chưa có chủ đề"))
    expect(f).toContain("Chưa có chủ đề «Chứng khoán». Tạo chủ đề ngành «Chứng khoán»?")
    key("1")
    await until(() => state.dialog === undefined)
    const sec = other.reader.subjectByAlias("Chứng khoán")!
    expect(sec.kind).toBe("sector")
    expect(other.reader.lesson(8)).toMatchObject({ appliesTo: [banks, sec.id] })
  })

  test("a 121-character title: 121/120 and no confirm", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/baihoc", "Bài học mới")
    await fillLesson("t".repeat(121), "Tóm tắt")
    expect(flat(await frameWith("121/120"))).toContain("121/120")
    await confirm(5)
    await frameWith("121/120")
    expect(state.dialog).toBe("notebook-form")
    expect(other.reader.lessons()).toHaveLength(2)
  })

  test("the same title as #7: warned, saved when the user says so", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/baihoc", "Bài học mới")
    await fillLesson("định giá NGÂN HÀNG", "Dùng P/B")
    expect(flat(await frameWith("Trùng tiêu đề"))).toContain(
      "Trùng tiêu đề bài học #7. Sửa #7 trong /memory thay vì tạo mới?",
    )
    await confirm(5)
    await frameWith("Vẫn lưu")
    key("1")
    await until(() => state.dialog === undefined)
    expect(other.reader.lesson(8)).toMatchObject({ title: "định giá NGÂN HÀNG" })
  })

  test("editing #7 when nobody else changed it: the changes, then version 2, no conflict screen", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    setState({ notebookForm: { group: "lesson", edit: { id: 7 } }, dialog: "notebook-form" })
    const f = flat(await frameWith("Sửa bài học #7"))
    expect(f).toContain("Đang sửa từ bản 1")
    expect(f).toContain("Ngân hàng")
    tab()
    await setup!.mockInput.typeText(" và PEG")
    await confirm(5)
    const review = flat(await frameWith("Chỗ khác nhau so với bản 1"))
    expect(review).toContain("Tóm tắt bản 1: Dùng P/B và ROE, không dùng P/E")
    key("1")
    await until(() => state.dialog === undefined)
    expect(notice()).toBe("Đã lưu bài học #7 (bản 2).")
    expect(other.reader.lesson(7)).toMatchObject({ version: 2, summary: "Dùng P/B và ROE, không dùng P/E và PEG" })
  })
})

// ---------------------------------------------------------------------------------------------------------
// /memory: edit (s), thesis state (t), export (ctrl+x on the list: the list's filter takes typed letters).

async function openMemory() {
  await type("/memory")
  enter()
  await until(() => state.dialog === "memory")
  return frameWith("ctrl+x xuất Markdown")
}
async function openEntry(filter: string, title: string) {
  await setup!.mockInput.typeText(filter)
  await frameWith(filter)
  enter()
  return frameWith(title)
}
const ctrlX = () => setup!.mockInput.pressKey("x", { ctrl: true })

describe("/memory: edit, change a thesis state, export", () => {
  test("s on thesis HPG opens /luandiem HPG on version 3; on a constraint, /nho with its section; on a lesson, /baihoc", async () => {
    seedExample(otherWindow())
    await start()
    await openMemory()
    expect(flat(await openEntry("HPG", "Hưởng lợi từ đầu tư công"))).toContain("s sửa · t đổi trạng thái")
    key("s")
    await until(() => state.dialog === "notebook-form")
    expect(flat(await frameWith("Đang sửa từ bản 3"))).toContain("Luận điểm HPG")

    setState({ dialog: undefined })
    await openMemory()
    await openEntry("margin", "Không dùng margin, kể cả T+0")
    key("s")
    const c = flat(await frameWith("Sửa ràng buộc #1"))
    expect(c).toContain("(•) 1. Ràng buộc")
    expect(c).toContain("Đang sửa từ bản 2")
    // The "s" that opened the form is not typed into it.
    expect(c).toContain("Không dùng margin, kể cả T+0 ")
    expect(c).not.toContain("T+0s")
    expect(state.notebookFormDirty).toBe(false)

    setState({ dialog: undefined })
    await openMemory()
    await openEntry("dinh gia", "Dùng P/B và ROE")
    key("s")
    expect(flat(await frameWith("Sửa bài học #7"))).toContain("Đang sửa từ bản 1")
  })

  test("saving an edit opened from /memory goes back to the list; the key that saved does nothing there", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await openMemory()
    await openEntry("margin", "Không dùng margin, kể cả T+0")
    key("s")
    await frameWith("Sửa ràng buộc #1")
    await setup!.mockInput.typeText(" nữa")
    // The section cannot change in an edit: text, then "Xác nhận".
    await confirm(1)
    await frameWith("[1] Xác nhận lưu")
    key("1")
    await until(() => state.dialog === "memory")
    expect(state.memoryTab).toBe("notebook")
    const f = await frameWith("ctrl+x xuất Markdown")
    // The list with an empty filter: the key that saved is not typed into it, and opens nothing.
    expect(f).toContain("gõ để lọc")
    expect(f).toContain("Quyết định (1)")
    expect(f).not.toContain("esc quay lại")
    expect(other.reader.constraint(1)).toMatchObject({ text: "Không dùng margin, kể cả T+0 nữa", version: 3 })
  })

  test("a decision has no edit", async () => {
    seedExample(otherWindow())
    await start()
    await openMemory()
    const f = flat(await openEntry("Mua HPG", "Lý do:"))
    expect(f).not.toContain("s sửa")
    key("s")
    await frameWith("Lý do:")
    expect(state.dialog).toBe("memory")
  })

  test("t: asked first, then the state changes without a new version", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    await start()
    await openMemory()
    await openEntry("HPG", "Hưởng lợi từ đầu tư công")
    key("t")
    const f = flat(await frameWith("Đổi trạng thái luận điểm HPG"))
    expect(f).toContain("[1] đang theo dõi")
    expect(f).toContain("[2] đã bị bác bỏ")
    expect(f).toContain("[3] đã đóng")
    key("2")
    await frameWith("«đã bị bác bỏ»?")
    expect(other.reader.subject(hpg)?.thesisState).toBe("watching")
    enter()
    await until(() => notice() === "Đã đổi trạng thái luận điểm HPG thành «đã bị bác bỏ».")
    expect(other.reader.subject(hpg)).toMatchObject({ thesisState: "refuted", currentVersion: 3 })
    expect(await frameWith((fr) => /HPG\s+bản 3 · đã bị bác bỏ/.test(fr))).toMatch(/HPG\s+bản 3 · đã bị bác bỏ/)
  })

  test("export: a copy note, decisions off by default; on asks first; next time it is off again", async () => {
    seedExample(otherWindow())
    await start()
    await openMemory()
    ctrlX()
    let f = flat(await frameWith("Xuất sổ ghi nhớ ra Markdown"))
    expect(f).toContain("File xuất là bản sao; xoá trong sổ không xoá file này.")
    expect(f).toContain("(•) 1. Không")
    expect(f).not.toContain("File sẽ có nhật ký quyết định")
    tab()
    enter()
    await until(() => notice().startsWith("Đã xuất sổ ghi nhớ: "))
    const plainFile = notice().slice("Đã xuất sổ ghi nhớ: ".length)
    expect(path.dirname(plainFile)).toBe(path.join(home, "exports"))
    expect(readFileSync(plainFile, "utf8")).toContain("Không dùng margin, kể cả T+0")
    expect(readFileSync(plainFile, "utf8")).not.toContain(DECISION_MARKER)

    await openMemory()
    ctrlX()
    await frameWith("Xuất sổ ghi nhớ ra Markdown")
    key("2")
    f = flat(await frameWith("File sẽ có nhật ký quyết định"))
    expect(f).toContain("File sẽ có nhật ký quyết định. Model đọc được file này nếu bạn đưa nó vào thư mục làm việc.")
    tab()
    enter()
    await until(() => notice().startsWith("Đã xuất sổ ghi nhớ: ") && notice() !== "Đã xuất sổ ghi nhớ: " + plainFile)
    const withLog = notice().slice("Đã xuất sổ ghi nhớ: ".length)
    expect(readFileSync(withLog, "utf8")).toContain(DECISION_MARKER)
    expect(readFileSync(plainFile, "utf8")).not.toContain(DECISION_MARKER)

    await openMemory()
    ctrlX()
    expect(flat(await frameWith("Xuất sổ ghi nhớ ra Markdown"))).toContain("(•) 1. Không")
    rmSync(path.join(home, "exports"), { recursive: true, force: true })
  })

  test("an empty notebook says how to write in it", async () => {
    otherWindow()
    await start()
    const f = flat(await openMemory())
    expect(f).toContain("Sổ ghi nhớ còn trống. Ghi bằng /nho (ràng buộc, cách trình bày), /luandiem <mã>, /baihoc, /quyetdinh <mã>.")
  })
})

describe("found in review", () => {
  test("an 'applies to' name typed like a ticker code is created as a ticker", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await command("/baihoc", "Bài học mới")
    await fillLesson("Định giá công nghệ", "Dùng P/E")
    tab()
    await setup!.mockInput.typeText("Ngân hàng, FPT")
    await confirm(4)
    expect(flat(await frameWith("Chưa có chủ đề"))).toContain("Chưa có chủ đề «FPT» (mã). Tạo các chủ đề này?")
    key("1")
    await until(() => state.dialog === undefined)
    expect(other.reader.subjectByAlias("FPT")).toMatchObject({ kind: "ticker" })
  })

  test("an over-long condition is named by its number on screen, blank ones counted", async () => {
    seedExample(otherWindow())
    await start()
    await command("/luandiem VCB", "Luận điểm VCB")
    await setup!.mockInput.typeText("Ngân hàng tốt")
    // Text, condition 1 (left blank), date, detail: the 4th Tab is "Thêm điều kiện".
    tab(4)
    enter()
    await frameWith("Điều kiện 2")
    // From "Thêm điều kiện" back to condition 2: detail, date, condition 2.
    for (let i = 0; i < 3; i++) setup!.mockInput.pressTab({ shift: true })
    await setup!.mockInput.typeText("x".repeat(170))
    const f = flat(await frameWith("170 ký tự"))
    expect(f).toContain("«Điều kiện 2» dài 170 ký tự, vượt giới hạn 160.")
    expect(f).not.toContain("«Điều kiện 1» dài")
  })

  test("a new sector is named as typed, not in capitals", async () => {
    seedExample(otherWindow())
    await start()
    expect(await command("/luandiem Bất động sản", "Luận điểm mới")).toContain("Luận điểm mới BẤT ĐỘNG SẢN")
    key("2")
    expect(await frameWith("Luận điểm mới Bất động sản")).toContain("Luận điểm mới Bất động sản")
  })
})

describe("a long form in a short window scrolls", () => {
  /** Tab through every field: each focused field is on screen, and so are the buttons. */
  async function walk(title: string, labels: readonly string[]) {
    for (const [i, label] of labels.entries()) {
      if (i > 0) tab()
      const f = await frameWith((fr) => fr.includes("› " + label))
      expect(f).toContain("› " + label)
      expect(f).toContain("[ Xác nhận ]")
      // The title rows are not squeezed by the scrolling part.
      expect(f).toContain(title)
    }
  }

  test("a new ticker's thesis in a 24-row window", async () => {
    seedExample(otherWindow())
    await start("notebook", 24)
    await command("/luandiem FPT", "Luận điểm mới FPT")
    await walk("Luận điểm mới FPT", ["Loại", "Ngành", "Bí danh khác", "Chỉ khớp khi viết hoa", "Văn bản", "Điều kiện 1", "Hạn xem lại", "Chi tiết"])
    // Shift+Tab back up: the first field comes back into view.
    for (let i = 0; i < 7; i++) setup!.mockInput.pressTab({ shift: true })
    expect(await frameWith((fr) => fr.includes("› Loại"))).toContain("› Loại")
  })

  test("a thesis with eight conditions in a 24-row window", async () => {
    const other = otherWindow()
    const { hpg } = seedExample(other)
    other.writer.saveThesis(hpg, 3, { text: "Tám điều kiện", conditions: Array.from({ length: 8 }, (_, i) => "Sai nếu " + (i + 1)) })
    await start("notebook", 24)
    await command("/luandiem HPG", "Luận điểm HPG")
    await walk("Đang sửa từ bản 4", ["Văn bản", ...Array.from({ length: 8 }, (_, i) => "Điều kiện " + (i + 1)), "Hạn xem lại", "Chi tiết"])
  })
})

// ── Spec 007: suggestion cards ───────────────────────────────────────────────────────────────────

describe("suggestion cards (spec 007)", () => {
  const TYPED = "Từ giờ đừng bao giờ gợi ý cổ phiếu penny cho tôi"
  const ANSWER = "Ghi nhận: mình sẽ không gợi ý cổ phiếu penny cho bạn nữa."
  const BLOCK = `<the_goi_y loai="rang_buoc">\nnoi_dung: Không gợi ý cổ phiếu penny\ncau_goc: ${TYPED}\n</the_goi_y>`
  const cardLine = () => state.lines.find((l) => l.kind === "card") as Extract<(typeof state.lines)[number], { kind: "card" }> | undefined
  const { resumeSession, currentSession } = { resumeSession: async (id: string) => (await import("../src/tui/session")).resumeSession(runtime!, id), currentSession: async () => (await import("../src/tui/session")).currentSession() }

  async function ask() {
    await setKey("groq", "gsk_test_1234567890abcdefgh")
    reply = `${ANSWER}\n\n${BLOCK}`
    await type(TYPED)
    enter()
    return frameWith("Gợi ý lưu · ràng buộc")
  }

  /** /memory opens on the Gợi ý tab while a card waits. */
  async function openCards() {
    await type("/memory")
    enter()
    await until(() => state.dialog === "memory")
    expect(state.memoryTab).toBe("cards")
    return frameWith("x bỏ qua")
  }

  test("shown under the answer, never its block; Enter opens /nho filled in; confirming saves it from the card", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    const f = await ask()
    expect(f).toContain("Không gợi ý cổ phiếu penny")
    expect(f).toContain(`Bạn đã nói: "${TYPED}"`)
    expect(f).not.toMatch(/the_goi_y|noi_dung|cau_goc/)
    expect(JSON.stringify(state.history)).not.toContain("the_goi_y")
    expect(cardLine()?.state).toBe("pending")
    // It never takes the keys; /memory is where it is saved or dismissed.
    expect(f).toContain("Chưa lưu · /memory để lưu hoặc bỏ qua")
    // The guide went with the request.
    expect(JSON.stringify(mainBodies().at(-1))).toContain("<memory_cards>")
    // Nothing is stored yet.
    expect(other.reader.constraints("constraint")).toHaveLength(2)

    const tabbed = flat(await openCards())
    expect(tabbed).toMatch(/Memory\s+Gợi ý \(1\)\s+Sổ ghi nhớ\s+Cài đặt/)
    expect(tabbed).toContain("Ràng buộc · Không gợi ý cổ phiếu penny")
    expect(tabbed).toContain(`Bạn đã nói: "${TYPED}"`)
    pastEnterGrace()
    enter()
    await until(() => state.dialog === "notebook-form")
    const form = flat(await frameWith("Câu bạn đã gõ"))
    expect(form).toContain("Không gợi ý cổ phiếu penny")
    expect(form).toContain(CONSTRAINT_HINT)
    tab()
    key("1")
    await frameWith("Tổng ràng buộc sau khi lưu")
    await confirm(1)
    // Back to /memory, on the same tab: nothing waits any more.
    await until(() => state.dialog === "memory")
    expect(state.memoryTab).toBe("cards")
    await frameWith("Không có thẻ gợi ý nào đang chờ")
    setup!.mockInput.pressEscape()
    await until(() => state.dialog === undefined)
    expect(other.reader.constraint(5)).toMatchObject({ kind: "constraint", text: "Không gợi ý cổ phiếu penny", source: "card" })
    await until(() => cardLine()?.state === "saved")
    expect(cardLine()?.saved).toEqual({ group: "constraint", id: 5 })
    expect(await frameWith("Đã lưu thành ràng buộc #5")).toContain("Đã lưu thành ràng buộc #5")

    // The next turn tells the model, once.
    reply = "Đã rõ."
    await type("Còn gì nữa không?")
    enter()
    await until(() => !state.streaming && mainBodies().length >= 2)
    expect(JSON.stringify(mainBodies().at(-1))).toContain(`Người dùng đã lưu gợi ý ${cardLine()!.card.id} thành ràng buộc #5.`)
    await until(async () => (await sessionFiles()).includes('"state":"saved"'))
    expect(await sessionFiles()).toContain('"type":"card"')
  })

  test("typing right after a card goes to the prompt whole, even a message that starts with x; the card waits", async () => {
    seedExample(otherWindow())
    await start()
    await ask()
    reply = "Đã rõ."
    await setup!.mockInput.typeText("xem giá HPG")
    await frameWith("xem giá HPG")
    enter()
    await until(() => !state.streaming && mainBodies().length >= 2)
    expect(cardLine()?.state).toBe("pending")
    const users = state.lines.filter((l) => l.kind === "user").map((l) => (l as { text: string }).text)
    expect(users.at(-1)).toBe("xem giá HPG")
    expect(await sessionFiles()).not.toContain('"state":"dismissed"')
  })

  test("x dismisses in /memory; Esc closes it and the card waits; a new message is no yes", async () => {
    seedExample(otherWindow())
    await start()
    await ask()
    const id = cardLine()!.card.id
    await openCards()
    setup!.mockInput.pressEscape()
    await until(() => state.dialog === undefined)
    expect(cardLine()?.state).toBe("pending")
    // Sending another message leaves the card pending; the model is told it waits.
    reply = "Đã rõ."
    await type("Còn gì nữa không?")
    enter()
    await until(() => !state.streaming && mainBodies().length >= 2)
    expect(cardLine()?.state).toBe("pending")
    expect(JSON.stringify(mainBodies().at(-1))).toContain(`Gợi ý lưu ${id} (ràng buộc) đang chờ người dùng xem`)
    await openCards()
    key("x")
    await until(() => cardLine()?.state === "dismissed")
    await frameWith("Không có thẻ gợi ý nào đang chờ")
    setup!.mockInput.pressEscape()
    await until(() => state.dialog === undefined)
    expect(await frameWith("Đã bỏ qua")).toContain("Đã bỏ qua")
    // The same suggestion again is not a new card.
    reply = `${ANSWER}\n\n${BLOCK}`
    await type(TYPED)
    enter()
    await until(() => !state.streaming && mainBodies().length >= 3)
    expect(state.lines.filter((l) => l.kind === "card")).toHaveLength(1)
  })

  test("a lesson card: marked as the model's, /baihoc filled in, saved from the card", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await setKey("groq", "gsk_test_1234567890abcdefgh")
    reply = `Đúng vậy.\n\n<the_goi_y loai="bai_hoc">\ntieu_de: Không mua đuổi\ntom_tat: Giá tăng quá 7% trong phiên thì chờ, không mua đuổi.\n</the_goi_y>`
    await type("Bài học là đừng mua đuổi khi giá đã tăng quá 7% trong phiên")
    enter()
    expect(await frameWith("Gợi ý lưu · bài học (model đề xuất)")).toContain("Không mua đuổi")
    expect(await openCards()).toContain("Bài học (model đề xuất) · Không mua đuổi")
    pastEnterGrace()
    enter()
    await until(() => state.dialog === "notebook-form")
    const form = flat(await frameWith("Không mua đuổi"))
    expect(form).toContain("Giá tăng quá 7% trong phiên thì chờ, không mua đuổi.")
    // Title, summary, applies to, exceptions, detail, tags; then "Xác nhận".
    await confirm(6)
    await until(() => cardLine()?.state === "saved")
    expect(cardLine()?.saved?.group).toBe("lesson")
    const saved = other.reader.lesson(cardLine()!.saved!.id)
    expect(saved).toMatchObject({ source: "card" })
  })

  test("closing the form without saving leaves the card pending and the store unchanged", async () => {
    const other = otherWindow()
    seedExample(other)
    await start()
    await ask()
    await openCards()
    pastEnterGrace()
    enter()
    await until(() => state.dialog === "notebook-form")
    await frameWith("Câu bạn đã gõ")
    // Nothing changed in the form: one Esc closes it.
    setup!.mockInput.pressEscape()
    // Back to /memory with the card still there.
    await until(() => state.dialog === "memory")
    await frameWith("x bỏ qua")
    expect(cardLine()?.state).toBe("pending")
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })

  test("cards switched off in /config: no guide and no card, and the block still never shows", async () => {
    seedExample(otherWindow())
    await saveConfig({ memory: { provider: "notebook", cards: false } })
    await start()
    await setKey("groq", "gsk_test_1234567890abcdefgh")
    reply = `${ANSWER}\n\n${BLOCK}`
    await type(TYPED)
    enter()
    await until(() => !state.streaming && mainBodies().length >= 1)
    const f = await frameWith(ANSWER.slice(0, 20))
    expect(f).not.toMatch(/the_goi_y|noi_dung|Gợi ý lưu/)
    expect(cardLine()).toBeUndefined()
    expect(JSON.stringify(mainBodies().at(-1))).not.toContain("<memory_cards>")
    await saveConfig({ memory: { provider: "notebook", cards: true } })
  })

  test("a resumed session shows the card again under its answer, still pending and still usable", async () => {
    seedExample(otherWindow())
    await start()
    await ask()
    const id = cardLine()!.card.id
    const sid = (await currentSession()).id
    await until(async () => (await sessionFiles()).includes('"type":"card"'))
    await startSession(runtime!, "clear")
    expect(cardLine()).toBeUndefined()
    await resumeSession(sid)
    await until(() => cardLine()?.card.id === id)
    const at = state.lines.findIndex((l) => l.kind === "card")
    expect(state.lines[at - 1]).toMatchObject({ kind: "assistant" })
    expect(cardLine()?.state).toBe("pending")
    await openCards()
    pastEnterGrace()
    enter()
    await until(() => state.dialog === "notebook-form")
  })
})
