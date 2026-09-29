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
  if (url.endsWith("/api.json")) return Response.json(CATALOG)
  if (auth?.includes("bad")) return Response.json({ error: { message: "Invalid API Key" } }, { status: 401 })
  if (url.endsWith("/chat/completions")) {
    chatCalls.push(url)
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const request = JSON.parse(String(init?.body)) as { messages: { role: string; content?: unknown }[] }
    const last = JSON.stringify(request.messages.at(-1)?.content ?? "")
    // "MẤY-GIỜ" asks for a tool call until a tool result is in the conversation.
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

const runtime = initRuntime({ cwd, home, skills: () => state.skills })
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

test("/mcp shows the global demo server connected with its tools", async () => {
  // Spawning the server takes real time, so poll the clock instead of render passes.
  for (let i = 0; i < 200 && state.mcp[0]?.state !== "connected"; i++) await new Promise((r) => setTimeout(r, 100))
  expect(state.mcp[0]).toMatchObject({ name: "demo", state: "connected" })
  const bar = await setup.waitForFrame((f) => f.includes("MCP 1/1"))
  expect(bar).toContain("MCP 1/1")
  await setup.mockInput.typeText("/mcp")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("MCP servers · 1"))
  setup.mockInput.pressEnter()
  const detail = await setup.waitForFrame((f) => f.includes("mcp__demo__add"))
  expect(detail).toContain("đã kết nối")
  show(detail)
  // Wait between presses: two ESC bytes in one read ("\x1b\x1b") parse as a single
  // alt+escape keypress, so back-to-back presses would only close the detail view.
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("MCP servers · 1") && !f.includes("mcp__demo__add"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
}, 30_000)

test("/tools lists built-in and MCP tools", async () => {
  await setup.mockInput.typeText("/tools")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("Tools · 5"))
  expect(frame).toContain("current_time")
  expect(frame).toContain("mcp__demo__echo")
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
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
