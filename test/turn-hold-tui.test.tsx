import { afterAll, afterEach, beforeEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { seedExample } from "./helpers/memory-notebook"
import { testClock } from "./helpers/memory-store"

// Config, the store, sessions and the prompt history go to a scratch home, never ~/.opentrading.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-turn-hold-"))
const savedHome = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home
process.env.OPENTRADING_RETRY_SCALE = "0"
setDefaultTimeout(20_000)
for (const env of ["GROQ_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "NVIDIA_API_KEY"]) {
  delete process.env[env]
}

const model = (id: string, context: number) => ({
  id,
  name: id,
  tool_call: true,
  modalities: { input: ["text"], output: ["text"] },
  limit: { context, output: 8000 },
})
const CATALOG = {
  groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], npm: "@ai-sdk/groq", models: { m: model("m", 131072), tiny: model("tiny", 3000) } },
}
type Body = { messages: { role: string; content?: unknown }[]; stream?: boolean }
const bodies: Body[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (url.endsWith("/chat/completions")) {
    const request = JSON.parse(String(init?.body)) as Body
    bodies.push(request)
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const body = chunk({ role: "assistant", content: "" }) + chunk({ content: "Đã rõ." }) + chunk({}, "stop") + "data: [DONE]\n\n"
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
  }
  throw new Error(`no network in tests: ${url}`)
}) as typeof fetch

const { App, deliverNotices } = await import("../src/tui/app")
const { ConfigDialog } = await import("../src/tui/dialogs/config")
const { state, setState } = await import("../src/tui/state")
const { resetNotifications } = await import("../src/tui/notify")
const { closeMemory, createMemory, initRuntime, switchMemory } = await import("../src/core/runtime")
const { saveConfig } = await import("../src/core/config")
const { setKey } = await import("../src/core/auth")
const { openMemoryStore } = await import("../src/core/memory/store/open")
const { NoopMemory } = await import("../src/core/memory/types")
const { profileDisk } = await import("../src/core/profile")
const { historyFile, historyFlushed, resetHistory } = await import("../src/tui/prompt/history")
const { sessionsDir } = await import("../src/core/session/store")
const { startSession } = await import("../src/tui/session")

const STORE = path.join(home, "memory.db")
const PROFILE = path.join(home, "INVESTOR.md")
const C1 = "- [#1 · bản 2] Không dùng margin, kể cả T+0"
type Runtime = ReturnType<typeof initRuntime>
type MemoryChoice = Parameters<typeof createMemory>[0]
let setup: Awaited<ReturnType<typeof testRender>> | undefined
let runtime: Runtime | undefined
const opened: { close(): void }[] = []
const restores: (() => void)[] = []

beforeEach(async () => {
  await saveConfig({ provider: "groq", model: "m", update: { check: false } })
  await setKey("groq", "gsk_test_1234567890abcdefgh")
  bodies.length = 0
  // bun test runs every file in one process: the UI state may still hold another file's lines.
  setState({ lines: [], queue: [], notices: [], noticeHold: false, turnHold: undefined })
})
afterEach(async () => {
  for (const r of restores.splice(0)) r()
  // A card left open would keep its turn waiting: answer it before the session goes.
  state.turnHold?.choose("cancel")
  setup?.renderer.destroy()
  setup = undefined
  if (runtime) {
    await startSession(runtime, "clear")
    closeMemory(runtime)
    switchMemory(runtime, new NoopMemory())
    await runtime.mcp.stop()
  }
  runtime = undefined
  for (const s of opened.splice(0)) s.close()
  resetNotifications()
  setState({ dialog: undefined, lines: [], notices: [], noticeHold: false, queue: [] })
  await historyFlushed()
  resetHistory()
  rmSync(historyFile(), { force: true })
  rmSync(sessionsDir(), { recursive: true, force: true })
  rmSync(PROFILE, { recursive: true, force: true })
  // Nothing may still hold the store: removing it fails on Windows otherwise.
  for (const name of readdirSync(home).filter((n) => n.startsWith("memory.db"))) rmSync(path.join(home, name))
})
afterAll(async () => {
  globalThis.fetch = realFetch
  if (savedHome === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = savedHome
  await rm(home, { recursive: true, force: true })
})

/** The spec's example store (#1 v2, #4, style #2…), written by "another window" and closed. */
function seedStore() {
  const store = openMemoryStore(STORE, { now: testClock(new Date("2026-10-20T03:00:00.000Z")).now })
  seedExample(store)
  store.close()
}
function newerStore() {
  seedStore()
  const raw = new Database(STORE)
  raw.run("PRAGMA user_version = 99")
  raw.close(true)
}

async function start(choice: MemoryChoice = "none") {
  runtime = initRuntime({ home, skills: () => [], memory: createMemory(choice, home) })
  setup = await testRender(() => <App runtime={runtime!} onExit={() => {}} />, { width: 110, height: 44, exitOnCtrlC: false })
  await frameWith("Hỏi về thị trường")
}
async function frameWith(text: string | ((f: string) => boolean)) {
  const ok = typeof text === "string" ? (f: string) => f.includes(text) : text
  let frame = ""
  for (let i = 0; i < 150 && !ok(frame); i++) {
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
async function ask(text: string) {
  await setup!.mockInput.typeText(text)
  setup!.mockInput.pressEnter()
}
/** The card ignores Enter for a moment after it appears (it was meant for the prompt). */
const pastGrace = () => new Promise((r) => setTimeout(r, 450))
async function choose(row: 0 | 1 | 2) {
  await pastGrace()
  for (let i = 0; i < row; i++) setup!.mockInput.pressArrow("down")
  setup!.mockInput.pressEnter()
  await until(() => state.turnHold === undefined)
}
const systemOf = (body: Body) => JSON.stringify(body.messages.filter((m) => m.role === "system"))
const userLines = () => state.lines.filter((l) => l.kind === "user")
/** Requests of answer turns (streamed); the session title request after a first turn is not one. */
const turns = () => bodies.filter((b) => b.stream)
/** Waits for `n` turn requests, then for the turn to end. */
async function answered(n: number) {
  await until(() => turns().length >= n)
  await until(() => !state.streaming && state.turnHold === undefined)
  expect(turns()).toHaveLength(n)
}

describe("a turn held because a source cannot be read", () => {
  test("only the profile: the card names it, nothing is sent, the prompt is hidden; Esc gives the question back", async () => {
    seedStore()
    mkdirSync(PROFILE)
    await start()
    await ask("HPG thế nào?")
    const card = await frameWith("Chạy lượt này không có hồ sơ")
    expect(card).toContain("Chưa gửi câu hỏi: không đọc được hồ sơ nhà đầu tư (INVESTOR.md): đường dẫn là thư mục,")
    expect(card).toContain("Thử lại")
    expect(card).toContain("Huỷ")
    expect(card).not.toContain("Hỏi về thị trường")
    expect(bodies).toHaveLength(0)
    setup!.mockInput.pressEscape()
    await until(() => state.turnHold === undefined)
    // The box holds the question again (its placeholder only shows when it is empty).
    const after = await frameWith((f) => f.includes("HPG thế nào?") && !f.includes("Chạy lượt này"))
    expect(bodies).toHaveLength(0)
    expect(userLines()).toHaveLength(0)
    expect(after).toContain("HPG thế nào?")
  })

  test("only the store, or both: the run-anyway button names what is missing", async () => {
    newerStore()
    await start()
    await ask("HPG thế nào?")
    const store = await frameWith("Chạy lượt này không có ràng buộc")
    expect(store).toContain(STORE.slice(0, 40))
    expect(store).toContain("OpenTrading không tự xoá hay sửa file này.")
    setup!.mockInput.pressEscape()
    await until(() => state.turnHold === undefined)
    mkdirSync(PROFILE)
    await frameWith((f) => f.includes("HPG thế nào?") && !f.includes("Chạy lượt này"))
    setup!.mockInput.pressEnter()
    await frameWith("Chạy lượt này không có hồ sơ và ràng buộc")
    expect(bodies).toHaveLength(0)
  })

  test("Thử lại after the cause is fixed: one request with the profile", async () => {
    seedStore()
    mkdirSync(PROFILE)
    await start()
    await ask("HPG thế nào?")
    await frameWith("Chạy lượt này không có hồ sơ")
    rmSync(PROFILE, { recursive: true })
    writeFileSync(PROFILE, "## Khung đầu tư\n- Khung thời gian nắm giữ: 1–3 năm\n")
    await choose(0)
    await answered(1)
    expect(systemOf(turns()[0]!)).toContain("1–3 năm")
    expect(systemOf(turns()[0]!)).toContain(C1)
    expect(userLines()).toHaveLength(1)
  })

  test("Thử lại still failing: the card comes back", async () => {
    mkdirSync(PROFILE)
    await start()
    await ask("HPG thế nào?")
    await frameWith("Chạy lượt này không có hồ sơ")
    await choose(0)
    await until(() => state.turnHold !== undefined)
    expect(bodies).toHaveLength(0)
    expect(userLines()).toHaveLength(1)
  })

  test("run without the profile: one request with the constraints and the note; the next turn asks again", async () => {
    seedStore()
    mkdirSync(PROFILE)
    await start()
    await ask("HPG thế nào?")
    await frameWith("Chạy lượt này không có hồ sơ")
    await choose(1)
    await answered(1)
    const system = systemOf(turns()[0]!)
    expect(system).toContain(C1)
    expect(system).toContain("Hồ sơ nhà đầu tư của người dùng không nạp được ở lượt này")
    expect(system).not.toContain("ho_so_nha_dau_tu")
    expect(runtime!.turnWaiver).toBeUndefined()
    await frameWith("Hỏi về thị trường")
    await ask("Còn HSG?")
    await until(() => state.turnHold !== undefined)
    expect(turns()).toHaveLength(1)
  })

  test("a message typed while the turn was reading goes back after the held one, in order", async () => {
    // The read takes a moment, then fails: "so với HSG" is typed meanwhile and queued.
    const read = spyOn(profileDisk, "readFile").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 400))
      throw Object.assign(new Error("EACCES"), { code: "EACCES" })
    })
    restores.push(() => read.mockRestore())
    writeFileSync(PROFILE, "x")
    await start()
    await ask("HPG thế nào?")
    await until(() => state.streaming)
    await ask("so với HSG")
    await until(() => state.queue.length === 1)
    await frameWith("Chạy lượt này không có hồ sơ")
    setup!.mockInput.pressEscape()
    await until(() => state.turnHold === undefined)
    const frame = await frameWith("so với HSG")
    expect(frame).toMatch(/HPG thế nào\?[\s\S]*so với HSG/)
    expect(state.queue).toHaveLength(0)
    expect(userLines()).toHaveLength(0)
    expect(bodies).toHaveLength(0)
  })

  test("stopped (Esc) while the read is still going: no card; handled like Huỷ, and 'Đã dừng.'", async () => {
    const read = spyOn(profileDisk, "readFile").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 400))
      throw Object.assign(new Error("EACCES"), { code: "EACCES" })
    })
    restores.push(() => read.mockRestore())
    writeFileSync(PROFILE, "x")
    await start()
    await ask("HPG thế nào?")
    await until(() => state.streaming)
    setup!.mockInput.pressEscape()
    await until(() => !state.streaming)
    // Past the read's end: the card must not come up late.
    await new Promise((r) => setTimeout(r, 600))
    expect(state.turnHold).toBeUndefined()
    const frame = await frameWith("Đã dừng.")
    expect(frame).not.toContain("Chạy lượt này không có hồ sơ")
    expect(userLines()).toHaveLength(0)
    expect(frame).toContain("HPG thế nào?")
    expect(bodies).toHaveLength(0)
  })

  test("a background-result turn held then cancelled: the result waits and goes with what the user types next", async () => {
    mkdirSync(PROFILE)
    await start()
    setState("notices", ["◆ Subagent nền ag-1 xong: KẾT-QUẢ-NỀN-9a"])
    deliverNotices(runtime!)
    await frameWith("Chạy lượt này không có hồ sơ")
    setup!.mockInput.pressEscape()
    await until(() => state.turnHold === undefined)
    expect(state.notices).toEqual(["◆ Subagent nền ag-1 xong: KẾT-QUẢ-NỀN-9a"])
    rmSync(PROFILE, { recursive: true })
    await frameWith("Hỏi về thị trường")
    await ask("Câu sau")
    await answered(1)
    const sent = JSON.stringify(turns()[0]!.messages.at(-1))
    expect(sent).toContain("KẾT-QUẢ-NỀN-9a")
    expect(sent).toContain("Câu sau")
  })

  test("a model too small for the constraints: an error line, the question back in the box, no card", async () => {
    seedStore()
    await saveConfig({ provider: "groq", model: "tiny" })
    await start()
    await ask("HPG thế nào?")
    await until(() => state.lines.some((l) => l.kind === "error"))
    const frame = await frameWith("Chưa gửi: ràng buộc của bạn không vừa ngữ cảnh của model tiny")
    expect(frame).toContain("HPG thế nào?")
    expect(state.turnHold).toBeUndefined()
    expect(userLines()).toHaveLength(0)
    expect(bodies).toHaveLength(0)
  })
})

describe("the constraints still apply with the notebook off", () => {
  async function openMemoryScreen() {
    runtime = initRuntime({ home, skills: () => [] })
    setState({ dialog: "config" })
    setup = await testRender(() => <ConfigDialog runtime={runtime!} />, { width: 110, height: 40 })
    await frameWith("Cài đặt")
    setup.mockInput.pressEnter()
    return frameWith("Sổ ghi nhớ")
  }

  test("/config → Memory, off, two constraints stored: the line says they still apply", async () => {
    seedStore()
    await openMemoryScreen()
    await frameWith("2 ràng buộc vẫn áp dụng khi tắt Sổ ghi nhớ. Bật Sổ ghi nhớ để xem, sửa hoặc xoá.")
    expect(setup!.captureCharFrame()).toContain("2 ràng buộc vẫn áp dụng khi tắt Sổ ghi nhớ")
  })

  test("/config → Memory: after switching to the notebook, the line is gone when the screen opens again", async () => {
    seedStore()
    await openMemoryScreen()
    await frameWith("2 ràng buộc vẫn áp dụng khi tắt Sổ ghi nhớ")
    await setup!.mockInput.typeText("so ghi")
    await frameWith((f) => !f.includes("Memory cũ"))
    setup!.mockInput.pressEnter()
    await until(() => runtime!.memory.id === "notebook")
    await frameWith("Cài đặt")
    setup!.mockInput.pressEnter()
    const again = await frameWith("Có hiệu lực ngay")
    await new Promise((r) => setTimeout(r, 100))
    expect(again + setup!.captureCharFrame()).not.toContain("vẫn áp dụng khi tắt")
  })

  test("/config → Memory, off, an empty store: no such line", async () => {
    openMemoryStore(STORE).close()
    const frame = await openMemoryScreen()
    await new Promise((r) => setTimeout(r, 100))
    expect(frame + setup!.captureCharFrame()).not.toContain("vẫn áp dụng khi tắt")
  })

  test("/nho with the notebook off: the usual message, then the still-applies line", async () => {
    seedStore()
    await start("none")
    await ask("/nho Không bán khống")
    await until(() => state.notification?.text?.includes("vẫn áp dụng khi tắt Sổ ghi nhớ") === true)
    expect(state.notification?.text).toContain("Sổ ghi nhớ đang tắt; /nho chưa lưu gì.")
    expect(state.notification?.text).toContain("2 ràng buộc vẫn áp dụng khi tắt Sổ ghi nhớ. Bật Sổ ghi nhớ để xem, sửa hoặc xoá.")
  })
})

describe("/context with a source that cannot be read", () => {
  test("says which source failed and that the next turn will be held", async () => {
    newerStore()
    mkdirSync(PROFILE)
    await start()
    await ask("/context")
    const frame = await frameWith("lượt sau sẽ bị hoãn")
    expect(frame).toContain("Không đọc được ràng buộc (kho do phiên bản OpenTrading mới hơn tạo); lượt sau sẽ bị hoãn.")
    expect(frame).toContain("Không đọc được hồ sơ nhà đầu tư (đường dẫn là thư mục, không phải file); lượt sau sẽ")
    setup!.mockInput.pressEscape()
    await until(() => state.dialog === undefined)
  })
})

describe("the profile template", () => {
  test("/profile on a fresh folder, then a question: no profile part, no '(ví dụ'", async () => {
    await start()
    await ask("/profile")
    await frameWith("Đã tạo hồ sơ nhà đầu tư mẫu")
    await ask("HPG thế nào?")
    await answered(1)
    expect(systemOf(turns()[0]!)).not.toContain("ho_so_nha_dau_tu")
    // The bundled prompts say "(ví dụ" themselves: look for the template's own words instead.
    for (const words of ["NĐT cá nhân, nghề chính", "Thêm ràng buộc bằng /nho", "Khung thời gian nắm giữ"]) {
      expect(JSON.stringify(turns()[0])).not.toContain(words)
    }
  })
})
