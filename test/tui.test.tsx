import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { z } from "zod"
import { createEffect, createRoot } from "solid-js"

// Isolate state from the real ~/.opentrading before any core module loads.
const home = await mkdtemp(path.join(os.tmpdir(), "opentrading-test-"))
process.env.OPENTRADING_HOME = home
// Retries do not sleep in tests (retry.ts scales every wait).
process.env.OPENTRADING_RETRY_SCALE = "0"
for (const env of ["GROQ_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "NVIDIA_API_KEY"])
  delete process.env[env]

// A tiny models.dev-shaped catalog: two supported providers and one that must stay hidden.
const text = { input: ["text"], output: ["text"] }
const CATALOG = {
  groq: {
    id: "groq",
    name: "Groq",
    env: ["GROQ_API_KEY"],
    npm: "@ai-sdk/groq",
    models: {
      "test-model": { id: "test-model", name: "Test Model", modalities: text, limit: { context: 131072 } },
      "whisper-x": { id: "whisper-x", name: "Whisper X", modalities: { input: ["audio"], output: ["text"] } },
      "vision-model": { id: "vision-model", name: "Vision Model", modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 131072 } },
    },
  },
  nvidia: {
    id: "nvidia",
    name: "Nvidia",
    env: ["NVIDIA_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://integrate.api.nvidia.com/v1",
    models: { "nv/model": { id: "nv/model", name: "NV Chat Model", modalities: text } },
  },
  azure: {
    id: "azure",
    name: "Azure Hidden",
    env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
    npm: "@ai-sdk/azure",
    models: {},
  },
}

// Fake endpoints so no test ever reaches the network.
const LONG =
  "Dòng này rất dài để kiểm tra việc xuống dòng: " + "thanh khoản ".repeat(14) + "điểm-cuối-dòng-dài"
const REPLY = ["Xin chào! ", "T+2.5 là chu kỳ thanh toán.\n\n", LONG, "\n\nHẾT-CÂU-TRẢ-LỜI"]
const realFetch = globalThis.fetch
const chatCalls: string[] = []
/** Bodies of streamed chat requests, newest last. */
const chatBodies: { messages: { role: string; content?: unknown }[] }[] = []
const ASK_ONE = {
  questions: [
    {
      header: "Khung TG",
      question: "Bạn đầu tư trong bao lâu?",
      options: [
        { label: "Dưới 1 năm", description: "Lướt sóng, ưu tiên thanh khoản" },
        { label: "1–3 năm" },
        { label: "Trên 3 năm", description: "Tích sản dài hạn" },
      ],
    },
  ],
}
const ASK_MANY = {
  questions: [
    ASK_ONE.questions[0],
    {
      header: "Ngành",
      question: "Bạn quan tâm ngành nào?",
      multiSelect: true,
      options: [{ label: "Ngân hàng" }, { label: "Thép" }, { label: "Bất động sản" }],
    },
  ],
}
/** Holds the answer of an "ĐẾM-TOKEN" turn (after its tool step) while set. */
let usageGate: Promise<void> | undefined
/** Holds the (non-streamed) summary request open while set. */
let summaryGate: Promise<void> | undefined
/** Set by the esc-while-streaming test: "CHẬM" makes the fake model call the slow tool. */
let callSlowTool = false
/** "QUÁ-TẢI" requests fail with 503 this many times before answering. */
let overloaded = 0
/** Subagent requests wait for this before answering (their rows stay "running"). */
let childGate: Promise<void> | undefined
/** A "CON-DOC" subagent waits for this after its first tool (between two model steps). */
let childAfterTool: Promise<void> | undefined
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization")
  // In-process test servers (MCP over HTTP) are real.
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (auth?.includes("bad")) return Response.json({ error: { message: "Invalid API Key" } }, { status: 401 })
  if (url.endsWith("/chat/completions")) {
    chatCalls.push(url)
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const request = JSON.parse(String(init?.body)) as { messages: { role: string; content?: unknown }[]; stream?: boolean }
    // generateText (the /compact summary) does not stream.
    if (!request.stream) {
      await summaryGate
      return Response.json({
        id: "c1",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "## Yêu cầu của người dùng\nTÓM-TẮT-GIẢ" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
    }
    chatBodies.push(request)
    const last = JSON.stringify(request.messages.at(-1)?.content ?? "")
    const sseOf = (text: string) => new Response(text, { headers: { "content-type": "text/event-stream" } })
    // A subagent's request: its system prompt carries <subagent>.
    if (String(request.messages[0]?.content ?? "").includes("<subagent>")) {
      // Held requests still end when the subagent is stopped.
      await Promise.race([
        childGate,
        new Promise<void>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      ])
      const childHasResult = request.messages.some((m) => m.role === "tool")
      if (JSON.stringify(request.messages).includes("CON-DOC")) {
        if (!childHasResult) {
          const call = { index: 0, id: "call_child_read", type: "function", function: { name: "current_time", arguments: "{}" } }
          return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
        }
        await childAfterTool
      }
      if (JSON.stringify(request.messages).includes("CON-GHI") && !childHasResult) {
        const call = { index: 0, id: "call_child_write", type: "function", function: { name: "ghi_tam", arguments: '{"ma":"FPT"}' } }
        return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
      }
      return sseOf(chunk({ role: "assistant", content: "BÁO-CÁO-CON: FPT ổn." }) + chunk({}, "stop") + "data: [DONE]\n\n")
    }
    // "MẤY-GIỜ" asks for a tool call until a tool result is in the conversation.
    // Only tool results of the current turn count (earlier turns left their own in history).
    const lastUser = request.messages.map((m) => m.role).lastIndexOf("user")
    const answeredThisTurn = request.messages.slice(lastUser).some((m) => m.role === "tool")
    if (callSlowTool && last.includes("CHẬM") && !answeredThisTurn) {
      const call = { index: 0, id: "call_slow", type: "function", function: { name: "cho_lau", arguments: "{}" } }
      return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    }
    const ask = last.includes("HỎI-NHIỀU") ? ASK_MANY : last.includes("HỎI-TÔI") ? ASK_ONE : undefined
    if (ask && !answeredThisTurn) {
      const call = { index: 0, id: "call_ask", type: "function", function: { name: "ask_user", arguments: JSON.stringify(ask) } }
      return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    }
    if (last.includes("VIỆC-CẦN-LÀM") && !answeredThisTurn) {
      const todos = [
        { content: "Lấy giá 30 phiên FPT", status: "completed" },
        { content: "Lấy BCTC 4 quý", status: "in_progress" },
        { content: "So sánh với ngành", status: "pending" },
      ]
      const call = { index: 0, id: "call_todo", type: "function", function: { name: "todo_write", arguments: JSON.stringify({ todos }) } }
      return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    }
    if (last.includes("GHI-CHÚ") && !answeredThisTurn) {
      const call = { index: 0, id: "call_note", type: "function", function: { name: "mcp__demo__ghi_chu", arguments: '{"noi_dung":"mua VCB khi về 85"}' } }
      return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    }
    if (last.includes("SUBAGENT-") && !answeredThisTurn) {
      const background = last.includes("SUBAGENT-NEN")
      const tasks = last.includes("SUBAGENT-GHI") ? [["Ghi FPT", "CON-GHI"]] : last.includes("SUBAGENT-DOC") ? [["Đọc FPT", "CON-DOC"]] : background ? [["Nền FPT", "FPT"]] : [["Định giá FPT", "FPT"], ["Định giá CMG", "CMG"]]
      const calls = tasks.map(([description, prompt], index) => ({
        index,
        id: `call_sub_${index}_${chatBodies.length}`,
        type: "function",
        function: { name: "spawn_subagent", arguments: JSON.stringify({ description, prompt, ...(background ? { run_in_background: true } : {}) }) },
      }))
      return sseOf(chunk({ role: "assistant", tool_calls: calls }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
    }
    // "LẶP-LẠI" repeats the same current_time call until 3 results are in (the loop guard asks on the 3rd).
    const loopAt = request.messages.findLastIndex((m) => m.role === "user" && JSON.stringify(m.content ?? "").includes("LẶP-LẠI"))
    if (loopAt >= 0 && request.messages.slice(loopAt).filter((m) => m.role === "tool").length < 3) {
      const call = { index: 0, id: `call_loop_${chatBodies.length}`, type: "function", function: { name: "current_time", arguments: "{}" } }
      return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
    }
    if (last.includes("QUÁ-TẢI") && overloaded > 0) {
      overloaded--
      return Response.json({ error: { message: "overloaded" } }, { status: 503 })
    }
    // "ĐẾM-TOKEN": a tool step that reports usage, then the answer waits for usageGate.
    if (JSON.stringify(request.messages.slice(lastUser)).includes("ĐẾM-TOKEN")) {
      if (!answeredThisTurn) {
        const call = { index: 0, id: "call_count", type: "function", function: { name: "current_time", arguments: "{}" } }
        const usage = `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [], usage: { prompt_tokens: 50_000, completion_tokens: 10 } })}\n\n`
        return sseOf(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + usage + "data: [DONE]\n\n")
      }
      await usageGate
    }
    if (last.includes("MẤY-GIỜ") && !request.messages.some((m) => m.role === "tool")) {
      const call = { index: 0, id: "call_1", type: "function", function: { name: "current_time", arguments: "{}" } }
      return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    }
    // "NHIỀU-MẨU": an answer in 60 tiny deltas.
    const parts = last.includes("NHIỀU-MẨU") ? Array.from({ length: 60 }, (_, i) => `m${i} `).concat("HẾT-CÂU-TRẢ-LỜI") : REPLY
    const body =
      chunk({ role: "assistant", content: "" }) +
      parts.map((content) => chunk({ content })).join("") +
      chunk({}, "stop") +
      "data: [DONE]\n\n"
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
  }
  throw new Error(`unexpected fetch in test: ${url}`)
}) as typeof fetch

// A global MCP server (the bundled demo) and an empty working directory for project config.
const cwd = await mkdtemp(path.join(os.tmpdir(), "opentrading-cwd-"))
const DEMO = path.resolve(import.meta.dir, "../examples/mcp-demo/server.ts")
await writeFile(path.join(home, "mcp.json"), JSON.stringify({ mcpServers: { demo: { command: process.execPath, args: [DEMO] } } }))

const { App } = await import("../src/tui/app")
const { state, setState } = await import("../src/tui/state")
const { resetNotifications, say } = await import("../src/tui/notify")
const { reconcile } = await import("solid-js/store")
const { readJson } = await import("../src/core/store")
const { setKey } = await import("../src/core/auth")
const { loadConfig, saveConfig } = await import("../src/core/config")
const { initRuntime } = await import("../src/core/runtime")
const { FileMemory } = await import("../src/core/memory/file-memory")

const memory = new FileMemory(path.join(home, "memory"))
/** Times the app asked to exit (the real exit is replaced in tests). */
let exits = 0
/** What copy-on-select sent over OSC52 (the renderer's method is replaced in beforeAll). */
const osc52: string[] = []
/** What it handed to the OS clipboard command (stubbed; CI never runs powershell). */
const copied: string[] = []
const { setClipboardSpawn } = await import("../src/tui/clipboard")
setClipboardSpawn(async (_command, text) => {
  copied.push(text)
  return true
})
const runtime = initRuntime({ cwd, home, skills: () => state.skills, memory })
let setup: Awaited<ReturnType<typeof testRender>>

beforeAll(async () => {
  // Test files share one process and one store: start from an empty transcript whatever ran before.
  setState({ lines: [], approval: undefined, approvals: [], dialog: undefined })
  // exitOnCtrlC off, as in main.tsx: the app handles Ctrl+C (double press) itself.
  setup = await testRender(() => <App runtime={runtime} onExit={() => exits++} />, { width: 100, height: 32, exitOnCtrlC: false })
  // waitFor/waitForFrame count frames and give up once the renderer idles. The app draws on
  // demand in a chat (the background holds still there), so keep the frame clock ticking.
  setup.renderer.requestLive()
  // OSC52 always carries the copy (the OS command may not exist, e.g. on CI without xclip).
  setup.renderer.copyToClipboardOSC52 = (text: string) => {
    osc52.push(text)
    return true
  }
})

// Tests share one app. If a test fails with a dialog open, close it so the failure does not
// cascade into every later test typing into that dialog.
afterEach(() => {
  if (state.dialog) setState("dialog", undefined)
  // An opt-in left open would keep every later prompt blocked.
  if (state.autoOptIn) setState("autoOptIn", undefined)
  // A notification left by one test must not hide a footer hint the next one waits for.
  resetNotifications()
})

/**
 * Run a slash command. Resolves to the transcript line it added, or — for confirmations and
 * command errors, which go to the footer — `{ kind: "notice", level, text }`.
 */
async function command(cmd: string): Promise<{ kind: string; text: string; level?: string }> {
  resetNotifications()
  const before = state.lines.length
  await setup.mockInput.typeText(cmd)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.lines.length > before || state.notification !== undefined)
  if (state.lines.length > before) return state.lines.at(-1) as { kind: string; text: string }
  return { kind: "notice", level: state.notification!.level, text: state.notification!.text }
}

afterAll(async () => {
  await runtime.mcp.stop()
  setup.renderer.destroy()
  await rm(cwd, { recursive: true, force: true })
  globalThis.fetch = realFetch
  await rm(home, { recursive: true, force: true })
})

const show = (frame: string) => process.env.SHOW_FRAME && console.log(frame)

async function connect(filter: string, key: string) {
  await setup.mockInput.typeText("/connect")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Kết nối provider"))
  await setup.mockInput.typeText(filter)
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("API key ·"))
  await setup.mockInput.pasteBracketedText(key)
  await setup.waitForFrame((f) => f.includes(`${key.length} ký tự`))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.dialog === "model")
}

test("home screen shows branding and connect hint", async () => {
  const frame = await setup.waitForFrame((f) => f.includes("/connect để bắt đầu"))
  expect(frame).toContain("▟▀▀▙")
  expect(frame).toContain("Harness AI phân tích chứng khoán Việt Nam")
  show(frame)
})

test("the slash-command list: one line per command, straight columns, wraps with the arrow keys", async () => {
  const { COMMANDS } = await import("../src/tui/commands")
  await setup.mockInput.typeText("/")
  // List rows: after the 2-cell margin (where the animated background may draw), " ❯ /x" or
  // "   /x". Home's own tips are indented much further.
  const listRows = (f: string) =>
    f
      .split("\n")
      .map((line) => line.slice(2))
      .filter((line) => /^ (❯ |  )\/[a-z]/.test(line))
  let frame = await setup.waitForFrame((f) => f.includes("enter chạy · tab điền"))
  show(frame)
  // Regression: rows were squeezed onto the same line ("/newsions", "/helpr").
  expect(frame).not.toContain("/newsions")
  expect(frame).not.toContain("/helpr")
  const rows = listRows(frame)
  expect(rows).toHaveLength(8)
  expect(rows.map((r) => r.trim().replace(/^❯ /, "").split(" ")[0])).toEqual(COMMANDS.slice(0, 8).map((c) => `/${c.name}`))
  // The description column starts at the same cell on every row.
  const starts = rows.map((r) => r.search(/\/\S+( \S+)*? {2,}\S/) + (/\/\S+( \S+)*? {2,}/.exec(r)?.[0].length ?? 0))
  expect(new Set(starts).size).toBe(1)
  expect(frame).toMatch(/❯ \/connect/)
  expect(frame).toMatch(/1\/\d+ · còn \d+ lệnh/)

  // ↑ from the first row wraps to the last command.
  setup.mockInput.pressArrow("up")
  frame = await setup.waitForFrame((f) => f.includes("❯ /exit"))
  show(frame)
  setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))
})

test("'/' + ↓ + enter runs the highlighted command (never sends '/')", async () => {
  const before = chatCalls.length
  await setup.mockInput.typeText("/")
  await setup.waitForFrame((f) => f.includes("❯ /connect"))
  setup.mockInput.pressArrow("down")
  await setup.waitForFrame((f) => f.includes("❯ /model"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.dialog === "model")
  expect(chatCalls.length).toBe(before)
  expect(state.lines.some((l) => l.kind === "user" && l.text === "/")).toBe(false)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("esc closes the '/' list until the draft changes; tab then does nothing", async () => {
  await setup.mockInput.typeText("/mo")
  await setup.waitForFrame((f) => f.includes("❯ /model"))
  setup.mockInput.pressEscape()
  let frame = await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))
  expect(frame).toContain("› /mo")
  setup.mockInput.pressTab() // no autofill while dismissed
  frame = await setup.waitForFrame((f) => f.includes("› /mo"))
  expect(frame).not.toContain("› /model")
  // Typing reopens it.
  await setup.mockInput.typeText("d")
  await setup.waitForFrame((f) => f.includes("❯ /model") && f.includes("enter chạy · tab điền"))
  for (let i = 0; i < 4; i++) setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))

  // Dismissing "/" itself must not disable the list for good: delete it, type "/" again.
  await setup.mockInput.typeText("/")
  await setup.waitForFrame((f) => f.includes("enter chạy · tab điền"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))
  setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
  await setup.mockInput.typeText("/")
  await setup.waitForFrame((f) => f.includes("enter chạy · tab điền"))
  setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))
})

test("an unknown /command is reported and kept for editing, never sent to the model", async () => {
  const before = chatCalls.length
  await setup.mockInput.typeText("/khongco ")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("Không có lệnh /khongco"))
  expect(frame).toContain("› /khongco")
  expect(chatCalls.length).toBe(before)
  for (let i = 0; i < "/khongco ".length; i++) setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
})

test("/save and /export before any turn say there is nothing to save", async () => {
  const copiedBefore = copied.length
  for (const cmd of ["/save", "/export"]) {
    expect(await command(cmd)).toMatchObject({ kind: "notice", text: "Chưa có lượt nào để lưu." })
  }
  expect(copied.length).toBe(copiedBefore)
  await readdir(path.join(home, "exports")).then(
    () => expect.unreachable("no export folder yet"),
    () => {},
  )
})

test("chat before connecting shows a readable error instead of crashing", async () => {
  await setup.mockInput.typeText("Xin chào")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Chưa kết nối provider. Gõ /connect"))
})

test("tab completes a partial command, enter opens it", async () => {
  // "/con" ranks /config first (same prefix, shorter name — as in Claude Code); "/conn" is /connect.
  await setup.mockInput.typeText("/conn")
  await setup.waitForFrame((f) => f.includes("❯ /connect"))
  setup.mockInput.pressTab() // fills "/connect " and closes the list, without running it
  await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))
  expect(state.dialog).toBeUndefined()
  const frame = await setup.waitForFrame((f) => f.includes("› /connect "))
  show(frame)
  setup.mockInput.pressEnter()
  const list = await setup.waitForFrame((f) => f.includes("Kết nối provider"))
  expect(list).toContain("Groq")
  expect(list).toContain("Nvidia")
  expect(list).not.toContain("Azure Hidden") // unsupported providers are not shown
  show(list)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("enter on a partial command runs the highlighted suggestion", async () => {
  await setup.mockInput.typeText("/hel")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Trợ giúp") && f.includes("enter chạy lệnh"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/connect saves a masked key and lists that provider's chat models", async () => {
  await connect("groq", "gsk_test_1234567890abcd")
  const auth = await readJson<Record<string, unknown>>(path.join(home, "auth.json"), {})
  expect(auth.groq).toEqual({ type: "api", key: "gsk_test_1234567890abcd" }) // gitleaks:allow (fake key)
  const list = await setup.waitForFrame((f) => f.includes("Test Model"))
  expect(list).not.toContain("Whisper X") // audio-only models are filtered out
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.model === "test-model" && state.dialog === undefined)
})

test("/model lists models from every connected provider", async () => {
  await connect("nvidia", "nvapi-test-0987654321")
  expect(state.provider).toBe("groq") // connecting a second provider keeps the current default
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  await setup.mockInput.typeText("/model")
  setup.mockInput.pressEnter()
  const list = await setup.waitForFrame((f) => f.includes("NV Chat Model") && f.includes("Test Model"))
  expect(list).toContain("2 provider")
  show(list)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("a reply streams into the transcript with wrapping", async () => {
  await setup.mockInput.typeText("Giải thích T+2.5")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("HẾT-CÂU-TRẢ-LỜI"))
  expect(chatCalls.at(-1)).toContain("api.groq.com")
  expect(frame).toContain("T+2.5 là chu kỳ thanh toán.")
  expect(frame).toContain("điểm-cuối-dòng-dài") // long line wrapped, not clipped
  expect(frame).toContain("Groq · test-model")
  await setup.waitFor(() => !state.streaming)
})

test("switching to an OpenAI-compatible provider routes to its base URL", async () => {
  await setup.mockInput.typeText("/model")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("NV Chat Model"))
  await setup.mockInput.typeText("NV Chat")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.provider === "nvidia" && state.model === "nv/model")
  const before = chatCalls.length
  await setup.mockInput.typeText("Chào NVIDIA")
  setup.mockInput.pressEnter()
  // The previous session's title request (fire-and-forget, Groq) may land in between.
  const nvidia = "https://integrate.api.nvidia.com/v1/chat/completions"
  await setup.waitFor(() => chatCalls.slice(before).includes(nvidia) && !state.streaming)
  expect(chatCalls.slice(before)).toContain(nvidia)
})

test("an invalid key surfaces as a Vietnamese error line", async () => {
  await setKey("nvidia", "nvapi-bad-key")
  await setup.mockInput.typeText("Lại lần nữa")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("API key không hợp lệ"))
  show(frame)
  await setup.waitFor(() => !state.streaming)
})

const waitMcp = async (pred: () => boolean, what = pred.toString()) => {
  // Spawning or stopping the server takes real time, so poll the clock instead of render passes.
  for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 100))
  expect({ what, ok: pred(), mcp: pred() ? undefined : state.mcp.map((s) => `${s.name}:${s.state}:${s.error ?? ""}`) }).toEqual({ what, ok: true, mcp: undefined })
}

test("/mcp: grouped list → server menu → tools → tool detail, esc steps back", async () => {
  await waitMcp(() => state.mcp[0]?.state === "connected")
  const bar = await setup.waitForFrame((f) => f.includes("MCP 1/1"))
  expect(bar).toContain("MCP 1/1")
  await setup.mockInput.typeText("/mcp")
  setup.mockInput.pressEnter()
  let frame = await setup.waitForFrame((f) => f.includes("Quản lý MCP server"))
  show(frame)
  expect(frame).toContain("1 server · 1 đang kết nối")
  expect(frame).toContain("Của bạn (")
  expect(frame).toMatch(/❯ demo · ✓ đã kết nối · 4 tool/)
  expect(frame).toContain("Có sẵn (đang tắt")
  expect(frame).toMatch(/context7 · ○ không cần đăng nhập/)
  expect(frame).toContain("+ Thêm server tuỳ chỉnh")
  // The panel replaces the prompt input.
  expect(frame).not.toContain("Hỏi về thị trường")

  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("demo · MCP server"))
  show(frame)
  expect(frame).toContain("Trạng thái")
  expect(frame).toContain("✓ đã kết nối · 4 tool")
  expect(frame).toContain("Lệnh")
  expect(frame).toContain("Khả năng")
  expect(frame).toContain("/demo:phan_tich")
  expect(frame).toMatch(/❯ 1\. Xem tool/)
  expect(frame).toContain("Kết nối lại")
  expect(frame).toContain("Tắt")

  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Tool của demo"))
  expect(frame).toMatch(/◇ add +\[chỉ đọc\]/)
  expect(frame).toMatch(/◆ ghi_chu +\[ghi\]/)
  // Labels are words in brackets, never emoji (⚠ rendered as a colour emoji in Windows Terminal).
  expect(frame).not.toContain("⚠")
  // The [label] column lines up whatever the name length.
  const labelCols = frame.split("\n").filter((l) => /[◇◆] \S+ +\[/.test(l)).map((l) => l.indexOf("["))
  expect(new Set(labelCols).size).toBe(1)
  for (let i = 0; i < 3; i++) setup.mockInput.pressArrow("down")
  await setup.waitForFrame((f) => f.includes("❯ ◆ ghi_chu"))
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Tên đầy đủ"))
  show(frame)
  expect(frame).toContain("[ghi]")
  expect(frame).toContain("mcp__demo__ghi_chu")
  expect(frame).toMatch(/• noi_dung \(bắt buộc\): string - Nội dung ghi chú/)

  // Wait between presses: two ESC bytes in one read ("\x1b\x1b") parse as a single
  // alt+escape keypress.
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Tool của demo") && f.includes("❯ ◆ ghi_chu"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("demo · MCP server"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Quản lý MCP server") && f.includes("❯ demo"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
}, 30_000)

test("/mcp server screen: a page-long error or prompt list never draws rows over each other", async () => {
  await waitMcp(() => state.mcp[0]?.state === "connected")
  const { state: was, error, tools, prompts: hadPrompts } = state.mcp[0]!
  const original = { state: was, error, tools: [...tools], prompts: [...hadPrompts] }
  const lines = (f: string) => f.split("\n")
  setup.resize(80, 24)
  try {
    // A long prompt list wraps under the value column instead of being cut at the edge.
    const prompts = Array.from({ length: 6 }, (_, i) => ({ name: `quy_trinh_rat_dai_so_${i}`, arguments: [] }))
    setState("mcp", 0, { prompts })
    await setup.mockInput.typeText("/mcp")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("❯ demo"))
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("demo · MCP server") && f.includes("Xem tool"))
    show(frame)
    // Short terminal: the list is cut to what fits ("… +N"), and the whole menu stays.
    expect(frame).toContain("/demo:quy_trinh_rat_dai_so_0")
    expect(frame).toMatch(/… \+\d+/)
    expect(frame).toContain("4. Xoá khỏi cấu hình")
    setup.resize(160, 40)
    frame = await setup.waitForFrame((f) => f.includes("/demo:quy_trinh_rat_dai_so_5"))
    show(frame)
    setup.resize(80, 24)

    // A raw HTML 502 body as the SDK reports it (the manager already shortens these; the
    // panel cleans whatever it is given too).
    const html = `Streamable HTTP error: Error POSTing to endpoint: <!DOCTYPE html>\n<html lang="en">\n${"  <meta name=x content=y>\n".repeat(40)}${"d09GMk9UVE8AAKewAAwAAAABa6QAAKdfAAEAAAAAAAAAAAAA".repeat(60)}`
    setState("mcp", 0, { state: "failed", error: html, tools: [], prompts: [] })
    frame = await setup.waitForFrame((f) => f.includes("Lỗi:") && f.includes("[trang HTML]"))
    expect(frame).not.toContain("<meta")
    // Any other page-long error (a stderr dump) is cut to what fits.
    setState("mcp", 0, { error: `stderr: ${"Traceback line with some details\n".repeat(200)}` })
    frame = await setup.waitForFrame((f) => f.includes("Lỗi: stderr") && f.includes("Kết nối lại"))
    // Scroll the menu: the bug showed while moving through it.
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
    frame = await setup.waitForFrame((f) => f.includes("❯ 3. Xoá khỏi cấu hình"))
    show(frame)
    // Each field keeps its own line (label, then value), with nothing drawn over it.
    expect(frame).toMatch(/│ Trạng thái +✘ lỗi +│/)
    expect(lines(frame).find((l) => l.includes("Lệnh"))).toMatch(/^ *│ Lệnh +\S.*│ *$/)
    expect(lines(frame).find((l) => l.includes("Cấu hình"))).toMatch(/^ *│ Cấu hình +\S.*│ *$/)
    expect(frame).toMatch(/ 1\. Kết nối lại/)
    expect(frame).toMatch(/ 2\. Tắt/)
    expect(frame).toContain("esc quay lại")
    expect(lines(frame).filter((l) => l.includes("Lỗi:"))).toHaveLength(1)
    expect(frame).toContain("…")
  } finally {
    setState("mcp", 0, original)
    setup.resize(100, 32)
  }
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Quản lý MCP server"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
}, 30_000)

test("/mcp: space turns a server off and on (saved to mcp.json); catalog entries open their own screen", async () => {
  await setup.mockInput.typeText("/mcp")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("❯ demo"))
  setup.mockInput.pressKey(" ")
  await waitMcp(() => state.mcp[0]?.state === "disabled")
  let saved = await readJson<{ mcpServers: Record<string, { enabled?: boolean }> }>(path.join(home, "mcp.json"), { mcpServers: {} })
  expect(saved.mcpServers.demo!.enabled).toBe(false)
  await setup.waitForFrame((f) => f.includes("demo · ○ đã tắt"))
  setup.mockInput.pressKey(" ")
  await waitMcp(() => state.mcp[0]?.state === "connected")
  saved = await readJson(path.join(home, "mcp.json"), { mcpServers: {} })
  expect(saved.mcpServers.demo!.enabled).toBeUndefined()

  setup.mockInput.pressArrow("down")
  await setup.waitForFrame((f) => f.includes("❯ context7"))
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("Context7 · có sẵn, đang tắt"))
  show(frame)
  expect(frame).toContain("https://mcp.context7.com/mcp (http)")
  expect(frame).toContain("enter để bật")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("❯ context7") && f.includes("Quản lý MCP server"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
}, 30_000)

test("/mcp: enabling an OAuth catalog entry connects, then starts the login (no stuck screen)", async () => {
  const { MCP_CATALOG } = await import("../src/core/mcp/catalog")
  const { startHttpServer } = await import("./fixtures/remote-mcp")
  const remote = startHttpServer({ oauth: true })
  const notion = MCP_CATALOG.find((e) => e.id === "notion")!
  const build = notion.build
  notion.build = () => ({ type: "http", url: remote.url })
  const realLogin = runtime.mcp.login.bind(runtime.mcp)
  const logins: string[] = []
  runtime.mcp.login = async (name, opts) => {
    logins.push(name)
    opts.onUrl("https://login.example/authorize?client_id=x&state=y")
    await new Promise<void>((resolve) => opts.signal?.addEventListener("abort", () => resolve(), { once: true }))
    throw new Error("Đã huỷ đăng nhập.")
  }
  try {
    await setup.mockInput.typeText("/mcp")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("❯ demo"))
    for (let i = 0; i < 3; i++) setup.mockInput.pressArrow("down") // context7, github, notion
    await setup.waitForFrame((f) => f.includes("❯ notion"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("Notion · có sẵn, đang tắt") && f.includes("enter để bật"))
    setup.mockInput.pressEnter()
    await waitMcp(() => logins.length === 1)
    expect(logins).toEqual(["notion"])
    expect(state.mcp.find((s) => s.name === "notion")?.state).toBe("needs-auth")
    const frame = await setup.waitForFrame((f) => f.includes("Đang đăng nhập notion") && f.includes("login.example"))
    show(frame)
    // Esc cancels the login and returns to the server screen.
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => f.includes("notion · MCP server"))
    // Then remove it again (global servers can be removed from the panel).
    // Menu for a server that needs auth: 1 Đăng nhập · 2 Kết nối lại · 3 Tắt · 4 Xoá…
    const menu = await setup.waitForFrame((f) => f.includes("4. Xoá khỏi cấu hình"))
    expect(menu).toContain("1. Đăng nhập")
    await setup.mockInput.typeText("4")
    await setup.waitForFrame((f) => f.includes("Xoá \"notion\""))
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.mcp.some((s) => s.name === "notion"))
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    notion.build = build
    runtime.mcp.login = realLogin
    remote.stop()
  }
}, 30_000)

test("/mcp: a pasted token is never shown on screen", async () => {
  await setup.mockInput.typeText("/mcp")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("❯ demo"))
  for (let i = 0; i < 2; i++) setup.mockInput.pressArrow("down") // context7, github
  await setup.waitForFrame((f) => f.includes("❯ github"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("GitHub Personal Access Token"))
  await setup.mockInput.pasteBracketedText("ghp_SECRET_1234567890")
  const frame = await setup.waitForFrame((f) => f.includes("21 ký tự"))
  show(frame)
  expect(frame).not.toContain("ghp_SECRET")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Quản lý MCP server"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/tools lists built-in and MCP tools", async () => {
  // Tool search forced on: the demo server's tools are marked as deferred.
  await saveConfig({ toolSearch: "on" })
  let frame: string
  try {
    await setup.mockInput.typeText("/tools")
    setup.mockInput.pressEnter()
    // 6 core built-ins (current_time, load_skill, ask_user, todo_write, tool_search, read_file)
    // + 23 local tools (glob_files, grep_files, write_file, edit_file, shell, chart, session, watchlist, web, spawn_subagent, send_message, stop_agent, doctor_local)
    // + propose_memory + 4 from the demo MCP server
    frame = await setup.waitForFrame((f) => f.includes("Tool · 34") && f.includes("25 tool hoãn"))
    show(frame)
    // Regression for the 01/10 screenshot: every tool is exactly one line, long descriptions
    // end in "…" instead of wrapping mid-word, and the mark column is straight.
    const rows = frame.split("\n").filter((l) => /^ {2}(❯ |  )[◇◆] \S/.test(l))
    expect(rows.length).toBeGreaterThanOrEqual(7)
    expect(new Set(rows.map((r) => r.search(/[◇◆]/))).size).toBe(1)
    // Labels sit in their own right-hand column, so descriptions still start at one cell.
    expect(new Set(rows.map((r) => r.search(/\[(chỉ đọc|ghi|không hoàn tác)\]/))).size).toBe(1)
    const timeRow = rows.find((r) => r.includes("current_time"))!
    expect(timeRow).toMatch(/…\s+\[chỉ đọc\]\s*$/)
    expect(frame).not.toMatch(/^\s+Asia\/H/m)
    expect(frame).toContain("Có sẵn")
    // 3 demo tools (add is alwaysLoad) + 22 optional local tools (incl. glob_files/grep_files/write_file/edit_file/shell) (incl. web_search/web_fetch) (chart, session, watchlist, doctor, send_message, stop_agent)
    expect(frame).toContain("25 tool hoãn: model chỉ thấy tên")
    expect(timeRow).not.toContain("hoãn · ")
    // read_file is core (a path from the user is read at once); spawn_subagent sits below the fold now.
    expect(rows.find((r) => r.includes(" read_file "))).not.toContain("hoãn · ")
    expect(rows.find((r) => r.includes(" glob_files "))).toContain("hoãn · ")
    expect(rows.find((r) => r.includes(" chart_render "))).toContain("hoãn · ")
    // ↑ from the first row wraps to the last: the Memory and MCP groups sit below the fold.
    setup.mockInput.pressArrow("up")
    frame = await setup.waitForFrame((f) => f.includes("MCP · demo") && f.includes("34/34"))
    show(frame)
    expect(frame).toContain("Memory")
    const tail = frame.split("\n").filter((l) => /^ {2}(❯ |  )[◇◆] \S/.test(l))
    expect(tail.find((r) => r.includes(" echo "))).toContain("hoãn · ")
    setup.mockInput.pressArrow("down")
    await setup.waitForFrame((f) => f.includes("1/34"))
  } finally {
    await saveConfig({ toolSearch: undefined })
  }
  // Enter shows the tool's details; esc goes back to the list, esc again closes.
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Chi tiết tool") && f.includes("Tên đầy đủ"))
  // First row is ask_user (built-ins sort by name); native zod schemas show their parameters.
  expect(frame).toContain("ask_user")
  expect(frame).toMatch(/• questions \(bắt buộc\): array/)
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Tool · 34"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("a lone '/' + enter is never sent to the model", async () => {
  const before = chatCalls.length
  const lines = state.lines.length
  await setup.mockInput.typeText("/ ")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => !f.includes("› / "))
  expect(chatCalls.length).toBe(before)
  expect(state.lines.length).toBe(lines)
})

test("MCP prompts are slash commands: suggested, argument-checked, sent as the user's message", async () => {
  await setup.mockInput.typeText("/demo:")
  const frame = await setup.waitForFrame((f) => f.includes("/demo:phan_tich <ma> [goc_nhin]"))
  expect(frame).toContain("Phân tích nhanh một mã cổ phiếu")
  show(frame)
  for (let i = 0; i < "/demo:".length; i++) setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))

  // The prompt needs <ma>: enter on it in the list fills "/demo:phan_tich " and shows the arguments.
  await setup.mockInput.typeText("/demo:phan_tich")
  setup.mockInput.pressEnter()
  const hint = await setup.waitForFrame((f) => f.includes("› /demo:phan_tich ") && f.includes("<ma> [goc_nhin]"))
  show(hint)
  // Enter again without arguments: the usage error.
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Thiếu ma"))

  await setup.mockInput.typeText("/demo:phan_tich vcb biên lãi gộp")
  setup.mockInput.pressEnter()
  const sent = await setup.waitForFrame((f) => f.includes("Phân tích nhanh mã VCB, trọng tâm: biên lãi gộp"))
  expect(sent).toContain("Prompt /demo:phan_tich của server demo")
  // Sent as the user's own message (the provider's reply does not matter here).
  expect(state.lines.some((l) => l.kind === "user" && l.text.startsWith("Phân tích nhanh mã VCB, trọng tâm: biên lãi gộp."))).toBe(true)
  for (let i = 0; i < 100 && state.streaming; i++) await new Promise((r) => setTimeout(r, 50))
})

test("/profile creates INVESTOR.md from a template", async () => {
  await setup.mockInput.typeText("/profile")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Đã tạo hồ sơ nhà đầu tư mẫu"))
  expect(await Bun.file(path.join(home, "INVESTOR.md")).text()).toContain("# Hồ sơ nhà đầu tư")
})

test("/context shows each prompt layer with its token estimate", async () => {
  await setup.mockInput.typeText("/context")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("Danh tính & bất biến") && f.includes("Hồ sơ nhà đầu tư"))
  expect(frame).toContain("Danh sách skill")
  expect(frame).toContain("hạng B")
  show(frame)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("a retried request waits on the working row (with its deadline) and leaves nothing in the transcript", async () => {
  await setKey("nvidia", "nvapi-good-key")
  overloaded = 2
  // Every retry the working row sees, in order.
  const seen: { attempt: number; until: number; label: string }[] = []
  const stop = createRoot((dispose) => {
    createEffect(() => {
      const retry = state.activity?.retry
      if (retry) seen.push({ attempt: retry.attempt, until: retry.until, label: retry.label })
    })
    return dispose
  })
  try {
    const before = state.lines.length
    await setup.mockInput.typeText("QUÁ-TẢI thử")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.lines.slice(before).some((l) => l.kind === "user" && l.text === "QUÁ-TẢI thử"))
    await setup.waitFor(() => !state.streaming)
    const turn = state.lines.slice(before)
    expect(turn.some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI"))).toBe(true)
    expect(turn.filter((l) => "text" in l && /thử lại|lỗi tạm thời/.test(l.text))).toEqual([])
    expect(seen.map((r) => r.attempt)).toEqual([1, 2])
    expect(seen[0]!.label).toBe("provider lỗi tạm thời (503)")
    // OPENTRADING_RETRY_SCALE=0: the deadline is the real (zero) wait, not the nominal delay.
    expect(seen[0]!.until).toBeLessThanOrEqual(Date.now())
    expect(state.activity).toBeUndefined()
  } finally {
    stop()
  }
})

test("a real retry wait counts down on the working row above the prompt, then is gone", async () => {
  await setKey("nvidia", "nvapi-good-key")
  const saved = process.env.OPENTRADING_RETRY_SCALE
  // The first backoff (2–2.5 s) really waits half of that: long enough to see the row.
  process.env.OPENTRADING_RETRY_SCALE = "0.5"
  overloaded = 1
  try {
    await setup.mockInput.typeText("QUÁ-TẢI đếm ngược")
    setup.mockInput.pressEnter()
    let frame = ""
    for (let i = 0; i < 100 && !frame.includes("thử lại sau"); i++) {
      await new Promise((r) => setTimeout(r, 20))
      await setup.renderOnce()
      frame = setup.captureCharFrame()
    }
    show(frame)
    expect(frame).toMatch(/△ Provider lỗi tạm thời \(503\) · thử lại sau [12]s \(lần 1\/4\) · esc dừng/)
    const rows = frame.split("\n")
    expect(rows.findIndex((r) => r.includes("thử lại sau"))).toBeLessThan(rows.findIndex((r) => r.includes("› ")))
    await waitMcp(() => !state.streaming)
    const answered = state.lines.findIndex((l) => l.kind === "user" && l.text === "QUÁ-TẢI đếm ngược")
    expect(state.lines.slice(answered).some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI"))).toBe(true)
    frame = await setup.waitForFrame((f) => f.includes("QUÁ-TẢI đếm ngược") && !f.includes("đang trả lời…"))
    expect(frame).not.toContain("thử lại sau")
    expect(frame).not.toContain("lỗi tạm thời")
  } finally {
    if (saved === undefined) delete process.env.OPENTRADING_RETRY_SCALE
    else process.env.OPENTRADING_RETRY_SCALE = saved
    overloaded = 0
  }
})

test("a tool call renders as a ● row with its result under ⎿, then the answer", async () => {
  await setKey("nvidia", "nvapi-good-key")
  await setup.mockInput.typeText("MẤY-GIỜ rồi?")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("HẾT-CÂU-TRẢ-LỜI") && f.includes("● current_time()"))
  // Claude Code style: ❯ for the user, ● for answers and calls, ⎿ for the result.
  expect(frame).toContain("  ⎿  ")
  expect(frame).toContain("❯ MẤY-GIỜ rồi?")
  expect(frame).not.toContain("◆ OpenTrading")
  expect(frame).toContain("giờ Việt Nam")
  show(frame)
  await setup.waitFor(() => !state.streaming)
  const roles = state.history.map((m) => m.role)
  expect(roles.slice(-4)).toEqual(["user", "assistant", "tool", "assistant"])
})

test("the context size follows each step's usage while a turn is still running", async () => {
  await setKey("nvidia", "nvapi-good-key")
  let release = () => {}
  usageGate = new Promise<void>((resolve) => (release = resolve))
  try {
    await setup.mockInput.typeText("ĐẾM-TOKEN đi")
    setup.mockInput.pressEnter()
    // The tool step reported 50000 in + 10 out; the answer is still held.
    await setup.waitFor(() => state.contextTokens === 50_010)
    expect(state.streaming).toBe(true)
  } finally {
    release()
    usageGate = undefined
  }
  await setup.waitFor(() => !state.streaming)
})

// Regression: every token was its own store write, so the answer was re-laid-out per token.
test("streamed text reaches the transcript in batches, whole and in order", async () => {
  await setKey("nvidia", "nvapi-good-key")
  const seen = new Set<string>()
  const stop = createRoot((dispose) => {
    createEffect(() => {
      const last = state.lines.at(-1)
      if (last?.kind === "assistant") seen.add(last.text)
    })
    return dispose
  })
  const before = state.lines.length
  try {
    await setup.mockInput.typeText("NHIỀU-MẨU nhé")
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.streaming && state.lines.slice(before).some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI")))
  } finally {
    stop()
  }
  const answer = state.lines.findLast((l) => l.kind === "assistant")
  expect(answer?.kind === "assistant" && answer.text).toBe(Array.from({ length: 60 }, (_, i) => `m${i} `).join("") + "HẾT-CÂU-TRẢ-LỜI")
  // 61 deltas, a handful of writes.
  expect(seen.size).toBeLessThan(10)
})

test("a write tool asks first: esc denies just that call (the turn goes on), 2 allows for the session", async () => {
  const toolResult = () => {
    const tool = [...state.history].reverse().find((m) => m.role === "tool")
    return JSON.stringify(tool?.content ?? "")
  }
  await setup.mockInput.typeText("GHI-CHÚ giúp tôi")
  setup.mockInput.pressEnter()
  let frame = await setup.waitForFrame((f) => f.includes("Cần xác nhận") && f.includes("Cho phép chạy?"))
  show(frame)
  expect(frame).toContain("demo · ghi_chu")
  expect(frame).toContain("noi_dung: mua VCB khi về 85")
  expect(frame).toMatch(/❯ 1\. Có/)
  expect(frame).toContain("Có, cả phiên này")
  expect(frame).toContain("Luôn cho phép")
  expect(frame).not.toContain("Hỏi về thị trường") // the prompt input is hidden meanwhile
  // Esc answers the prompt with "no" — it must not also stop the turn.
  setup.mockInput.pressEscape()
  // The denial shows under its own tool row.
  frame = await setup.waitForFrame((f) => /● demo · ghi_chu.*\n\s+⎿  ✘ Đã từ chối/.test(f))
  await waitMcp(() => !state.streaming)
  expect(toolResult()).toContain("Người dùng từ chối chạy tool này")
  expect(state.approval).toBeUndefined()
  const answer = state.history.at(-1)
  expect(answer?.role).toBe("assistant")
  expect(JSON.stringify(answer?.content)).toContain("HẾT-CÂU-TRẢ-LỜI")
  expect(JSON.stringify(answer?.content)).not.toContain("đã dừng")

  await setup.mockInput.typeText("GHI-CHÚ lần nữa")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cho phép chạy?"))
  await setup.mockInput.typeText("2")
  await setup.waitForFrame((f) => f.includes("⎿  ✓ Đã cho phép cho cả phiên"))
  await waitMcp(() => !state.streaming)
  expect(toolResult()).toContain("Đã lưu ghi chú #1")

  // Allowed for the session: the third call runs without asking.
  let asked = false
  const stop = runtime.permissions.onChange((head) => (asked ||= head !== undefined))
  await setup.mockInput.typeText("GHI-CHÚ lần ba")
  setup.mockInput.pressEnter()
  await waitMcp(() => state.history.length > 0 && toolResult().includes("Đã lưu ghi chú #2"))
  await waitMcp(() => !state.streaming)
  stop()
  expect(asked).toBe(false)
}, 30_000)

test("esc on the approval prompt denies that call without stopping the turn", async () => {
  // A fresh tool name per session would be cleaner; the session allow above covers ghi_chu,
  // so deny through the gate directly for a tool that is not allowed yet.
  const { z } = await import("zod")
  runtime.registry.register({
    name: "xoa_du_lieu",
    description: "Xoá dữ liệu (tool thử)",
    input: z.object({}),
    readOnly: false,
    annotations: { destructive: true },
    displayName: "test · xoa_du_lieu",
    execute: async () => "đã xoá",
  })
  const controller = new AbortController()
  const decision = runtime.permissions.check(runtime.registry.get("xoa_du_lieu")!, { bang: "giao_dich" }, controller.signal, "test · xoa_du_lieu")
  const frame = await setup.waitForFrame((f) => f.includes("Cần xác nhận · thay đổi không hoàn tác được"))
  expect(frame).toContain("test · xoa_du_lieu  [không hoàn tác]")
  setup.mockInput.pressEscape()
  expect((await decision).allow).toBe(false)
  expect(controller.signal.aborted).toBe(false)
  runtime.registry.unregister("xoa_du_lieu")
})

test("esc with the '/' list open while answering closes the list, not the answer; a second esc stops it", async () => {
  // A tool that waits keeps the turn streaming long enough to type during it.
  const { z } = await import("zod")
  let release: () => void = () => {}
  runtime.registry.register({
    name: "cho_lau",
    description: "Đợi (tool thử)",
    input: z.object({}),
    readOnly: true,
    execute: (_input, ctx) =>
      new Promise((resolve, reject) => {
        release = () => resolve("xong")
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      }),
  })
  callSlowTool = true
  try {
    await setup.mockInput.typeText("CHẬM nhé")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.lines.some((l) => l.kind === "tool" && l.label.includes("cho_lau") && l.status === "running"))
    await setup.mockInput.typeText("/")
    await setup.waitForFrame((f) => f.includes("enter chạy · tab điền"))
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))
    expect(state.streaming).toBe(true) // the answer goes on
    release()
    await waitMcp(() => !state.streaming)
    const answer = state.history.at(-1)
    expect(JSON.stringify(answer?.content)).toContain("HẾT-CÂU-TRẢ-LỜI")
    setup.mockInput.pressBackspace()

    // With the list closed, esc stops a running answer as before.
    await setup.mockInput.typeText("CHẬM lần nữa")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.lines.filter((l) => l.kind === "tool" && l.label.includes("cho_lau")).length === 2)
    setup.mockInput.pressEscape()
    await waitMcp(() => !state.streaming)
    expect(JSON.stringify(state.history.at(-1)?.content)).toContain("(đã dừng)")
  } finally {
    callSlowTool = false
    runtime.registry.unregister("cho_lau")
  }
}, 30_000)

test("80×24: panels and the '/' list keep their hint line and the status bar on screen", async () => {
  setup.resize(80, 24)
  try {
    const visible = (f: string) => f.includes("▲ OpenTrading")
    await setup.mockInput.typeText("/")
    let frame = await setup.waitForFrame((f) => f.includes("enter chạy · tab điền") && visible(f))
    show(frame)
    expect(frame.split("\n").length).toBeLessThanOrEqual(25)
    setup.mockInput.pressBackspace()
    await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))

    for (const [command, hint] of [
      ["/tools", "enter xem chi tiết · esc đóng"],
      ["/mcp", "space bật/tắt"],
      ["/help", "enter chạy lệnh · esc đóng"],
    ] as const) {
      await setup.mockInput.typeText(command)
      setup.mockInput.pressEnter()
      frame = await setup.waitForFrame((f) => f.includes(hint) && visible(f))
      show(frame)
      setup.mockInput.pressEscape()
      await setup.waitFor(() => state.dialog === undefined)
    }
  } finally {
    setup.resize(100, 32)
  }
})

test("80×24: a short notice sits on the mode line; a long one gets its own wrapped rows, in full", async () => {
  setup.resize(80, 24)
  try {
    say("Đã copy 12 ký tự", "success")
    let frame = await setup.waitForFrame((f) => f.includes("✓ Đã copy 12 ký tự"))
    const line = frame.split("\n").find((r) => r.includes("✓ Đã copy 12 ký tự"))!
    expect(line).toContain("‖ chỉ đọc")

    const long = "Model test-model không đọc được ảnh. Đổi model bằng /model, hoặc xoá ảnh khỏi ô nhập rồi gửi lại."
    say(long, "error")
    frame = await setup.waitForFrame((f) => f.includes("gửi lại."))
    show(frame)
    // Every word is on screen, on its own rows under the mode line; neither line is squeezed.
    const rows = frame.split("\n")
    const modeAt = rows.findIndex((r) => r.includes("‖ chỉ đọc"))
    const barAt = rows.findIndex((r) => r.includes("▲ OpenTrading"))
    const text = rows
      .slice(modeAt + 1, barAt)
      .map((r) => r.trim())
      .join(" ")
    expect(text).toContain(`✘ ${long}`)
    expect(rows[modeAt]).not.toContain("không đọc được ảnh")
    expect(rows[barAt]).not.toContain("không đọc được ảnh")
    expect(rows.length).toBeLessThanOrEqual(25)
  } finally {
    resetNotifications()
    setup.resize(100, 32)
  }
})

test("80×24: todos, the working row and seven subagents still leave the prompt, mode line and status bar on screen", async () => {
  setup.resize(80, 24)
  const { startActivity } = await import("../src/tui/activity")
  const agents = Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [
      `ag-80x24-${i}`,
      {
        id: `ag-80x24-${i}`,
        type: "nghien-cuu",
        description: `Việc số ${i}`,
        prompt: "",
        background: false,
        model: "",
        status: "running" as const,
        createdAt: Date.now() + i,
        startedAt: Date.now(),
        tools: [],
        toolCount: 0,
        usage: { input: 0, output: 0 },
        text: "",
      },
    ]),
  )
  setState("agents", reconcile(agents))
  setState({
    activity: startActivity(),
    liveTodos: Array.from({ length: 8 }, (_, i) => ({ content: `Việc cần ${i}`, status: i === 0 ? ("in_progress" as const) : ("pending" as const) })),
  })
  try {
    const frame = await setup.waitForFrame((f) => f.includes("Việc cần làm · 0/8") && f.includes("Việc số 0") && f.includes("… +"))
    show(frame)
    const rows = frame.split("\n")
    expect(rows.length).toBeLessThanOrEqual(25)
    expect(rows.some((r) => r.includes("› "))).toBe(true)
    expect(rows.some((r) => /^ {3}‖ chỉ đọc/.test(r))).toBe(true)
    expect(rows.some((r) => r.includes("▲ OpenTrading"))).toBe(true)
    expect(rows.some((r) => r.includes("main"))).toBe(true)
  } finally {
    setState("agents", reconcile({}))
    setState({ activity: undefined, liveTodos: undefined })
    setup.resize(100, 32)
  }
})

test("80×24: a full todo panel and the '/' list still leave the prompt, hint and status bar on screen", async () => {
  setup.resize(80, 24)
  setState("liveTodos", Array.from({ length: 8 }, (_, i) => ({ content: `Việc số ${i}`, status: i === 0 ? ("in_progress" as const) : ("pending" as const) })))
  try {
    await setup.mockInput.typeText("/")
    const frame = await setup.waitForFrame((f) => f.includes("enter chạy · tab điền") && f.includes("Việc cần làm · 0/8"))
    show(frame)
    expect(frame).toContain("▲ OpenTrading")
    expect(frame).toContain("… +3 việc")
    expect(frame.split("\n").length).toBeLessThanOrEqual(25)
    setup.mockInput.pressBackspace()
    await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))
  } finally {
    setState("liveTodos", undefined)
    setup.resize(100, 32)
  }
})

test("ask_user: one single-choice question sends on pick and the turn goes on", async () => {
  const lastTool = () => JSON.stringify([...state.history].reverse().find((m) => m.role === "tool")?.content ?? "")
  await setup.mockInput.typeText("HỎI-TÔI giúp mình")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("Câu hỏi cho bạn") && f.includes("Bạn đầu tư trong bao lâu?"))
  show(frame)
  expect(frame).toMatch(/❯ 1\. Dưới 1 năm/)
  expect(frame).toContain("Lướt sóng, ưu tiên thanh khoản")
  expect(frame).toContain("4. Khác (tự nhập)")
  expect(frame).not.toContain("Hỏi về thị trường") // the prompt input is hidden meanwhile
  await setup.mockInput.typeText("2")
  await waitMcp(() => !state.streaming)
  expect(lastTool()).toContain('Người dùng đã trả lời: \\"Bạn đầu tư trong bao lâu?\\"=\\"1–3 năm\\"')
  expect(JSON.stringify(state.history.at(-1)?.content)).toContain("HẾT-CÂU-TRẢ-LỜI")
  expect(state.question).toBeUndefined()
}, 30_000)

test("ask_user: esc declines without stopping the turn; 'Khác' takes a typed answer", async () => {
  const lastTool = () => JSON.stringify([...state.history].reverse().find((m) => m.role === "tool")?.content ?? "")
  await setup.mockInput.typeText("HỎI-TÔI lần nữa")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Câu hỏi cho bạn"))
  setup.mockInput.pressEscape()
  await waitMcp(() => !state.streaming)
  expect(lastTool()).toContain("Người dùng bỏ qua các câu hỏi")
  expect(JSON.stringify(state.history.at(-1)?.content)).toContain("HẾT-CÂU-TRẢ-LỜI")
  expect(JSON.stringify(state.history.at(-1)?.content)).not.toContain("đã dừng")

  await setup.mockInput.typeText("HỎI-TÔI tự nhập")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Câu hỏi cho bạn"))
  await setup.mockInput.typeText("4")
  await setup.waitForFrame((f) => f.includes("Câu trả lời của bạn"))
  setup.mockInput.pressEnter() // empty: nothing typed yet, the question stays open
  await setup.waitForFrame((f) => f.includes("Bạn đầu tư trong bao lâu?") && !f.includes("Câu trả lời của bạn"))
  expect(state.question).toBeDefined()
  await setup.mockInput.typeText("4")
  await setup.waitForFrame((f) => f.includes("Câu trả lời của bạn"))
  await setup.mockInput.typeText("6 tháng")
  setup.mockInput.pressEnter()
  await waitMcp(() => !state.streaming)
  expect(lastTool()).toContain("6 tháng")
}, 30_000)

test("ask_user: several questions have tabs, multi-select and a review before sending", async () => {
  const lastTool = () => JSON.stringify([...state.history].reverse().find((m) => m.role === "tool")?.content ?? "")
  await setup.mockInput.typeText("HỎI-NHIỀU nhé")
  setup.mockInput.pressEnter()
  let frame = await setup.waitForFrame((f) => f.includes("[ ] Khung TG") && f.includes("✓ Gửi"))
  show(frame)
  await setup.mockInput.typeText("3") // single choice → next tab
  frame = await setup.waitForFrame((f) => f.includes("Bạn quan tâm ngành nào?"))
  expect(frame).toContain("[x] Khung TG")
  await setup.mockInput.typeText("1")
  await setup.mockInput.typeText("2")
  frame = await setup.waitForFrame((f) => (f.match(/\[x\] (Ngân hàng|Thép)/g) ?? []).length === 2)
  setup.mockInput.pressArrow("right")
  frame = await setup.waitForFrame((f) => f.includes("Xem lại câu trả lời"))
  show(frame)
  expect(frame).toContain("→ Trên 3 năm")
  expect(frame).toContain("→ Ngân hàng, Thép")
  setup.mockInput.pressEnter()
  await waitMcp(() => !state.streaming)
  expect(lastTool()).toContain("Ngân hàng, Thép")
  expect(lastTool()).toContain("Trên 3 năm")
}, 30_000)

test("Ctrl+C like Claude Code: the first press clears the draft and says press again; a second within 800 ms exits", async () => {
  const before = exits
  await setup.mockInput.typeText("bản nháp dở")
  await setup.waitForFrame((f) => f.includes("› bản nháp dở"))
  setup.mockInput.pressKey("c", { ctrl: true })
  let frame = await setup.waitForFrame((f) => f.includes("Nhấn Ctrl+C lần nữa để thoát"))
  show(frame)
  expect(frame).not.toContain("› bản nháp dở")
  expect(exits).toBe(before)
  // The hint goes away after the window; a late second press only arms again.
  await new Promise((r) => setTimeout(r, 900))
  await setup.waitForFrame((f) => !f.includes("lần nữa để thoát"))
  setup.mockInput.pressKey("c", { ctrl: true })
  await setup.waitForFrame((f) => f.includes("Nhấn Ctrl+C lần nữa để thoát"))
  expect(exits).toBe(before)
  setup.mockInput.pressKey("c", { ctrl: true })
  await waitMcp(() => exits === before + 1)

  // Ctrl+D counts only on an empty prompt.
  await new Promise((r) => setTimeout(r, 900))
  setup.mockInput.pressKey("d", { ctrl: true })
  await setup.waitForFrame((f) => f.includes("Nhấn Ctrl+D lần nữa để thoát"))
  await new Promise((r) => setTimeout(r, 900))
})

test("Ctrl+C while answering stops the answer (and arms exit); on an approval it denies", async () => {
  const before = exits
  const { z } = await import("zod")
  let release: () => void = () => {}
  runtime.registry.register({
    name: "cho_lau",
    description: "Đợi (tool thử)",
    input: z.object({}),
    readOnly: true,
    execute: (_input, ctx) =>
      new Promise((resolve, reject) => {
        release = () => resolve("xong")
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      }),
  })
  callSlowTool = true
  try {
    await setup.mockInput.typeText("CHẬM ctrl c")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.lines.some((l) => l.kind === "tool" && l.label.includes("cho_lau") && l.status === "running"))
    setup.mockInput.pressKey("c", { ctrl: true })
    await waitMcp(() => !state.streaming)
    expect(JSON.stringify(state.history.at(-1)?.content)).toContain("(đã dừng)")
    expect(exits).toBe(before)
  } finally {
    release()
    callSlowTool = false
    runtime.registry.unregister("cho_lau")
  }
  await new Promise((r) => setTimeout(r, 900))

  runtime.registry.register({ name: "xoa_thu", description: "Xoá (tool thử)", input: z.object({}), readOnly: false, execute: async () => "đã xoá" })
  const decision = runtime.permissions.check(runtime.registry.get("xoa_thu")!, {}, new AbortController().signal, "test · xoa_thu")
  await setup.waitForFrame((f) => f.includes("Cần xác nhận"))
  setup.mockInput.pressKey("c", { ctrl: true })
  expect((await decision).allow).toBe(false)
  expect(exits).toBe(before)
  runtime.registry.unregister("xoa_thu")
  await new Promise((r) => setTimeout(r, 900))
})

test("highlighting with the mouse copies the words only (no ● / ⎿, no trailing spaces) and says so", async () => {
  await setup.mockInput.typeText("Chào bạn")
  setup.mockInput.pressEnter()
  await waitMcp(() => !state.streaming)
  const frame = await setup.waitForFrame((f) => f.includes("● Xin chào! T+2.5"))
  const rows = frame.split("\n")
  const row = rows.findLastIndex((l) => l.includes("● Xin chào! T+2.5"))
  const start = rows[row]!.indexOf("Xin")
  const before = osc52.length
  // Drag from "Xin" across into the next lines of the same answer.
  await setup.mockMouse.drag(start, row, start + 20, row + 2)
  await waitMcp(() => osc52.length > before)
  const text = osc52.at(-1)!
  show(text)
  expect(text.startsWith("Xin chào!")).toBe(true)
  expect(text).not.toContain("●")
  expect(text).not.toContain("⎿")
  expect(text.split("\n").every((l) => l === l.trimEnd())).toBe(true)
  await setup.waitForFrame((f) => f.includes("✓ Đã copy"))
  // Clicking moved focus to the transcript; typing must still land in the prompt.
  await setup.mockInput.typeText("gõ tiếp")
  await setup.waitForFrame((f) => f.includes("› gõ tiếp"))
  for (let i = 0; i < "gõ tiếp".length; i++) setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
})

test("an approval in the middle of a question set keeps the answers already picked", async () => {
  const { z } = await import("zod")
  const asking = runtime.questions.ask(ASK_MANY.questions as never, new AbortController().signal, "call_keep")
  await setup.waitForFrame((f) => f.includes("[ ] Khung TG"))
  await setup.mockInput.typeText("3") // "Trên 3 năm" → moves to the next question
  await setup.waitForFrame((f) => f.includes("[x] Khung TG") && f.includes("Bạn quan tâm ngành nào?"))
  await setup.mockInput.typeText("1") // Ngân hàng, picked but not sent

  runtime.registry.register({ name: "ghi_tam", description: "Ghi (tool thử)", input: z.object({}), readOnly: false, execute: async () => "ok" })
  const decision = runtime.permissions.check(runtime.registry.get("ghi_tam")!, {}, new AbortController().signal, "test · ghi_tam")
  let frame = await setup.waitForFrame((f) => f.includes("Cần xác nhận") && !f.includes("Bạn quan tâm ngành nào?"))
  await setup.mockInput.typeText("4")
  expect((await decision).allow).toBe(false)

  // The question set comes back exactly as it was left.
  frame = await setup.waitForFrame((f) => f.includes("Bạn quan tâm ngành nào?") && f.includes("[x] Khung TG"))
  expect(frame).toMatch(/\[x\] Ngân hàng/)
  setup.mockInput.pressArrow("right")
  frame = await setup.waitForFrame((f) => f.includes("Xem lại câu trả lời"))
  expect(frame).toContain("→ Trên 3 năm")
  expect(frame).toContain("→ Ngân hàng")
  setup.mockInput.pressEnter()
  const result = await asking
  expect(result).toEqual({ answered: true, answers: { "Bạn đầu tư trong bao lâu?": "Trên 3 năm", "Bạn quan tâm ngành nào?": "Ngân hàng" } })
  runtime.registry.unregister("ghi_tam")
}, 30_000)

test("an approval while a panel is open keeps what was typed there; the panel ignores keys meanwhile", async () => {
  const { z } = await import("zod")
  await setup.mockInput.typeText("/connect")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Kết nối provider"))
  setup.mockInput.pressEnter() // first provider
  await setup.waitForFrame((f) => f.includes("API key ·"))
  await setup.mockInput.pasteBracketedText("gsk_giu_nguyen")
  await setup.waitForFrame((f) => f.includes("14 ký tự"))

  runtime.registry.register({ name: "ghi_tam2", description: "Ghi (tool thử)", input: z.object({}), readOnly: false, execute: async () => "ok" })
  const decision = runtime.permissions.check(runtime.registry.get("ghi_tam2")!, {}, new AbortController().signal, "test · ghi_tam2")
  await setup.waitForFrame((f) => f.includes("Cần xác nhận") && !f.includes("14 ký tự"))
  expect(state.dialog).toBe("connect") // not closed
  await setup.mockInput.typeText("4") // answers the approval only; nothing typed into the key
  expect((await decision).allow).toBe(false)
  await setup.waitForFrame((f) => f.includes("14 ký tự"))
  runtime.registry.unregister("ghi_tam2")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => !f.includes("API key ·"))
  if (state.dialog) setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("approval note: a note abandoned with esc is not sent later", async () => {
  const { z } = await import("zod")
  runtime.registry.register({ name: "ghi_tam3", description: "Ghi (tool thử)", input: z.object({}), readOnly: false, execute: async () => "ok" })
  const decision = runtime.permissions.check(runtime.registry.get("ghi_tam3")!, {}, new AbortController().signal, "test · ghi_tam3")
  await setup.waitForFrame((f) => f.includes("Cần xác nhận"))
  setup.mockInput.pressTab()
  await setup.waitForFrame((f) => f.includes("Lời nhắn cho model"))
  await setup.mockInput.typeText("lời cũ")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => !f.includes("Lời nhắn cho model"))
  setup.mockInput.pressTab()
  await setup.waitForFrame((f) => f.includes("Lời nhắn cho model"))
  setup.mockInput.pressEnter()
  const d = await decision
  expect(d.allow).toBe(false)
  expect(d.message).toBeUndefined()
  runtime.registry.unregister("ghi_tam3")
})

test("/new starts a fresh session; /sessions reopens the previous one with its tool rows", async () => {
  const before = state.lines.length
  expect(before).toBeGreaterThan(0)
  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.lines.length === 0 && state.history.length === 0)

  await setup.mockInput.typeText("/sessions")
  setup.mockInput.pressEnter()
  // The title shows at once, the list after the sessions are read ("Đang đọc…"): wait for the
  // rows, or Enter lands on an empty list (slow Windows runners, main CI after #103).
  const list = await setup.waitForFrame((f) => f.includes("Phiên đã lưu") && f.includes("lượt"))
  show(list)
  setup.mockInput.pressEnter() // newest first: the session we just left
  await setup.waitFor(() => state.dialog === undefined && state.lines.length > 0)
  // The "reopened" note is the first line (may be scrolled out of view): check state.
  expect(state.lines[0]).toMatchObject({ kind: "info" })
  expect((state.lines[0] as { text: string }).text).toContain("Mở lại phiên")
  // Tool rows come back (the older ones may be scrolled out of view: check state too).
  expect(state.lines.some((l) => l.kind === "tool" && l.label.includes("current_time"))).toBe(true)
  const frame = await setup.waitForFrame((f) => f.includes("● "))
  expect(frame).not.toContain("<nhac_nho>")
  expect(state.history.length).toBeGreaterThan(0)
  expect(state.clock).toBeUndefined() // re-sent on the next turn
  show(frame)
})

test("/save copies the whole conversation as Markdown; /export writes it to a file, never replacing one unasked", async () => {
  const run = command

  // The OS command may not exist (CI without xclip): then OSC52 alone carries the copy.
  const copiedBefore = copied.length
  const oscBefore = osc52.length
  const saved = await run("/save")
  expect(saved.kind).toBe("notice")
  expect(saved.text).toMatch(/Đã copy toàn bộ hội thoại|OSC52/)
  expect(copied.length + osc52.length).toBeGreaterThan(copiedBefore + oscBefore)
  const md = copied.length > copiedBefore ? copied.at(-1)! : osc52.at(-1)!
  expect(md).toContain("## Bạn\n\nMẤY-GIỜ rồi?")
  expect(md).toContain("current_time")
  expect(md).toContain("**Input**")
  expect(md).toContain("HẾT-CÂU-TRẢ-LỜI")
  expect(md).not.toContain("<nhac_nho>")
  // The confirmation is a footer notice, never part of the conversation.
  expect(md).not.toContain("Đã copy toàn bộ")

  // No path: the session's file under OPENTRADING_HOME/exports; again replaces it.
  let line = await run("/export")
  expect(line.kind).toBe("info")
  const [defaultFile] = await readdir(path.join(home, "exports"))
  expect(defaultFile).toMatch(/\.md$/)
  expect(await Bun.file(path.join(home, "exports", defaultFile!)).text()).toBe(md)
  expect((await run("/export")).kind).toBe("info")

  // A path the user typed: ".md" added; an existing file is kept unless --force.
  const target = path.join(cwd, "xuat", "phien")
  line = await run(`/export ${target}`)
  expect(line.text).toContain(`${target}.md`)
  expect(await Bun.file(`${target}.md`).text()).toBe(md)
  line = await run(`/export ${target}`)
  expect(line.kind).toBe("error")
  expect(line.text).toContain("--force")
  expect((await run(`/export ${target} --force`)).kind).toBe("info")
})

test("shift+tab cycles ‖ chỉ đọc ↔ ▸ sửa có hỏi; a write in read-only shows its diff and can switch the mode", async () => {
  expect(runtime.permissions.mode).toBe("read-only")
  const lines = state.lines.length
  // The mode sits on the line under the prompt, with the cycle hint.
  // The mode line is indented 3 columns and starts with the mode glyph (dialog titles use 2).
  const modeRow = (f: string) => f.split("\n").find((r) => /^ {3}(‖|▸)/.test(r)) ?? ""
  await setup.waitForFrame((f) => modeRow(f).includes("‖ chỉ đọc (shift+tab đổi)"))
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((f) => modeRow(f).includes("▸ sửa có hỏi (shift+tab đổi)"))
  expect(runtime.permissions.mode).toBe("ask")

  // The first ▸▸ asks first, and the gate stays in ▸ until the user says yes.
  setup.mockInput.pressTab({ shift: true })
  let frame = await setup.waitForFrame((f) => f.includes("Bật chế độ ▸▸ tự động?"))
  show(frame)
  expect(modeRow(frame)).toContain("▸▸ tự động (chờ xác nhận)")
  expect(frame).toContain("Model duyệt có thể sai")
  expect(frame).toContain("giữ ▸ sửa có hỏi")
  expect(runtime.permissions.mode).toBe("ask")
  // Esc: no, stay in ▸.
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => !f.includes("Bật chế độ ▸▸ tự động?") && modeRow(f).includes("▸ sửa có hỏi"))
  expect(runtime.permissions.mode).toBe("ask")
  // Shift+Tab inside the dialog skips auto and moves on to ‖.
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((f) => f.includes("Bật chế độ ▸▸ tự động?"))
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((f) => !f.includes("Bật chế độ ▸▸ tự động?") && modeRow(f).includes("‖ chỉ đọc"))
  expect(runtime.permissions.mode).toBe("read-only")

  // An approval that arrives meanwhile goes first; the dialog comes back after it.
  setup.mockInput.pressTab({ shift: true })
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((f) => f.includes("Bật chế độ ▸▸ tự động?"))
  const write = runtime.registry.get("write_file")!
  let decision = runtime.permissions.check(write, { path: "tui-optin.md", content: "x\n" }, new AbortController().signal, "write_file tui-optin.md", "c-optin")
  frame = await setup.waitForFrame((f) => f.includes("Cho phép chạy?"))
  expect(frame).not.toContain("Bật chế độ ▸▸ tự động?")
  setup.mockInput.pressEscape()
  expect((await decision).allow).toBe(false)
  await setup.waitForFrame((f) => f.includes("Bật chế độ ▸▸ tự động?"))
  expect(runtime.permissions.mode).toBe("ask")

  // Yes: auto from now on, remembered; the next time Shift+Tab goes straight to it.
  setup.mockInput.pressKey("1")
  await setup.waitFor(() => runtime.permissions.mode === "auto")
  await setup.waitFor(async () => (await loadConfig()).permissions?.autoAcknowledged === true)
  expect((await loadConfig()).permissions?.defaultMode).toBeUndefined()
  await setup.waitForFrame((f) => modeRow(f).includes("▸▸ tự động (shift+tab đổi)"))
  // /permissions keeps the explanation for later, while auto is on.
  await setup.mockInput.typeText("/permissions")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Chế độ: ▸▸ tự động"))
  expect(frame).toContain("Model duyệt có thể sai")
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  setup.mockInput.pressTab({ shift: true })
  await setup.waitFor(() => runtime.permissions.mode === "read-only")
  setup.mockInput.pressTab({ shift: true })
  setup.mockInput.pressTab({ shift: true })
  await setup.waitFor(() => runtime.permissions.mode === "auto")
  expect(state.autoOptIn).toBeUndefined()
  setup.mockInput.pressTab({ shift: true })
  await setup.waitFor(() => runtime.permissions.mode === "read-only")
  // Nothing about the modes went to the transcript (only the denied write is recorded).
  expect(state.lines.slice(lines).filter((l) => "text" in l && /tự động|chỉ đọc|sửa có hỏi/i.test(l.text))).toEqual([])
  expect(state.lines.slice(lines)).toHaveLength(1)
  await saveConfig({ permissions: undefined })
  setState("autoAcknowledged", false)

  decision = runtime.permissions.check(write, { path: "tui-ke-hoach.md", content: "# Kế hoạch\nTheo dõi FPT\n" }, new AbortController().signal, "write_file tui-ke-hoach.md", "c-tui")
  frame = await setup.waitForFrame((f) => f.includes("đang ở chế độ ‖ chỉ đọc") && f.includes("+ # Kế hoạch"))
  show(frame)
  expect(frame).toContain("Có, và chuyển sang ▸ sửa có hỏi")
  expect(frame).toContain("(mới, 2 dòng)")
  expect(frame).not.toContain("Luôn cho phép")
  setup.mockInput.pressKey("2")
  expect(await decision).toEqual({ allow: true })
  expect(runtime.permissions.mode).toBe("ask")
  runtime.permissions.setMode("read-only")
})

test("/undo lists and puts back the agent's file changes; /permissions lists rules and deletes one with d", async () => {
  const run = command
  const write = runtime.registry.get("write_file")!
  await write.execute({ path: "undo-me.md", content: "x\n" }, { signal: new AbortController().signal, callId: "u1" })
  const file = path.join(cwd, "undo-me.md")
  expect(await Bun.file(file).exists()).toBe(true)
  let line = await run("/undo")
  expect(line.text).toContain("undo-me.md")
  expect(line.text).toContain("tạo")
  const n = runtime.history.list()[0]!.n
  // The list stays in the transcript; the result is a footer notice.
  expect(line.kind).toBe("info")
  line = await run(`/undo ${n}`)
  expect(line).toMatchObject({ kind: "notice", level: "success" })
  expect(line.text).toContain("Đã xoá")
  expect(await Bun.file(file).exists()).toBe(false)
  expect(await run(`/undo ${n}`)).toMatchObject({ kind: "notice", level: "error" })

  await saveConfig({ permissions: { allow: [{ tool: "mcp__demo__echo", scope: "demo@x" }], deny: [{ tool: "write_file", pattern: "*bi-mat*" }] } })
  try {
    await setup.mockInput.typeText("/permissions")
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("Quyền · 2 quy tắc") && f.includes("mẫu *bi-mat*"))
    show(frame)
    expect(frame).toContain("Chế độ: ‖ chỉ đọc")
    expect(frame).toContain(`Workspace: ${cwd}`)
    setup.mockInput.pressEnter() // the deny rule comes first
    frame = await setup.waitForFrame((f) => f.includes("d xoá"))
    setup.mockInput.pressKey("d")
    // The list shows 1 rule once the dialog has saved and read the config back; reading the
    // file while it is being replaced would race with that save.
    await setup.waitForFrame((f) => f.includes("Quyền · 1 quy tắc"))
    const saved = (await loadConfig()).permissions
    expect(saved?.deny ?? []).toHaveLength(0)
    expect(saved?.allow).toHaveLength(1)
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    await saveConfig({ permissions: undefined })
  }
})

test("/add-dir lists the workspace, adds a folder for the session or for good (--luu), refuses home", async () => {
  const run = command
  expect(await run("/add-dir")).toMatchObject({ kind: "info", text: expect.stringContaining(cwd) })
  const extra = path.join(cwd, "..", path.basename(cwd) + "-bctc")
  await mkdir(extra, { recursive: true })
  try {
    let line = await run(`/add-dir ${extra}`)
    expect(line).toMatchObject({ kind: "notice", level: "success" })
    expect(line.text).toContain("cho phiên này")
    expect(runtime.workspace.roots()).toContain(extra)
    expect(await run(`/add-dir ${extra}`)).toMatchObject({ kind: "notice", level: "error" })
    expect((await run(`/add-dir ${os.homedir()}`)).text).toContain("quá rộng")
    const kept = `${extra}-2`
    await mkdir(kept, { recursive: true })
    line = await run(`/add-dir ${kept} --luu`)
    expect(line.text).toContain("đã lưu")
    expect((await loadConfig()).workspace?.dirs).toEqual([kept])
    await saveConfig({ workspace: undefined })
    await rm(kept, { recursive: true, force: true })
  } finally {
    await rm(extra, { recursive: true, force: true })
  }
})

test("/memory: a model proposal is pending until approved with 'a'", async () => {
  await memory.add("Người dùng không giao dịch margin", { status: "pending", via: "model" })
  await setup.mockInput.typeText("/memory")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("chờ duyệt"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("a duyệt"))
  setup.mockInput.pressKey("a")
  await setup.waitFor(async () => (await memory.list())[0]?.status === "active")
  await setup.waitForFrame((f) => f.includes("đang dùng"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/config turns memory off and on without a restart", async () => {
  expect(runtime.memory.id).toBe("file")
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("Memory"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => runtime.memory.id === "none")
  expect(runtime.registry.get("propose_memory")).toBeUndefined()
  expect((await Bun.file(path.join(home, "config.json")).json()).memory).toEqual({ provider: "none" })
  setup.mockInput.pressEnter()
  await setup.waitFor(() => runtime.memory.id === "file")
  expect(runtime.registry.get("propose_memory")).toBeDefined()
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/config: the auto-compaction threshold is a preset % and an optional token cap, applied live", async () => {
  const configJson = async () => Bun.file(path.join(home, "config.json")).json()
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  let frame = await setup.waitForFrame((f) => f.includes("Ngưỡng tự nén") && f.includes("hết cửa sổ của model"))
  show(frame)
  await setup.mockInput.typeText("nguong")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("95% (mặc định)") && f.includes("Trần theo token…"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("90% · hết cửa sổ của model"))
  expect(state.compactPercent).toBe(90)
  expect((await configJson()).autoCompactPercent).toBe(90)

  await setup.mockInput.typeText("nguong")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Trần theo token…"))
  await setup.mockInput.typeText("tran theo")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Trần cửa sổ context") && f.includes("250K token"))
  await setup.mockInput.typeText("1000")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Nhập số token từ 20.000 trở lên"))
  for (let i = 0; i < 4; i++) setup.mockInput.pressBackspace()
  await setup.mockInput.typeText("200.000")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("90% · trần 200k token"))
  expect(state.compactCap).toBe(200_000)
  expect((await configJson()).compactWindow).toBe(200_000)

  // "Bỏ trần token" appears once a cap is set and goes back to the model's whole window.
  await setup.mockInput.typeText("nguong")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Bỏ trần token"))
  await setup.mockInput.typeText("bo tran")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("90% · hết cửa sổ của model"))
  expect(state.compactCap).toBeUndefined()
  expect((await configJson()).compactWindow).toBeUndefined()
  await saveConfig({ autoCompactPercent: undefined })
  setState("compactPercent", 95)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/config: subagent limit is a number ≥ 1 applied live; subagent model lists tool-capable models and can go back to the session's", async () => {
  await setup.mockInput.typeText("/config")
  setup.mockInput.pressEnter()
  let frame = await setup.waitForFrame((f) => f.includes("Subagent chạy song song") && f.includes("Model cho subagent"))
  show(frame)
  expect(frame).toContain("10 cùng lúc")
  await setup.mockInput.typeText("song song")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Số subagent chạy cùng lúc"))
  await setup.mockInput.typeText("0")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Nhập một số nguyên từ 1 trở lên."))
  setup.mockInput.pressBackspace()
  await setup.mockInput.typeText("3")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("3 cùng lúc"))
  expect((await Bun.file(path.join(home, "config.json")).json()).subagents).toEqual({ maxConcurrent: 3 })
  expect(runtime.subagents.limiter.stats().max).toBe(3)

  await setup.mockInput.typeText("model cho subagent")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Theo model của phiên (mặc định)") && f.includes("Tự động (chọn model lite rẻ)"))
  show(frame)
  // Row 2 is "auto": the harness picks a lite model per run.
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  // Wait for the list to show the choice, then read the file once (reading while it is
  // being replaced is what Windows refuses).
  await setup.waitForFrame((f) => f.includes("Cài đặt") && /Model cho subagent\s+Tự động/.test(f))
  expect((await Bun.file(path.join(home, "config.json")).json()).subagents).toEqual({ maxConcurrent: 3, model: "auto" })
  // Row 3 onward are the tool-capable models of connected providers (groq, connected by the
  // /connect test above); picking one replaces "auto".
  await setup.mockInput.typeText("model cho subagent")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Theo model của phiên (mặc định)") && f.includes("● Tự động"))
  show(frame)
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("Model cho subagent") && !f.includes("Theo model của phiên · enter") && !/Model cho subagent\s+Tự động/.test(f))
  const saved = (await Bun.file(path.join(home, "config.json")).json()).subagents
  expect(saved.maxConcurrent).toBe(3)
  expect(saved.model).not.toBe("auto")
  expect(state.catalog[saved.provider]?.models[saved.model]).toBeDefined()
  expect(state.catalog[saved.provider]?.models[saved.model]?.tool_call).not.toBe(false)
  await setup.waitForFrame((f) => f.includes("Cài đặt"))
  await setup.mockInput.typeText("model cho subagent")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Theo model của phiên (mặc định)"))
  setup.mockInput.pressEnter()
  // Back on the settings list (the sub-view closes after saving) before Esc closes the dialog.
  await setup.waitForFrame((f) => f.includes("Cài đặt") && f.includes("Theo model của phiên · enter"))
  expect((await Bun.file(path.join(home, "config.json")).json()).subagents?.model).toBeUndefined()
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  await saveConfig({ subagents: undefined })
  runtime.subagents.setMax(10)
})

test("todo_write: the open list is pinned above the prompt, the transcript keeps one line, /new clears it", async () => {
  await setKey("nvidia", "nvapi-good-key")
  await setup.mockInput.typeText("VIỆC-CẦN-LÀM cho FPT")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => !state.streaming && state.lines.some((l) => l.kind === "tool" && l.name === "todo_write" && l.status === "ok"))
  const frame = await setup.waitForFrame((f) => f.includes("Việc cần làm · 1/3") && f.includes("● Cập nhật việc cần làm (1/3 xong)"))
  show(frame)
  expect(frame).toContain("● Cập nhật việc cần làm (1/3 xong)")
  expect(frame).toContain("[>] Lấy BCTC 4 quý")
  expect(frame).toContain("[ ] So sánh với ngành")
  // The list is in the panel, not repeated under the tool row.
  expect(frame.split("Lấy BCTC 4 quý").length - 1).toBe(1)
  // The panel sits between the transcript and the prompt.
  const rows = frame.split("\n")
  const panel = rows.findIndex((r) => r.includes("Việc cần làm · 1/3"))
  const prompt = rows.findIndex((r) => r.includes("› "))
  expect(panel).toBeGreaterThan(rows.findIndex((r) => r.includes("❯ VIỆC-CẦN-LÀM")))
  expect(prompt).toBeGreaterThan(panel)
  await setup.waitFor(() => !state.streaming)
  expect(state.liveTodos).toBeUndefined() // back to history once the turn is saved

  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  const cleared = await setup.waitForFrame((f) => !f.includes("Việc cần làm"))
  expect(cleared).not.toContain("[>]")
})

test("status bar always shows the context used; near the threshold, the room left before auto-compaction", async () => {
  const saved = { provider: state.provider, model: state.model, contextTokens: state.contextTokens, autoCompactOff: state.autoCompactOff, compactFailures: state.compactFailures }
  const bar = (f: string) => f.split("\n").find((r) => r.includes("▲ OpenTrading")) ?? ""
  try {
    // 131072-token window, no output limit: reserve 20k, threshold 95% of the rest = 105518.
    setState({ provider: "groq", model: "test-model", contextTokens: undefined })
    let frame = await setup.waitForFrame((f) => bar(f).includes("ctx –/131k"))
    setState("contextTokens", 65_536)
    frame = await setup.waitForFrame((f) => bar(f).includes("ctx 50% · 65,5k/131k"))
    expect(bar(frame)).not.toContain("tới tự nén")
    setState("contextTokens", 94_966) // 10% of the threshold left
    frame = await setup.waitForFrame((f) => bar(f).includes("ctx 72% · 95k/131k · còn 10% tới tự nén"))
    show(frame)
    setState({ autoCompactOff: true, contextTokens: 117_965 }) // 90%, nothing compacts by itself
    frame = await setup.waitForFrame((f) => bar(f).includes("ctx 90% · 118k/131k · /compact"))
    // Auto-compaction given up after repeated failures: the same pointer, never "còn 0% tới tự nén".
    setState({ autoCompactOff: false, compactFailures: 3, contextTokens: 100_000 })
    frame = await setup.waitForFrame((f) => bar(f).includes("ctx 76% · 100k/131k · /compact"))
    expect(bar(frame)).not.toContain("tới tự nén")
    // A cap (compactWindow) is the window shown.
    setState({ compactFailures: 0, compactCap: 50_000, contextTokens: 10_000 })
    frame = await setup.waitForFrame((f) => bar(f).includes("ctx 20% · 10k/50k"))
  } finally {
    setState({ ...saved, compactCap: undefined })
  }
})

test("/compact summarizes the start of the conversation, keeps the last turns, and shows one line (ctrl+o: the summary)", async () => {
  await setKey("nvidia", "nvapi-good-key")
  for (const text of ["câu một", "câu hai", "câu ba"]) {
    await setup.mockInput.typeText(text)
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.lines.some((l) => l.kind === "user" && l.text === text))
    await waitMcp(() => !state.streaming)
  }
  const turns = state.history.filter((m) => m.role === "user").length
  expect(turns).toBeGreaterThanOrEqual(3)
  await setup.mockInput.typeText("/compact giữ số liệu")
  setup.mockInput.pressEnter()
  await waitMcp(() => state.lines.some((l) => l.kind === "compact"))
  await waitMcp(() => !state.streaming)
  const frame = await setup.waitForFrame((f) => f.includes("Đã nén hội thoại") && f.includes("ctrl+o xem tóm tắt"))
  show(frame)
  expect(frame).not.toContain("TÓM-TẮT-GIẢ") // collapsed
  // History: marker, summary, then the last two turns verbatim.
  expect(JSON.stringify(state.history[0])).toContain("tom_tat_hoi_thoai")
  expect(state.history[1]).toMatchObject({ role: "assistant" })
  expect(state.history.filter((m) => m.role === "user")).toHaveLength(3)
  expect(state.clock).toBeUndefined() // re-sent on the next turn
  expect(state.contextTokens).toBeGreaterThan(0)

  setState("expandTools", true)
  try {
    const open = await setup.waitForFrame((f) => f.includes("TÓM-TẮT-GIẢ"))
    show(open)
  } finally {
    setState("expandTools", false)
  }
})

test("/compact is refused while an answer is streaming", async () => {
  setState("streaming", true)
  try {
    await setup.mockInput.typeText("/compact")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("Đang trả lời; chờ xong rồi nén."))
  } finally {
    setState("streaming", false)
  }
})

test("near the window, sending a message compacts first, then answers on the compacted history", async () => {
  const saved = { provider: state.provider, model: state.model }
  await setKey("groq", "gsk-good-key")
  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.history.length === 0)
  setState({ provider: "groq", model: "test-model" }) // 131072-token window
  try {
    for (const text of ["lượt một", "lượt hai", "lượt ba"]) {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      await setup.waitFor(() => state.lines.some((l) => l.kind === "user" && l.text === text))
      await waitMcp(() => !state.streaming)
    }
    setState("contextTokens", Math.round(131_072 * 0.9))
    await setup.mockInput.typeText("lượt bốn")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.lines.some((l) => l.kind === "user" && l.text === "lượt bốn") && !state.streaming)
    const kinds = state.lines.map((l) => l.kind)
    // The compaction comes before the new question, then the answer.
    expect(kinds.lastIndexOf("compact")).toBeLessThan(state.lines.findIndex((l) => l.kind === "user" && l.text === "lượt bốn"))
    expect(state.lines.some((l) => l.kind === "info" && l.text.includes("Context gần đầy"))).toBe(true)
    expect(JSON.stringify(state.history[0])).toContain("tom_tat_hoi_thoai")
    expect(state.history.filter((m) => m.role === "user").map((m) => JSON.stringify(m.content))).toHaveLength(4) // marker + 2 kept + new
    expect(JSON.stringify(state.history.at(-2))).toContain("lượt bốn")
    // The turn's own usage replaced the pre-compaction size.
    expect(state.contextTokens!).toBeLessThan(131_072 * 0.8)
    const frame = await setup.waitForFrame((f) => f.includes("Đã nén hội thoại"))
    show(frame)
  } finally {
    setState(saved)
  }
})

// ── Prompt input: wrapping, selection, history, Esc-Esc, Ctrl+R, Ctrl+S ─────────────────────

/** The prompt's text rows: the "› " row and the wrapped rows under it, up to the bottom border. */
function promptRows(frame: string) {
  const rows = frame.split("\n")
  const start = rows.findLastIndex((r) => r.includes("› "))
  if (start < 0) return []
  const out: string[] = []
  for (let i = start; i < rows.length && !rows[i]!.includes("──"); i++) out.push(rows[i]!.slice(0, 96).slice(rows[start]!.indexOf("› ") + 2).trimEnd())
  return out
}

/** The prompt's text once rendering has settled (a late second insertion would show by then). */
async function settledPrompt() {
  await new Promise((r) => setTimeout(r, 60))
  await setup.renderOnce()
  return promptRows(setup.captureCharFrame()).join("").trim()
}

/** Esc twice clears the prompt (the first press only warns). */
async function clearPrompt() {
  resetNotifications() // a warning left by the previous test must not count
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Esc lần nữa để xoá ô nhập"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
}

test("prompt: ? on an empty prompt shows the keys; a letter closes it and is typed; ? inside text is text", async () => {
  await setup.waitForFrame((f) => f.includes("? phím tắt · / lệnh"))
  await setup.mockInput.typeText("?")
  let frame = await setup.waitForFrame((f) => f.includes("Phím tắt") && f.includes("Khi agent làm"))
  show(frame)
  expect(frame).toContain("quản lý subagent")
  expect(state.dialog).toBe("shortcuts")
  await setup.mockInput.typeText("a")
  await setup.waitFor(() => state.dialog === undefined)
  // Exactly once: the pane hands the letter over and the textarea must not type it again.
  expect(await settledPrompt()).toBe("a")
  await setup.mockInput.typeText("?")
  expect(await settledPrompt()).toBe("a?")
  expect(state.dialog).toBeUndefined()
  await clearPrompt()
})

test("prompt: long text wraps onto new lines and the box grows instead of scrolling sideways", async () => {
  const words = Array.from({ length: 30 }, (_, i) => `tu${i}`).join(" ")
  await setup.mockInput.typeText(words)
  const frame = await setup.waitForFrame((f) => promptRows(f).join(" ").includes("tu29"))
  show(frame)
  const rows = promptRows(frame)
  expect(rows.length).toBeGreaterThanOrEqual(2)
  expect(rows[0]).toContain("tu0 tu1") // the start is still visible: no horizontal scroll
  expect(rows.join(" ").replace(/\s+/g, " ").trim()).toBe(words)
  await clearPrompt()
})

test("prompt: Shift+← highlights, Backspace deletes the highlight; typing replaces it", async () => {
  await setup.mockInput.typeText("xin chao ban")
  await setup.waitForFrame((f) => f.includes("› xin chao ban"))
  for (let i = 0; i < 3; i++) setup.mockInput.pressArrow("left", { shift: true })
  setup.mockInput.pressBackspace()
  let frame = await setup.waitForFrame((f) => promptRows(f)[0] === "xin chao")
  for (let i = 0; i < 5; i++) setup.mockInput.pressArrow("left", { shift: true }) // "chao "
  await setup.mockInput.typeText("X")
  frame = await setup.waitForFrame((f) => promptRows(f)[0] === "xin X")
  show(frame)
  await clearPrompt()
})

test("prompt: dragging over the prompt copies and keeps the highlight, so typing replaces it", async () => {
  await setup.mockInput.typeText("xoa phan nay")
  const frame = await setup.waitForFrame((f) => f.includes("› xoa phan nay"))
  const rows = frame.split("\n")
  const y = rows.findLastIndex((r) => r.includes("› xoa phan nay"))
  const x = rows[y]!.indexOf("xoa phan nay")
  const copiesBefore = osc52.length
  await setup.mockMouse.drag(x, y, x + "xoa phan nay".length, y)
  await setup.waitFor(() => osc52.length > copiesBefore)
  expect(osc52.at(-1)).toBe("xoa phan nay")
  await setup.mockInput.typeText("Z")
  await setup.waitForFrame((f) => promptRows(f)[0] === "Z")
  await clearPrompt()
})

test("prompt: Ctrl+J and \ + Enter add a line; Enter alone sends", async () => {
  await setup.mockInput.typeText("dong1")
  setup.mockInput.pressKey("LINEFEED")
  await setup.mockInput.typeText("dong2")
  // Shift+Enter only differs from Enter with the kitty keyboard protocol (not in this mock).
  setup.mockInput.pressKey("LINEFEED")
  await setup.mockInput.typeText("dong3\\")
  setup.mockInput.pressEnter()
  await setup.mockInput.typeText("dong4")
  const frame = await setup.waitForFrame((f) => promptRows(f).includes("dong4"))
  show(frame)
  expect(promptRows(frame)).toEqual(["dong1", "dong2", "dong3", "dong4"])
  await clearPrompt()
})

test("prompt: a pasted CR or CRLF (Windows Terminal) becomes a line break", async () => {
  await setup.mockInput.pasteBracketedText("a\r\nb\rc")
  const frame = await setup.waitForFrame((f) => promptRows(f).includes("c"))
  expect(promptRows(frame)).toEqual(["a", "b", "c"])
  await clearPrompt()
  const { normalizePaste } = await import("../src/tui/prompt/input")
  expect(normalizePaste("a\r\nb\rc\td\x1b[31m!")).toBe("a\nb\nc    d!")
})

test("prompt: with the kitty keyboard protocol, Ctrl+J and Shift+Enter add a line", async () => {
  const { createMockKeys } = await import("@opentui/core/testing")
  const kitty = createMockKeys(setup.renderer, { kittyKeyboard: true })
  await setup.mockInput.typeText("k1")
  kitty.pressKey("j", { ctrl: true })
  await setup.mockInput.typeText("k2")
  kitty.pressEnter({ shift: true })
  await setup.mockInput.typeText("k3")
  const frame = await setup.waitForFrame((f) => promptRows(f).includes("k3"))
  expect(promptRows(frame)).toEqual(["k1", "k2", "k3"])
  await clearPrompt()
})

test("prompt: ↑/↓ recall earlier prompts and slash commands, and give the draft back", async () => {
  await setup.mockInput.typeText("/help")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.dialog === "help")
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)

  // A two-line draft: the first ↑ only moves to line one.
  await setup.mockInput.typeText("nhap 1")
  setup.mockInput.pressKey("LINEFEED")
  await setup.mockInput.typeText("nhap 2")
  await setup.waitForFrame((f) => promptRows(f).includes("nhap 2"))
  setup.mockInput.pressArrow("up")
  await Bun.sleep(30)
  let frame = await setup.waitForFrame((f) => promptRows(f).includes("nhap 2"))
  expect(promptRows(frame)).toEqual(["nhap 1", "nhap 2"])
  // At the top line, ↑ brings back the last command — without opening the "/" list.
  let up = 0
  while (!promptRows(frame).includes("/help") && up++ < 3) {
    setup.mockInput.pressArrow("up")
    await Bun.sleep(30)
    frame = await setup.waitForFrame(() => true)
  }
  frame = await setup.waitForFrame((f) => promptRows(f)[0] === "/help")
  expect(frame).not.toContain("enter chạy · tab điền")
  // ↓ past the newest entry gives the draft back.
  setup.mockInput.pressArrow("down")
  frame = await setup.waitForFrame((f) => promptRows(f).includes("nhap 2"))
  expect(promptRows(frame)).toEqual(["nhap 1", "nhap 2"])
  // ↑ ↑ (line one, then /help) and ↑ once more goes further back: the list did not swallow it.
  setup.mockInput.pressArrow("up")
  await Bun.sleep(30)
  setup.mockInput.pressArrow("up")
  await setup.waitForFrame((f) => promptRows(f)[0] === "/help")
  setup.mockInput.pressArrow("up")
  frame = await setup.waitForFrame((f) => promptRows(f)[0] !== "/help")
  show(frame)
  expect(frame).not.toContain("enter chạy · tab điền")
  await clearPrompt()

  // The file is in OPENTRADING_HOME, slash commands included.
  const { historyFile, historyFlushed } = await import("../src/tui/prompt/history")
  await historyFlushed()
  const lines = (await Bun.file(historyFile()).text()).trim().split("\n").map((l) => JSON.parse(l).text)
  expect(lines).toContain("/help")
  // A draft cleared with Esc Esc is remembered too (dong1…dong4 from the newline test).
  expect(lines).toContain("dong1\ndong2\ndong3\ndong4")
})

test("prompt: Ctrl+R searches the history; Esc keeps the match to edit", async () => {
  setup.mockInput.pressKey("r", { ctrl: true })
  await setup.waitForFrame((f) => f.includes("tìm trong lịch sử:"))
  await setup.mockInput.typeText("hel")
  let frame = await setup.waitForFrame((f) => f.includes("tìm trong lịch sử: hel") && promptRows(f)[0] === "/help")
  show(frame)
  await setup.mockInput.typeText("zzz")
  await setup.waitForFrame((f) => f.includes("không thấy prompt nào khớp: helzzz"))
  for (let i = 0; i < 3; i++) setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => f.includes("tìm trong lịch sử: hel"))
  setup.mockInput.pressEscape()
  frame = await setup.waitForFrame((f) => !f.includes("tìm trong lịch sử"))
  expect(promptRows(frame)[0]).toBe("/help")
  expect(state.dialog).toBeUndefined()
  await clearPrompt()

  // Ctrl+C cancels and gives the draft back.
  const exitsBefore = exits
  await setup.mockInput.typeText("ban nhap")
  setup.mockInput.pressKey("r", { ctrl: true })
  await setup.mockInput.typeText("hel")
  await setup.waitForFrame((f) => promptRows(f)[0] === "/help")
  setup.mockInput.pressCtrlC()
  frame = await setup.waitForFrame((f) => promptRows(f)[0] === "ban nhap" && !f.includes("tìm trong lịch sử"))
  expect(exits).toBe(exitsBefore)
  expect(state.exitArmed).toBeUndefined() // the Ctrl+C only cancelled the search
  await clearPrompt()
})

test("prompt: Ctrl+S puts the draft aside and brings it back", async () => {
  await setup.mockInput.typeText("de sau")
  await setup.waitForFrame((f) => f.includes("› de sau"))
  setup.mockInput.pressKey("s", { ctrl: true })
  await setup.waitForFrame((f) => f.includes("Đã cất bản nháp") && f.includes("Hỏi về thị trường"))
  setup.mockInput.pressKey("s", { ctrl: true })
  await setup.waitForFrame((f) => f.includes("› de sau"))
  await clearPrompt()
})

// ── Prompt input: pasted-text pills and images ───────────────────────────────────────────────

/** The user message of the newest chat request, as JSON. */
const lastUserContent = () => {
  const messages = chatBodies.at(-1)?.messages ?? []
  return JSON.stringify(messages.filter((m) => m.role === "user").at(-1)?.content ?? "")
}

/** Send what is in the prompt with groq/<model> and wait for the answer to finish. */
async function sendWith(model: string, expectUser: string) {
  await setKey("groq", "gsk-good-key")
  // The turn reads the model from the config file; the status bar from the store.
  await saveConfig({ provider: "groq", model })
  setState({ provider: "groq", model })
  const before = chatBodies.length
  setup.mockInput.pressEnter()
  await waitMcp(() => chatBodies.length > before && !state.streaming && state.lines.some((l) => l.kind === "user" && l.text.includes(expectUser)))
}

test("@: the list offers workspace files; tab opens a folder, enter makes a pill; the model gets the file read", async () => {
  await mkdir(path.join(cwd, "bao-cao"), { recursive: true })
  await writeFile(path.join(cwd, "bao-cao", "quy3.md"), "NỘI-DUNG-QUÝ-3\n")
  await setup.mockInput.typeText("tóm tắt @bao")
  let frame = await setup.waitForFrame((f) => f.includes("@bao-cao/") && f.includes("enter gắn file"))
  show(frame)
  expect(frame).toContain("thư mục")
  setup.mockInput.pressTab()
  frame = await setup.waitForFrame((f) => f.includes("@bao-cao/quy3.md") && f.includes("› tóm tắt @bao-cao/"))
  setup.mockInput.pressEnter()
  // Enter picked the file (nothing was sent): the list closes, the pill is in the prompt.
  frame = await setup.waitForFrame((f) => f.includes("› tóm tắt @bao-cao/quy3.md") && !f.includes("enter gắn file"))
  const { RGBA } = await import("@opentui/core")
  const { color } = await import("../src/tui/theme")
  const pill = setup
    .captureSpans()
    .lines.flatMap((l) => l.spans)
    .filter((s) => s.text.includes("@bao-cao/quy3.md"))
  expect(pill.some((s) => s.fg.equals(RGBA.fromHex(color.san)))).toBe(true)
  await setup.mockInput.typeText("giúp")
  await sendWith("test-model", "tóm tắt @bao-cao/quy3.md")
  // What the model got: the typed text, then the file as read_file reads it.
  const content = lastUserContent()
  expect(content).toContain("tóm tắt @bao-cao/quy3.md giúp")
  expect(content).toContain("<tep_dinh_kem path=\\\"bao-cao/quy3.md\\\"")
  expect(content).toContain("NỘI-DUNG-QUÝ-3")
  // The transcript shows the message as typed and one line for the file, never its content.
  frame = await setup.waitForFrame((f) => f.includes("⎿  Đã đọc bao-cao/quy3.md (1 dòng)"))
  show(frame)
  expect(frame).not.toContain("NỘI-DUNG-QUÝ-3")
})

test("@: one Backspace deletes a file pill; Esc closes the list until the draft changes", async () => {
  // Made after the list was last built: a query that matches nothing looks again (within 1s).
  await writeFile(path.join(cwd, "ghi-chu-tui.md"), "x\n")
  await setup.mockInput.typeText("@ghi-chu-t")
  // About 4s of frames: the second look waits for the index to be 1s old.
  await setup.waitForFrame((f) => f.includes("@ghi-chu-tui.md") && f.includes("enter gắn file"), { maxPasses: 120 })
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => !f.includes("enter gắn file"))
  await setup.mockInput.typeText("u")
  await setup.waitForFrame((f) => f.includes("enter gắn file"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("› @ghi-chu-tui.md") && !f.includes("enter gắn file"))
  // Pill + a space: Backspace removes the space, then the whole pill.
  setup.mockInput.pressBackspace()
  setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
})

test("prompt: a long paste becomes one pill; one Backspace deletes it; sending puts the text back in place", async () => {
  const pasted = Array.from({ length: 50 }, (_, i) => `dòng-dán-${i + 1}`).join("\n")
  await setup.mockInput.pasteBracketedText(pasted)
  let frame = await setup.waitForFrame((f) => /\[Pasted text #\d+ \+49 lines\]/.test(f))
  show(frame)
  expect(frame).not.toContain("dòng-dán-2")
  // Drawn as a yellow chip (opencode's paste pill).
  const { RGBA } = await import("@opentui/core")
  const { color } = await import("../src/tui/theme")
  const pill = setup
    .captureSpans()
    .lines.flatMap((l) => l.spans)
    .filter((s) => s.text.includes("Pasted text"))
  expect(pill.some((s) => s.bg.equals(RGBA.fromHex(color.tham)))).toBe(true)
  // Pill + a space: Backspace removes the space, then the whole pill at once.
  setup.mockInput.pressBackspace()
  setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))

  // Vietnamese and a line break before the pill: the offsets are not string indices.
  await setup.mockInput.typeText("Phân tích")
  setup.mockInput.pressKey("LINEFEED")
  await setup.mockInput.typeText("dữ liệu: ")
  await setup.mockInput.pasteBracketedText(pasted)
  await setup.mockInput.typeText("xong")
  frame = await setup.waitForFrame((f) => /\[Pasted text #\d+ \+49 lines\] xong/.test(f))
  show(frame)
  await sendWith("test-model", "dữ liệu: [Pasted text #")
  // The transcript keeps the pill; the model gets the full text where the pill was.
  expect(lastUserContent()).toContain(JSON.stringify(`Phân tích\ndữ liệu: ${pasted} xong`).slice(1, -1))
  frame = await setup.waitForFrame((f) => /❯ Phân tích/.test(f))
  expect(frame).not.toContain("dòng-dán-50")
  expect(frame).toMatch(/dữ liệu: \[Pasted text #\d+ \+49 lines\] xong/) // shown as typed, not as a link

  // ↑ brings the prompt back with its pill, and it still expands.
  setup.mockInput.pressArrow("up")
  frame = await setup.waitForFrame((f) => /› Phân tích/.test(f) && /\[Pasted text #\d+ \+49 lines\] xong/.test(f))
  const { historyFlushed, historyFile } = await import("../src/tui/prompt/history")
  await historyFlushed()
  const last = JSON.parse((await Bun.file(historyFile()).text()).trim().split("\n").at(-1)!)
  expect(Object.values(last.pastes)).toEqual([pasted])
  await clearPrompt()
})

test("prompt: pasting over a highlight replaces it with the pill, which still expands", async () => {
  const pasted = Array.from({ length: 10 }, (_, i) => `hàng-${i}`).join("\n")
  await setup.mockInput.typeText("xem XOÁ-ĐI")
  for (let i = 0; i < "XOÁ-ĐI".length; i++) setup.mockInput.pressArrow("left", { shift: true })
  await setup.mockInput.pasteBracketedText(pasted)
  await setup.waitForFrame((f) => /› xem \[Pasted text #\d+ \+9 lines\]/.test(f))
  await sendWith("test-model", "xem [Pasted text #")
  expect(lastUserContent()).toContain(JSON.stringify(`xem ${pasted}`).slice(1, -1))
  expect(lastUserContent()).not.toContain("XOÁ-ĐI")
})

test("prompt: Alt+V pastes a clipboard image as [Image #N]; blocked for a text-only model, sent to a vision model", async () => {
  const { setImageReader } = await import("../src/tui/prompt/image")
  const png = "iVBORw0KGgo" + "A".repeat(200)
  let reads = 0
  setImageReader({
    clipboard: async () => {
      reads++
      return { data: png, mediaType: "image/png" }
    },
  })
  try {
    await setup.mockInput.typeText("Biểu đồ này nói gì? ")
    setup.mockInput.pressKey("v", { meta: true })
    let frame = await setup.waitForFrame((f) => /\[Image #\d+\]/.test(f))
    show(frame)
    // An empty paste (Windows Terminal with only an image copied) reads the clipboard too.
    await setup.mockInput.pasteBracketedText("")
    await waitMcp(() => reads === 2)
    frame = await setup.waitForFrame((f) => (f.match(/\[Image #\d+\]/g) ?? []).length === 2)
    // One image is enough: delete the second pill (space, then pill).
    setup.mockInput.pressBackspace()
    setup.mockInput.pressBackspace()
    frame = await setup.waitForFrame((f) => (f.match(/\[Image #\d+\]/g) ?? []).length === 1)

    // A model without vision: refused, the draft stays.
    await setKey("groq", "gsk-good-key")
    setState({ provider: "groq", model: "test-model" })
    const before = chatBodies.length
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes("không đọc được ảnh"))
    expect(chatBodies.length).toBe(before)
    expect(frame).toMatch(/› Biểu đồ này nói gì\? \[Image #\d+\]/)

    // A vision model gets the image after the text.
    await sendWith("vision-model", "Biểu đồ này nói gì?")
    const content = JSON.parse(lastUserContent()) as { type: string; text?: string; image_url?: { url: string } }[]
    expect(content.filter((p) => p.type === "image_url")).toHaveLength(1)
    expect(content.find((p) => p.type === "image_url")!.image_url!.url).toBe(`data:image/png;base64,${png}`)
    expect(content.find((p) => p.type === "text" && p.text?.startsWith("Biểu đồ"))?.text).toMatch(/\[Image #\d+\]/)

    // Back on the text-only model, the image in history becomes a placeholder.
    await setup.mockInput.typeText("còn gì nữa?")
    await sendWith("test-model", "còn gì nữa?")
    const all = JSON.stringify(chatBodies.at(-1)!.messages)
    expect(all).not.toContain(png)
    expect(all).toContain("không xem được ảnh")
  } finally {
    setImageReader(undefined)
  }
})

test("prompt: no image in the clipboard is reported, nothing is inserted", async () => {
  const { setImageReader } = await import("../src/tui/prompt/image")
  setImageReader({ clipboard: async () => undefined })
  try {
    setup.mockInput.pressKey("v", { meta: true })
    const frame = await setup.waitForFrame((f) => f.includes("Không có ảnh trong clipboard"))
    expect(frame).toContain("Hỏi về thị trường")
  } finally {
    setImageReader(undefined)
  }
})

// ── Prompt input: messages queued while answering, Ctrl+G editor ─────────────────────────────

/** A tool that waits until released keeps the turn streaming. */
async function slowTool() {
  const { z } = await import("zod")
  const gate = { release: () => {} }
  runtime.registry.register({
    name: "cho_lau",
    description: "Đợi (tool thử)",
    input: z.object({}),
    readOnly: true,
    execute: (_input, ctx) =>
      new Promise((resolve, reject) => {
        gate.release = () => resolve("xong")
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      }),
  })
  callSlowTool = true
  return gate
}

test("prompt: a message sent while answering waits, shows above the prompt, then goes next", async () => {
  await setKey("groq", "gsk-good-key")
  await saveConfig({ provider: "groq", model: "test-model" })
  setState({ provider: "groq", model: "test-model" })
  const gate = await slowTool()
  try {
    await setup.mockInput.typeText("CHẬM xếp hàng")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.lines.some((l) => l.kind === "tool" && l.label.includes("cho_lau") && l.status === "running"))
    await setup.mockInput.typeText("câu hỏi tiếp theo")
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((f) => f.includes("(chờ) câu hỏi tiếp theo"))
    show(frame)
    expect(state.queue).toHaveLength(1)
    expect(state.lines.some((l) => l.kind === "user" && l.text === "câu hỏi tiếp theo")).toBe(false)
    callSlowTool = false
    gate.release()
    // The first answer ends, then the queued message is sent and answered.
    await waitMcp(() => state.queue.length === 0 && !state.streaming && state.lines.some((l) => l.kind === "user" && l.text === "câu hỏi tiếp theo"))
    expect(lastUserContent()).toContain("câu hỏi tiếp theo")
  } finally {
    callSlowTool = false
    runtime.registry.unregister("cho_lau")
  }
}, 30_000)

test("prompt: after Esc stops the answer, queued messages come back to the prompt; ↑ also takes them back", async () => {
  const gate = await slowTool()
  try {
    await setup.mockInput.typeText("CHẬM dừng")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.lines.some((l) => l.kind === "tool" && l.label.includes("cho_lau") && l.status === "running" && state.streaming))
    await setup.mockInput.typeText("tin một")
    setup.mockInput.pressEnter()
    await setup.mockInput.typeText("tin hai")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.queue.length === 2)
    // ↑ on the empty prompt takes them back to edit; Enter queues them again as one.
    setup.mockInput.pressArrow("up")
    let frame = await setup.waitForFrame((f) => promptRows(f).join("|") === "tin một|tin hai")
    expect(state.queue).toHaveLength(0)
    setup.mockInput.pressEnter()
    await waitMcp(() => state.queue.length === 1)
    setup.mockInput.pressEscape()
    await waitMcp(() => !state.streaming && state.queue.length === 0)
    frame = await setup.waitForFrame((f) => promptRows(f).join("|") === "tin một|tin hai")
    show(frame)
    expect(state.lines.some((l) => l.kind === "user" && l.text.startsWith("tin một"))).toBe(false)
    gate.release()
    await clearPrompt()
  } finally {
    callSlowTool = false
    runtime.registry.unregister("cho_lau")
  }
}, 30_000)

test("prompt: Ctrl+G edits the prompt in $EDITOR; untouched pastes go back into their pill", async () => {
  // A stand-in editor: appends a line to the file it is given.
  const script = path.join(home, "fake-editor.ts")
  await writeFile(script, 'const f = process.argv[2]!; await Bun.write(f, (await Bun.file(f).text()) + "\\nthêm từ editor\\n")\n')
  const saved = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR }
  delete process.env.VISUAL
  process.env.EDITOR = `"${process.execPath}" "${script}"`
  try {
    const pasted = Array.from({ length: 5 }, (_, i) => `p${i}`).join("\n")
    await setup.mockInput.typeText("đầu ")
    await setup.mockInput.pasteBracketedText(pasted)
    await setup.waitForFrame((f) => /› đầu \[Pasted text #\d+ \+4 lines\]/.test(f))
    setup.mockInput.pressKey("g", { ctrl: true })
    const frame = await waitFrameMs((f) => promptRows(f).includes("thêm từ editor"))
    show(frame)
    expect(promptRows(frame)[0]).toMatch(/^đầu \[Pasted text #\d+ \+4 lines\]/)
    await sendWith("test-model", "thêm từ editor")
    expect(lastUserContent()).toContain(JSON.stringify(`đầu ${pasted} \nthêm từ editor`).slice(1, -1))
  } finally {
    process.env.EDITOR = saved.EDITOR
    if (saved.EDITOR === undefined) delete process.env.EDITOR
    if (saved.VISUAL !== undefined) process.env.VISUAL = saved.VISUAL
  }
}, 30_000)

/** Poll frames on the clock (an editor is a real process). */
async function waitFrameMs(pred: (frame: string) => boolean) {
  let frame = ""
  for (let i = 0; i < 100; i++) {
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    if (pred(frame)) return frame
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`frame never matched ${pred}:\n${frame}`)
}

test("prompt: a message typed during /compact is sent once the compaction ends", async () => {
  // Enough turns that /compact has something to summarize (the last two stay verbatim).
  for (const text of ["nén một", "nén hai", "nén ba"]) {
    await setup.mockInput.typeText(text)
    await sendWith("test-model", text)
  }
  let open = () => {}
  summaryGate = new Promise<void>((r) => (open = r))
  try {
    await setup.mockInput.typeText("/compact")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.compacting)
    await setup.mockInput.typeText("sau khi nén")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.queue.length === 1)
    open()
    await waitMcp(() => state.queue.length === 0 && !state.streaming && state.lines.some((l) => l.kind === "user" && l.text === "sau khi nén"))
    // In order: the compaction, then the queued message.
    const kinds = state.lines.map((l) => l.kind)
    expect(kinds.lastIndexOf("compact")).toBeLessThan(state.lines.findIndex((l) => l.kind === "user" && l.text === "sau khi nén"))
  } finally {
    open()
    summaryGate = undefined
  }
}, 30_000)

test("subagents: parallel spawns are one line in the transcript and one row each on the panel; over the limit one waits for a slot; ctrl+o shows the tree", async () => {
  await saveConfig({ ...(await readJson<object>(path.join(home, "config.json"), {})), subagents: { maxConcurrent: 1 } })
  runtime.subagents.setMax(1)
  let release!: () => void
  childGate = new Promise((r) => (release = r))
  try {
    await setup.mockInput.typeText("SUBAGENT-SONG-SONG")
    setup.mockInput.pressEnter()
    // Everything in one predicate: the rows arrive over a few frames.
    let frame = await setup.waitForFrame(
      (f) =>
        f.includes("Chạy 2 subagent… · ↓ để quản lý") &&
        f.includes("2 subagent · ↓ quản lý") &&
        /nghien-cuu\s+Định giá FPT/.test(f) &&
        /nghien-cuu\s+Định giá CMG.*chờ slot \(1\/1\)/.test(f),
    )
    show(frame)
    // The transcript keeps one line; under the prompt, main and one row per agent.
    expect(frame).not.toContain("├─")
    const rows = frame.split("\n")
    const below = rows.slice(rows.findIndex((r) => r.includes("› ")))
    expect(below.some((r) => r.includes("● main") || /^ {3}\S main/.test(r))).toBe(true)
    expect(below.some((r) => /nghien-cuu\s+Định giá FPT/.test(r))).toBe(true)
    expect(below.some((r) => /nghien-cuu\s+Định giá CMG.*chờ slot \(1\/1\)/.test(r))).toBe(true)
    expect(frame).toContain("2 subagent · ↓ quản lý")
    expect(frame).toContain("đang trả lời")
    release()
    await waitMcp(() => !state.streaming)
    frame = await setup.waitForFrame((f) => /2 subagent đã xong[\s\S]*HẾT-CÂU-TRẢ-LỜI/.test(f))
    show(frame)
    expect(frame).not.toContain("⎿ Xong (0 tool")
    setState("expandTools", true)
    frame = await setup.waitForFrame((f) => /├─ nghien-cuu \(Định giá FPT\)[^\n]*\n\s*│  ⎿ Xong \(0 tool · /.test(f))
    expect(frame).toMatch(/└─ nghien-cuu \(Định giá CMG\)[^\n]*\n\s*⎿ Xong \(0 tool · /)
    // The parent model got both reports with their trailers.
    const results = state.history.filter((m) => m.role === "tool").slice(-2)
    for (const r of results) expect(JSON.stringify(r.content)).toContain("BÁO-CÁO-CON")
    expect(JSON.stringify(results[0]!.content)).toContain("agent_id: ag-")

    frame = await setup.waitForFrame((f) => f.includes("Yêu cầu:") && f.includes("Kết quả:"))
    show(frame)
    expect(frame).toContain("BÁO-CÁO-CON: FPT ổn.")
    expect(frame).not.toContain("subagent_meta")
    // Sidechains sit next to the session and never show up as sessions themselves.
    const { listSessions } = await import("../src/core/session/store")
    const { currentSession } = await import("../src/tui/session")
    await runtime.subagents.flush()
    const side = await readdir(path.join(currentSession().dir, "subagents"))
    expect(side.filter((f) => f.endsWith(".jsonl"))).toHaveLength(2)
    expect((await listSessions()).every((x) => !x.file.includes("subagents"))).toBe(true)
  } finally {
    setState("expandTools", false)
    release?.()
    childGate = undefined
    await waitMcp(() => !state.streaming)
    runtime.subagents.setMax(10)
    await saveConfig({ subagents: undefined })
  }
}, 30_000)

test("subagents: a child's write tool asks in the main prompt, named after the subagent; the answer shows under its call", async () => {
  let wrote = 0
  runtime.registry.register({
    name: "ghi_tam",
    description: "ghi tạm một mã",
    input: z.object({ ma: z.string() }),
    readOnly: false,
    async execute() {
      wrote++
      return "đã ghi"
    },
  })
  try {
    await setup.mockInput.typeText("SUBAGENT-GHI")
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("Cho phép chạy?"))
    show(frame)
    expect(frame).toContain("subagent nghien-cuu (Ghi FPT)")
    expect(frame).toContain("nghien-cuu › ghi_tam")
    expect(frame).not.toContain("1-4 chọn nhanh")
    // A prompt that pops up mid-typing is not answered by accident: digits never answer a
    // subagent's prompt, and Enter right after it appears is ignored.
    setup.mockInput.pressEnter()
    await setup.mockInput.typeText("2")
    await new Promise((r) => setTimeout(r, 450))
    expect(state.approval).toBeDefined()
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.streaming)
    expect(wrote).toBe(1)
    setState("expandTools", true)
    frame = await setup.waitForFrame((f) => f.includes("✓ Đã cho phép lần này"))
    show(frame)
    expect(frame).toContain("● ghi_tam")
  } finally {
    setState("expandTools", false)
    runtime.registry.unregister("ghi_tam")
  }
}, 30_000)

test("/agents lists the subagent types by source; ctrl+r picks up a new file; enter shows the tools it resolves to", async () => {
  const dir = path.join(home, "agents")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "rieng-tui.md"), "---\nname: rieng-tui\ndescription: Loại riêng để thử\ntools: [current_time]\nmaxSteps: 3\n---\nCHỈ-DẪN-RIÊNG\n")
  await setup.mockInput.typeText("/agents")
  setup.mockInput.pressEnter()
  // Startup agent load races the rieng-tui.md creation above: open shows
  // 17 or 18. ctrl+r reloads deterministically (17 bundled + 1 user file).
  let frame = await setup.waitForFrame((f) => /Subagent · 1[78] loại/.test(f) && f.includes("Có sẵn"))
  setup.mockInput.pressKey("r", { ctrl: true })
  // NOTE: "Người dùng" group lives on page 2 now (18 items, 10 rows/page),
  // so it cannot be asserted in the same frame as the note — the rieng flow
  // below covers the user file end to end.
  frame = await setup.waitForFrame((f) => f.includes("Subagent · 18 loại") && f.includes("Đã nạp lại 18 loại"), { maxPasses: 60 })
  // Picker shows 10 rows per page so tra-cuu sits on page 2: its presence
  // is asserted on the spawn description (full list, no pagination).
  show(frame)
  expect(runtime.registry.get("spawn_subagent")!.description).toContain("- tra-cuu: Dùng khi cần tra cứu nhanh")
  expect(runtime.registry.get("spawn_subagent")!.description).toContain("- rieng-tui: Loại riêng để thử (Tool: current_time)")
  await setup.mockInput.typeText("rieng")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Subagent · rieng-tui") && f.includes("Tool hiện có (1): current_time"), { maxPasses: 60 })
  show(frame)
  expect(frame).toContain("CHỈ-DẪN-RIÊNG")
  expect(frame).toContain("tối đa 3 bước")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Subagent · 18 loại"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("background subagent: the answer ends at once; /tasks and the mode line show it running; when done its result is sent to the model on its own turn", async () => {
  let release!: () => void
  childGate = new Promise((r) => (release = r))
  try {
    await setup.mockInput.typeText("SUBAGENT-NEN")
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.streaming && state.history.some((m) => m.role === "tool" && JSON.stringify(m.content).includes("Đã chạy nền subagent")))
    let frame = await setup.waitForFrame((f) => f.includes("1 subagent · 1 nền · ↓ quản lý") && f.includes("nghien-cuu (Nền FPT) · chạy nền"))
    show(frame)
    const id = Object.values(state.agents).find((a) => a.background && a.status !== "completed")!.id

    await setup.mockInput.typeText("/tasks")
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes("Subagent của phiên") && f.includes("Đang chạy") && f.includes(id))
    show(frame)
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)

    const before = state.history.length
    release()
    frame = await setup.waitForFrame((f) => f.includes("◆ Subagent nền nghien-cuu (Nền FPT) · xong"))
    await waitMcp(() => !state.streaming && state.history.length > before + 1)
    frame = await setup.waitForFrame((f) => !f.includes("1 subagent · 1 nền") && f.includes("HẾT-CÂU-TRẢ-LỜI"))
    show(frame)
    const notice = state.history.slice(before).find((m) => m.role === "user")
    expect(JSON.stringify(notice?.content)).toContain("<thong_bao_subagent>")
    expect(JSON.stringify(notice?.content)).toContain("BÁO-CÁO-CON")
    expect(frame).not.toContain("❯ <thong_bao_subagent>")
    expect(state.notices).toEqual([])

    // As after a resume: nothing in memory, /tasks still lists it from its .meta.json.
    await runtime.subagents.flush()
    setState("agents", reconcile({}))
    await setup.mockInput.typeText("/tasks")
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes("Đã xong") && f.includes(id))
    show(frame)
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes(`Subagent ${id}`) && f.includes("Từ phiên trước"))
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => f.includes("Subagent của phiên"))
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    release?.()
    childGate = undefined
    await waitMcp(() => !state.streaming)
  }
}, 30_000)

test("subagent panel: between two model steps the row shows the last tool, not 'Đang khởi động…'", async () => {
  let release!: () => void
  childAfterTool = new Promise((r) => (release = r))
  try {
    await setup.mockInput.typeText("SUBAGENT-DOC")
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((f) => /nghien-cuu\s+Đọc FPT · current_time/.test(f))
    show(frame)
    expect(frame).not.toContain("Đang khởi động…")
  } finally {
    // Even when an assertion fails, so the next test does not start mid-turn.
    release()
    await waitMcp(() => !state.streaming)
    childAfterTool = undefined
  }
}, 30_000)

test("subagent panel: ↓ at the end of the prompt selects a row; enter opens it in /tasks; x twice stops it; typing goes back", async () => {
  // Agents of earlier tests that finished a moment ago would still linger on the panel.
  setState("agents", reconcile({}))
  let release!: () => void
  childGate = new Promise((r) => (release = r))
  try {
    await setup.mockInput.typeText("SUBAGENT-SONG-SONG")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => /nghien-cuu\s+Định giá FPT/.test(f) && /nghien-cuu\s+Định giá CMG/.test(f))

    // In a two-line draft ↓ first moves to the second line: not into the panel.
    await setup.mockInput.typeText("dòng một\\")
    setup.mockInput.pressEnter()
    await setup.mockInput.typeText("dòng hai")
    setup.mockInput.pressArrow("up")
    setup.mockInput.pressArrow("down")
    await new Promise((r) => setTimeout(r, 50))
    expect(state.panelFocus).toBeUndefined()
    // Esc would stop the running turn: empty the draft with Backspace.
    for (let i = 0; i < "dòng một\ndòng hai".length + 2; i++) setup.mockInput.pressBackspace()
    await setup.waitForFrame((f) => f.includes("đang trả lời… esc để dừng"))

    setup.mockInput.pressArrow("down")
    await setup.waitFor(() => state.panelFocus === 0)
    let frame = await setup.waitForFrame((f) => f.includes("↑↓ chọn · enter xem · x ×2 dừng · esc về ô nhập") && /❯ nghien-cuu\s+Định giá FPT/.test(f))
    show(frame)
    setup.mockInput.pressArrow("down")
    await setup.waitFor(() => state.panelFocus === 1)
    setup.mockInput.pressArrow("up")
    setup.mockInput.pressArrow("up")
    await setup.waitFor(() => state.panelFocus === undefined)

    // Enter: that agent in /tasks.
    setup.mockInput.pressArrow("down")
    await setup.waitFor(() => state.panelFocus === 0)
    const [first] = Object.values(state.agents).sort((a, b) => a.createdAt - b.createdAt)
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes(`Subagent ${first!.id}`) && f.includes("Định giá FPT"))
    // Esc: back to the list, then closed (two presses in one read would be one alt+escape).
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => f.includes("Subagent của phiên"))
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)

    // One x only asks (a word typed after a stray ↓ must not stop anything); another key
    // in between disarms it; x twice stops it.
    setup.mockInput.pressArrow("down")
    await setup.waitFor(() => state.panelFocus === 0)
    setup.mockInput.pressKey("x")
    await setup.waitFor(() => state.notification?.text.includes("Nhấn x lần nữa để dừng nghien-cuu (Định giá FPT)") === true)
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("up")
    setup.mockInput.pressKey("x")
    await new Promise((r) => setTimeout(r, 50))
    expect(state.notification?.text).toContain("Nhấn x lần nữa")
    setup.mockInput.pressKey("x")
    await setup.waitFor(() => state.notification?.text.includes("Đã dừng subagent nghien-cuu (Định giá FPT)") === true)
    setup.mockInput.pressKey("a")
    await setup.waitFor(() => state.panelFocus === undefined)
    // Exactly once: the panel hands the letter over and the textarea must not type it again.
    expect(await settledPrompt()).toBe("a")
    // The fake model holds the child until the gate opens; then the stop shows.
    release()
    await waitMcp(() => state.agents[first!.id]?.status === "stopped")
  } finally {
    release()
    childGate = undefined
    setState("panelFocus", undefined)
    await waitMcp(() => !state.streaming)
    for (let i = 0; i < 3; i++) setup.mockInput.pressBackspace()
  }
}, 30_000)

test("background subagent: /clear stops it and its result never reaches the new conversation", async () => {
  childGate = new Promise(() => {})
  try {
    await setup.mockInput.typeText("SUBAGENT-NEN")
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.streaming && Object.values(state.agents).some((a) => a.background && a.status !== "completed" && a.status !== "stopped"))
    const id = Object.values(state.agents).find((a) => a.background && (a.status === "running" || a.status === "queued"))!.id
    await setup.mockInput.typeText("/clear")
    setup.mockInput.pressEnter()
    await waitMcp(() => runtime.subagents.get(id)?.status === "stopped")
    await new Promise((r) => setTimeout(r, 50))
    expect(state.notices).toEqual([])
    expect(state.lines.some((l) => l.kind === "agent-notice")).toBe(false)
    expect(state.streaming).toBe(false)
    // The stopped run of the old session does not reappear in the new one (/tasks, /context).
    expect(Object.keys(state.agents)).toHaveLength(0)
  } finally {
    childGate = undefined
  }
}, 30_000)

test("/watchlist: edits by command, opens a list and shows live quotes from the MCP quote tool", async () => {
  const asked: string[][] = []
  runtime.registry.register({
    name: "mcp__fakewl__vn_equity_quote_batch",
    source: "mcp:fakewl",
    description: "quotes",
    input: z.object({ symbols: z.array(z.string()) }),
    readOnly: true,
    deferrable: true,
    execute: async (input) => {
      asked.push((input as { symbols: string[] }).symbols)
      return JSON.stringify({
        data: { quotes: [{ symbol: "VCB", close_price: 57300, percent_change: 1.2, volume_accumulated: 2_100_000 }, { symbol: "HPG", close_price: 26900, percent_change: -0.4 }] },
        provenance: { source: "vnstock", as_of: "2026-10-10T14:30:00+07:00" },
      })
    },
  })
  try {
    for (const command of ["/watchlist new dai-han", "/watchlist add dai-han vcb, hpg FPT"]) {
      await setup.mockInput.typeText(command)
      setup.mockInput.pressEnter()
    }
    await setup.waitForFrame((f) => f.includes('"DAI-HAN": FPT, HPG, VCB'))
    await setup.mockInput.typeText("/watchlist")
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("Watchlist cá nhân · 1") && f.includes("DAI-HAN"))
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes("Watchlist DAI-HAN · 3 mã") && f.includes("57.300") && f.includes("Không có giá: FPT"))
    show(frame)
    expect(frame).toContain("+1,2%")
    expect(frame).toContain("KL 2,1M")
    expect(frame).toContain("nguồn: vnstock")
    expect(asked).toEqual([["FPT", "HPG", "VCB"]])
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => f.includes("Watchlist cá nhân · 1"))
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    runtime.registry.unregister("mcp__fakewl__")
  }
})

// Last: its transcript (tool rows + the stock answer) would satisfy later tests' frame waits.
test("the third identical call asks before it runs; esc stops the loop and the turn answers", async () => {
  await setKey("nvidia", "nvapi-good-key")
  const before = state.lines.length
  await setup.mockInput.typeText("LẶP-LẠI giờ")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("cùng tham số 3 lần liên tiếp"))
  show(frame)
  expect(frame).toContain("Cho phép chạy?")
  setup.mockInput.pressEscape()
  await setup.waitFor(() => !state.streaming)
  const turn = state.lines.slice(before)
  const rows = turn.filter((l) => l.kind === "tool")
  expect(rows).toHaveLength(3)
  expect(rows.map((l) => l.kind === "tool" && l.status)).toEqual(["ok", "ok", "error"])
  expect(turn.some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI"))).toBe(true)
})
