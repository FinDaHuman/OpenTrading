import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"

/*
 * End to end in the real TUI with the SQLite memory provider: typed commands, what reaches the model, what is stored
 * in the session file, and the /memory dialog. A fake provider endpoint records every request; nothing touches the
 * network or the real ~/.opentrading.
 */
const home = await mkdtemp(path.join(os.tmpdir(), "opentrading-tui-memory-"))
process.env.OPENTRADING_HOME = home
for (const env of ["GROQ_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "NVIDIA_API_KEY"])
  delete process.env[env]

const text = { input: ["text"], output: ["text"] }
const CATALOG = {
  groq: {
    id: "groq",
    name: "Groq",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/groq",
    models: { "test-model": { id: "test-model", name: "Test Model", modalities: text, limit: { context: 131072 } } },
  },
}

const realFetch = globalThis.fetch
/** Every chat request body the app sent, in order. */
const requests: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (url.endsWith("/chat/completions")) {
    requests.push(String(init?.body))
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const body = chunk({ role: "assistant", content: "" }) + chunk({ content: "ĐÃ-TRẢ-LỜI" }) + chunk({}, "stop") + "data: [DONE]\n\n"
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
  }
  throw new Error(`unexpected fetch in test: ${url}`)
}) as typeof fetch

const cwd = await mkdtemp(path.join(os.tmpdir(), "opentrading-tui-memory-cwd-"))
const { App } = await import("../src/tui/app")
const { state, setState } = await import("../src/tui/state")
const { initRuntime } = await import("../src/core/runtime")
const { openSqliteMemory } = await import("../src/core/memory-root")

const memory = openSqliteMemory(home)
const runtime = initRuntime({ cwd, home, skills: () => state.skills, memory })
let setup: Awaited<ReturnType<typeof testRender>>

beforeAll(async () => {
  setState({ lines: [], history: [], dialog: undefined })
  setup = await testRender(() => <App runtime={runtime} />, { width: 110, height: 40 })
  // Connect a fake Groq key and pick its model, as a user would.
  await setup.mockInput.typeText("/connect")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Kết nối provider"))
  await setup.mockInput.typeText("groq")
  await setup.waitForFrame((f) => f.includes("Kết nối provider · 1") && f.includes("GROQ_API_KEY"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("API key ·"))
  await setup.mockInput.pasteBracketedText("gsk_test_memory_1234567890")
  await setup.waitForFrame((f) => f.includes("ký tự"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.dialog === "model")
  await setup.waitForFrame((f) => f.includes("Test Model"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.model === "test-model" && state.dialog === undefined)
})

afterEach(() => {
  if (state.dialog) setState("dialog", undefined)
})

afterAll(async () => {
  await runtime.mcp.stop()
  setup.renderer.destroy()
  memory.close()
  globalThis.fetch = realFetch
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

const show = (frame: string) => process.env.SHOW_FRAME && console.log(frame)

/**
 * The memory block the harness put in the context channel of a request (JSON-escaped text). The user's own typed
 * messages, such as "Ghi nhớ: …", stay in chat history like any message; this checks what memory itself sent.
 */
const memoryContext = (request: string) => request.match(/<memory>\\n([\s\S]*?)\\n<\/memory>/)?.[1] ?? ""

/** Type a message and wait until the turn is over (answered or blocked). */
async function say(message: string) {
  const before = requests.length
  const lines = state.lines.length
  await setup.mockInput.typeText(message)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.lines.length > lines && !state.streaming)
  // A turn that reached the model streams the fake answer; a blocked one ends with a notice line.
  await setup.waitFor(() => requests.length === before || state.lines.some((l) => l.kind === "assistant" && l.text.includes("ĐÃ-TRẢ-LỜI") && l.done))
  return { sent: requests.length > before, request: requests.at(-1) ?? "" }
}

test("the SQLite provider is the runtime's memory, with read-only tools only", () => {
  expect(runtime.memory.id).toBe("sqlite")
  expect(runtime.registry.get("search_memory")?.readOnly).toBe(true)
  expect(runtime.registry.get("load_rule")?.readOnly).toBe(true)
  expect(runtime.registry.get("propose_memory")).toBeUndefined()
})

test('"Ghi nhớ: …" saves a profile, and the next request carries it in the context', async () => {
  const r = await say("Ghi nhớ: Tôi không sử dụng margin")
  expect(r.sent).toBe(true)
  expect(memoryContext(r.request)).toContain("<memory_context>")
  expect(memoryContext(r.request)).toContain("Tôi không sử dụng margin")
  show(await setup.waitForFrame((f) => f.includes("ĐÃ-TRẢ-LỜI")))
})

test("rejected content is blocked in the TUI and never sent to the provider", async () => {
  const r = await say("Ghi nhớ: giá vốn HPG 25.000 đ")
  expect(r.sent).toBe(false)
  const frame = await setup.waitForFrame((f) => f.includes("Lượt này bị chặn: Không lưu"))
  expect(requests.some((body) => body.includes("25.000"))).toBe(false)
  show(frame)
})

test("ambiguous content asks to confirm; the confirm form saves it", async () => {
  expect((await say("Ghi nhớ: không vượt 20% danh mục cho một mã")).sent).toBe(false)
  await setup.waitForFrame((f) => f.includes("Cần xác nhận"))
  expect((await say("Xác nhận ghi nhớ: không vượt 20% danh mục cho một mã")).sent).toBe(true)
})

test("a note for VCB is used when VCB is discussed, with a visible 'Dùng N memory' line", async () => {
  expect((await say("Ghi chú VCB: Chờ kết quả ĐHCĐ")).sent).toBe(true)
  const r = await say("Phân tích VCB giúp tôi")
  expect(memoryContext(r.request)).toContain("<memory_scoped>")
  expect(memoryContext(r.request)).toContain("Chờ kết quả ĐHCĐ")
  const frame = await setup.waitForFrame((f) => f.includes("Dùng ") && f.includes("memory #"))
  show(frame)
})

test("the session file stores memory references, never the memory context block", async () => {
  const files: string[] = []
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.name.endsWith(".jsonl") && e.name !== "index.jsonl") files.push(full)
    }
  }
  await walk(path.join(home, "sessions"))
  expect(files.length).toBeGreaterThan(0)
  const stored = (await Promise.all(files.map((f) => readFile(f, "utf8")))).join("\n")
  expect(stored).not.toContain("<memory_context>")
  expect(stored).not.toContain("<memory_scoped>")
  expect(stored).toContain("memory #")
})

test("/memory lists the items; deleting one removes it from the next request", async () => {
  await setup.mockInput.typeText("/memory")
  setup.mockInput.pressEnter()
  const list = await setup.waitForFrame((f) => f.includes("Memory · 3") && f.includes("[hồ sơ] Tôi không sử dụng margin"))
  show(list)
  setup.mockInput.pressEnter() // first item: the margin profile (sorted by id)
  await setup.waitForFrame((f) => f.includes("d xoá"))
  setup.mockInput.pressKey("d")
  await setup.waitForFrame((f) => f.includes("Đã xoá memory"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  const r = await say("Câu hỏi tiếp theo")
  expect(memoryContext(r.request)).toContain("<memory_context>")
  expect(memoryContext(r.request)).not.toContain("Tôi không sử dụng margin")
})

test('"Góp ý: …" creates a proposal that waits in /memory until approved with a', async () => {
  const r = await say("Góp ý: Báo cáo cần nêu rủi ro tỷ giá")
  expect(r.sent).toBe(false)
  await setup.waitForFrame((f) => f.includes("chờ duyệt trong /memory"))
  expect(memoryContext((await say("Câu hỏi khác")).request)).not.toContain("rủi ro tỷ giá")
  await setup.mockInput.typeText("/memory")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("chờ duyệt"))
  // Move to the pending item (last in the list) and open it.
  for (let i = 0; i < 5; i++) setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("a duyệt"))
  setup.mockInput.pressKey("a")
  await setup.waitForFrame((f) => f.includes("Đã duyệt memory"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  expect(memoryContext((await say("Câu hỏi sau khi duyệt")).request)).toContain("rủi ro tỷ giá")
})
