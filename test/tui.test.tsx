import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"

// Isolate state from the real ~/.opentrading before any core module loads.
const home = await mkdtemp(path.join(os.tmpdir(), "opentrading-test-"))
process.env.OPENTRADING_HOME = home
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
    const request = JSON.parse(String(init?.body)) as { messages: { role: string; content?: unknown }[] }
    const last = JSON.stringify(request.messages.at(-1)?.content ?? "")
    // "MẤY-GIỜ" asks for a tool call until a tool result is in the conversation.
    // Only tool results of the current turn count (earlier turns left their own in history).
    const lastUser = request.messages.map((m) => m.role).lastIndexOf("user")
    const answeredThisTurn = request.messages.slice(lastUser).some((m) => m.role === "tool")
    if (last.includes("GHI-CHÚ") && !answeredThisTurn) {
      const call = { index: 0, id: "call_note", type: "function", function: { name: "mcp__demo__ghi_chu", arguments: '{"noi_dung":"mua VCB khi về 85"}' } }
      return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    }
    if (last.includes("MẤY-GIỜ") && !request.messages.some((m) => m.role === "tool")) {
      const call = { index: 0, id: "call_1", type: "function", function: { name: "current_time", arguments: "{}" } }
      return new Response(chunk({ role: "assistant", tool_calls: [call] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    }
    const body =
      chunk({ role: "assistant", content: "" }) +
      REPLY.map((content) => chunk({ content })).join("") +
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
const { readJson } = await import("../src/core/store")
const { setKey } = await import("../src/core/auth")
const { initRuntime } = await import("../src/core/runtime")
const { FileMemory } = await import("../src/core/memory/file-memory")

const memory = new FileMemory(path.join(home, "memory"))
const runtime = initRuntime({ cwd, home, skills: () => state.skills, memory })
let setup: Awaited<ReturnType<typeof testRender>>

beforeAll(async () => {
  setup = await testRender(() => <App runtime={runtime} />, { width: 100, height: 32 })
})

// Tests share one app. If a test fails with a dialog open, close it so the failure does not
// cascade into every later test typing into that dialog.
afterEach(() => {
  if (state.dialog) setState("dialog", undefined)
})

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

test("the slash-command list never overlaps rows, and scrolls with the arrow keys", async () => {
  const { COMMANDS } = await import("../src/tui/commands")
  await setup.mockInput.typeText("/")
  // Panel rows are the lines showing a command's description (Home also lists some command names).
  const rowsOf = (f: string) =>
    f
      .split("\n")
      .flatMap((line) => COMMANDS.filter((c) => line.includes(c.description)).map((c) => c.name))
  let frame = await setup.waitForFrame((f) => f.includes("tab ↹"))
  show(frame)
  // Regression: rows were squeezed onto the same line ("/newsions", "/helpr").
  expect(frame).not.toContain("/newsions")
  expect(frame).not.toContain("/helpr")
  const first = rowsOf(frame)
  expect(first).toEqual(COMMANDS.slice(0, 8).map((c) => c.name))
  expect(frame).toContain(`1/${COMMANDS.length}`)

  // Walk to the last command: the window follows the highlight, names stay intact.
  for (let i = 0; i < COMMANDS.length - 1; i++) setup.mockInput.pressArrow("down")
  frame = await setup.waitForFrame((f) => f.includes(`${COMMANDS.length}/${COMMANDS.length}`))
  const last = rowsOf(frame)
  expect(last).toEqual(COMMANDS.slice(-8).map((c) => c.name))
  expect(frame).toMatch(/▸ \/exit/)
  show(frame)
  setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => !f.includes("tab ↹"))
})

test("chat before connecting shows a readable error instead of crashing", async () => {
  await setup.mockInput.typeText("Xin chào")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Chưa kết nối provider. Gõ /connect"))
})

test("tab completes a partial command, enter opens it", async () => {
  await setup.mockInput.typeText("/con")
  await setup.waitForFrame((f) => f.includes("tab ↹"))
  setup.mockInput.pressTab()
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
  await setup.waitForFrame((f) => f.includes("Phím tắt"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/connect saves a masked key and lists that provider's chat models", async () => {
  await connect("groq", "gsk_test_1234567890abcd")
  const auth = await readJson<Record<string, unknown>>(path.join(home, "auth.json"), {})
  expect(auth.groq).toEqual({ type: "api", key: "gsk_test_1234567890abcd" })
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
  await setup.mockInput.typeText("Chào NVIDIA")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => chatCalls.length === 2 && !state.streaming)
  expect(chatCalls.at(-1)).toBe("https://integrate.api.nvidia.com/v1/chat/completions")
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
  expect(frame).toMatch(/❯ demo · ✔ đã kết nối · 4 tool/)
  expect(frame).toContain("Có sẵn (đang tắt")
  expect(frame).toMatch(/context7 · ◯ không cần đăng nhập/)
  expect(frame).toContain("+ Thêm server tuỳ chỉnh")
  // The panel replaces the prompt input.
  expect(frame).not.toContain("Hỏi về thị trường")

  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("demo · MCP server"))
  show(frame)
  expect(frame).toContain("Trạng thái")
  expect(frame).toContain("✔ đã kết nối · 4 tool")
  expect(frame).toContain("Lệnh")
  expect(frame).toContain("Khả năng")
  expect(frame).toContain("/demo:phan_tich")
  expect(frame).toMatch(/❯ 1\. Xem tool/)
  expect(frame).toContain("Kết nối lại")
  expect(frame).toContain("Tắt")

  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Tool của demo"))
  expect(frame).toContain("◇ add")
  expect(frame).toContain("◆ ghi_chu")
  for (let i = 0; i < 3; i++) setup.mockInput.pressArrow("down")
  await setup.waitForFrame((f) => f.includes("❯ ◆ ghi_chu"))
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Tên đầy đủ"))
  show(frame)
  expect(frame).toContain("[hỏi trước khi chạy]")
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

test("/mcp: space turns a server off and on (saved to mcp.json); catalog entries open their own screen", async () => {
  await setup.mockInput.typeText("/mcp")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("❯ demo"))
  setup.mockInput.pressKey(" ")
  await waitMcp(() => state.mcp[0]?.state === "disabled")
  let saved = await readJson<{ mcpServers: Record<string, { enabled?: boolean }> }>(path.join(home, "mcp.json"), { mcpServers: {} })
  expect(saved.mcpServers.demo!.enabled).toBe(false)
  await setup.waitForFrame((f) => f.includes("demo · ◯ đã tắt"))
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
  await setup.mockInput.typeText("/tools")
  setup.mockInput.pressEnter()
  // 2 built-in + propose_memory (FileMemory) + 4 from the demo MCP server
  const frame = await setup.waitForFrame((f) => f.includes("Tools · 7"))
  expect(frame).toContain("current_time")
  expect(frame).toContain("propose_memory")
  expect(frame).toContain("mcp__demo__echo")
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("a lone '/' + enter is never sent to the model", async () => {
  const before = chatCalls.length
  const lines = state.lines.length
  await setup.mockInput.typeText("/")
  await setup.waitForFrame((f) => f.includes("tab ↹"))
  setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => !f.includes("tab ↹"))
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
  await setup.waitForFrame((f) => !f.includes("tab ↹"))

  await setup.mockInput.typeText("/demo:phan_tich")
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

test("a tool call renders as a ⚙ row with its result, then the answer", async () => {
  await setKey("nvidia", "nvapi-good-key")
  await setup.mockInput.typeText("MẤY-GIỜ rồi?")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("HẾT-CÂU-TRẢ-LỜI") && f.includes("⚙ current_time()"))
  expect(frame).toContain("└ ")
  expect(frame).toContain("giờ Việt Nam")
  show(frame)
  await setup.waitFor(() => !state.streaming)
  const roles = state.history.map((m) => m.role)
  expect(roles.slice(-4)).toEqual(["user", "assistant", "tool", "assistant"])
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
  frame = await setup.waitForFrame((f) => f.includes("✘ Đã từ chối demo · ghi_chu"))
  await waitMcp(() => !state.streaming)
  expect(toolResult()).toContain("Người dùng từ chối chạy tool này")
  expect(state.approval).toBeUndefined()
  const answer = state.history.at(-1)
  expect(answer?.role).toBe("assistant")
  expect(JSON.stringify(answer?.content)).toContain("HẾT-CÂU-TRẢ-LỜI")
  expect(JSON.stringify(answer?.content)).not.toContain("Đã dừng")

  await setup.mockInput.typeText("GHI-CHÚ lần nữa")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Cho phép chạy?"))
  await setup.mockInput.typeText("2")
  await setup.waitForFrame((f) => f.includes("✔ Đã cho phép demo · ghi_chu cho cả phiên"))
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
  const frame = await setup.waitForFrame((f) => f.includes("Cần xác nhận · tool có thể phá huỷ"))
  expect(frame).toContain("⚠ phá huỷ")
  setup.mockInput.pressEscape()
  expect((await decision).allow).toBe(false)
  expect(controller.signal.aborted).toBe(false)
  runtime.registry.unregister("xoa_du_lieu")
})

test("/new starts a fresh session; /sessions reopens the previous one with its tool rows", async () => {
  const before = state.lines.length
  expect(before).toBeGreaterThan(0)
  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.lines.length === 0 && state.history.length === 0)

  await setup.mockInput.typeText("/sessions")
  setup.mockInput.pressEnter()
  const list = await setup.waitForFrame((f) => f.includes("Phiên đã lưu"))
  expect(list).toContain("lượt")
  show(list)
  setup.mockInput.pressEnter() // newest first: the session we just left
  await setup.waitFor(() => state.dialog === undefined && state.lines.length > 0)
  // The "reopened" note is the first line (may be scrolled out of view): check state.
  expect(state.lines[0]).toMatchObject({ kind: "info" })
  expect((state.lines[0] as { text: string }).text).toContain("Mở lại phiên")
  // Tool rows come back (the older ones may be scrolled out of view: check state too).
  expect(state.lines.some((l) => l.kind === "tool" && l.label.includes("current_time"))).toBe(true)
  const frame = await setup.waitForFrame((f) => f.includes("⚙ "))
  expect(frame).not.toContain("<nhac_nho>")
  expect(state.history.length).toBeGreaterThan(0)
  expect(state.clock).toBeUndefined() // re-sent on the next turn
  show(frame)
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
