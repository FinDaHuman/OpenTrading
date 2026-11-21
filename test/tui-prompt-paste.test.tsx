import { beforeAll, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { until } from "./helpers/tui"
import path from "node:path"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// Prompt input: @ files, pasted-text pills, images, queued messages and Ctrl+G.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { home, cwd, runtime, mock, chatBodies, copied, state, setState, setKey, saveConfig, show, waitMcp, promptRows, clearPrompt, lastUserContent, sendWith, slowTool, waitFrameMs } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

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

test("/kiem-chung with a pasted multi-line report: the whole text reaches the model, opted in, desk_run declared", async () => {
  const report = Array.from({ length: 30 }, (_, i) => `FPT dòng-báo-cáo-${i + 1}: LNST ${i + 1}00 tỷ`).join("\n")
  await setup.mockInput.typeText("/kiem-chung ")
  await setup.mockInput.pasteBracketedText(report)
  const frame = await setup.waitForFrame((f) => /\/kiem-chung \[Pasted text #\d+ \+29 lines\]/.test(f))
  show(frame)
  await sendWith("test-model", "/kiem-chung")
  const sent = lastUserContent()
  expect(sent).toContain("Run the ultradesk playbook kiem-chung")
  expect(sent).toContain("dòng-báo-cáo-1:")
  expect(sent).toContain("dòng-báo-cáo-30")
  // The <ultradesk> reminder rides on the message, and desk_run is declared for this turn only.
  expect(sent).toContain("instead of orchestrating the skill yourself")
  const tools = (chatBodies.at(-1) as unknown as { tools?: { function: { name: string } }[] }).tools ?? []
  expect(tools.some((t) => t.function.name === "desk_run")).toBe(true)
  // The fake model answered in text: the transcript says the playbook never started.
  await setup.waitFor(() => state.lines.some((l) => l.kind === "info" && l.text.includes("model không gọi desk_run")))
})

test("ultradesk keyword answered without a run: one line says no playbook ran and how to start one", async () => {
  await setup.mockInput.typeText("ultradesk phân tích các mã nổi bật gần đây")
  await sendWith("test-model", "ultradesk phân tích")
  const frame = await setup.waitForFrame((f) => f.includes("ultradesk: model không chạy playbook nào"))
  show(frame)
  const note = state.lines.findLast((l) => l.kind === "info")
  expect(note).toMatchObject({ text: expect.stringContaining("/sang-loc · /kiem-chung · /tranh-bien · /nganh <yêu cầu>") })
  // An ordinary message says nothing about ultradesk.
  const count = state.lines.filter((l) => l.kind === "info" && l.text.startsWith("ultradesk:")).length
  await setup.mockInput.typeText("chào bạn")
  await sendWith("test-model", "chào bạn")
  expect(state.lines.filter((l) => l.kind === "info" && l.text.startsWith("ultradesk:")).length).toBe(count)
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
    expect(all).toContain("cannot view images")
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
    mock.callSlowTool = false
    gate.release()
    // The first answer ends, then the queued message is sent and answered.
    await waitMcp(() => state.queue.length === 0 && !state.streaming && state.lines.some((l) => l.kind === "user" && l.text === "câu hỏi tiếp theo"))
    expect(lastUserContent()).toContain("câu hỏi tiếp theo")
  } finally {
    mock.callSlowTool = false
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
    mock.callSlowTool = false
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
