import { beforeAll, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { z } from "zod"
import { until } from "./helpers/tui"
import path from "node:path"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// Home screen, the slash-command list, /connect, /model and a first streamed answer.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: false })
const { home, chatCalls, copied, state, say, readJson, setKey, command, show, connect } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

test("home screen shows branding and connect hint", async () => {
  const frame = await setup.waitForFrame((f) => f.includes("/connect để bắt đầu"))
  expect(frame).toContain("▟▀▀▙")
  expect(frame).toContain("Harness AI phân tích chứng khoán Việt Nam")
  show(frame)
})

test("the slash-command list: one line per command, straight columns, wraps with the arrow keys", async () => {
  const { COMMANDS, withPlaybooks } = await import("../src/tui/commands")
  const { PLAYBOOKS } = await import("../src/core/desk/playbooks")
  // Playbook commands sit right after /desk.
  const listed = withPlaybooks(COMMANDS, PLAYBOOKS.map((p) => ({ name: p.meta.name, description: "" })))
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
  expect(rows.map((r) => r.trim().replace(/^❯ /, "").split(" ")[0])).toEqual(listed.slice(0, 8).map((c) => `/${c.name}`))
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
  const before = state.history.length
  await setup.mockInput.typeText("Giải thích T+2.5")
  setup.mockInput.pressEnter()
  // The whole answer can take longer than waitForFrame's 20 frames on a busy machine.
  const answered = () => state.history.length > before && JSON.stringify(state.history.at(-1)?.content ?? "").includes("HẾT-CÂU-TRẢ-LỜI")
  await until(() => !state.streaming && answered(), 15_000, "the answer")
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
