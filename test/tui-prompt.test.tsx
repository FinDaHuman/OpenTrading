import { beforeAll, expect, test } from "bun:test"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// Prompt input: wrapping, selection, line breaks, paste bursts, history, Ctrl+R, Ctrl+S.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { mock, chatCalls, osc52, state, setState, command, show, promptRows, settledPrompt, clearPrompt } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

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

test("prompt: ui.pasteBurst on, a paste typed out key by key keeps its line breaks; a burst that ends in Enter still sends (#353)", async () => {
  const { setState: set } = await import("../src/tui/state")
  set("pasteBurst", true)
  try {
    // The mock types every key at once, like a terminal typing out a paste: the Enter is held, and
    // the next key behind it makes it a line break.
    await setup.mockInput.typeText("dong-mot-cua-ban-dan")
    setup.mockInput.pressEnter()
    await setup.mockInput.typeText("dong-hai")
    const frame = await setup.waitForFrame((f) => promptRows(f).includes("dong-hai"))
    expect(promptRows(frame)).toEqual(["dong-mot-cua-ban-dan", "dong-hai"])
    await clearPrompt()
    // Nothing behind the Enter: it sends (keys a busy app read all at once end like this).
    const before = chatCalls.length
    await setup.mockInput.typeText("Gửi ngay cả khi gõ rất nhanh")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => chatCalls.length > before && !state.streaming)
  } finally {
    set("pasteBurst", false)
  }
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
  // Each ↑ waits for the prompt to change: pressing again on a stale frame (slow CI) would go
  // past /help to older entries.
  let up = 0
  while (!promptRows(frame).includes("/help") && up++ < 3) {
    const before = promptRows(frame).join("\n")
    setup.mockInput.pressArrow("up")
    frame = await setup.waitForFrame((f) => promptRows(f).join("\n") !== before)
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
  const exitsBefore = mock.exits
  await setup.mockInput.typeText("ban nhap")
  setup.mockInput.pressKey("r", { ctrl: true })
  await setup.mockInput.typeText("hel")
  await setup.waitForFrame((f) => promptRows(f)[0] === "/help")
  setup.mockInput.pressCtrlC()
  frame = await setup.waitForFrame((f) => promptRows(f)[0] === "ban nhap" && !f.includes("tìm trong lịch sử"))
  expect(mock.exits).toBe(exitsBefore)
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
