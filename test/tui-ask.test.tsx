import { beforeAll, expect, test } from "bun:test"
import { z } from "zod"
import { until } from "./helpers/tui"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// ask_user, Ctrl+C, copy on select, and approvals that arrive while a question or panel is open.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { runtime, mock, osc52, ASK_MANY, state, show, connect, disarmExit, waitMcp, questionShown, closeQuestions } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

test("ask_user: one single-choice question sends on pick and the turn goes on", async () => {
  const lastTool = () => JSON.stringify([...state.history].reverse().find((m) => m.role === "tool")?.content ?? "")
  try {
    await setup.mockInput.typeText("HỎI-TÔI giúp mình")
    setup.mockInput.pressEnter()
    await questionShown()
    const frame = await setup.waitForFrame((f) => f.includes("Câu hỏi cho bạn") && f.includes("Bạn đầu tư trong bao lâu?"))
    show(frame)
    expect(frame).toMatch(/❯ 1\. Dưới 1 năm/)
    expect(frame).toContain("Lướt sóng, ưu tiên thanh khoản")
    expect(frame).toContain("4. Khác (tự nhập)")
    expect(frame).not.toContain("Hỏi về thị trường") // the prompt input is hidden meanwhile
    await setup.mockInput.typeText("2")
    await waitMcp(() => !state.streaming)
    expect(lastTool()).toContain('The user answered: \\"Bạn đầu tư trong bao lâu?\\"=\\"1–3 năm\\"')
    expect(JSON.stringify(state.history.at(-1)?.content)).toContain("HẾT-CÂU-TRẢ-LỜI")
    expect(state.question).toBeUndefined()
  } finally {
    closeQuestions()
  }
}, 30_000)

test("ask_user: esc declines without stopping the turn; 'Khác' takes a typed answer", async () => {
  const lastTool = () => JSON.stringify([...state.history].reverse().find((m) => m.role === "tool")?.content ?? "")
  try {
    await setup.mockInput.typeText("HỎI-TÔI lần nữa")
    setup.mockInput.pressEnter()
    await questionShown()
    setup.mockInput.pressEscape()
    await waitMcp(() => !state.streaming && state.question === undefined)
    expect(lastTool()).toContain("The user skipped the questions")
    expect(JSON.stringify(state.history.at(-1)?.content)).toContain("HẾT-CÂU-TRẢ-LỜI")
    expect(JSON.stringify(state.history.at(-1)?.content)).not.toContain("đã dừng")

    await setup.mockInput.typeText("HỎI-TÔI tự nhập")
    setup.mockInput.pressEnter()
    await questionShown()
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
  } finally {
    closeQuestions()
  }
}, 30_000)

test("ask_user: several questions have tabs, multi-select and a review before sending", async () => {
  const lastTool = () => JSON.stringify([...state.history].reverse().find((m) => m.role === "tool")?.content ?? "")
  await setup.mockInput.typeText("HỎI-NHIỀU nhé")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.question !== undefined)
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
  try {
    await waitMcp(() => !state.streaming)
    expect(lastTool()).toContain("Ngân hàng, Thép")
    expect(lastTool()).toContain("Trên 3 năm")
  } finally {
    closeQuestions()
  }
}, 30_000)

test("Ctrl+C like Claude Code: the first press clears the draft and says press again; a second within 800 ms exits", async () => {
  const before = mock.exits
  await setup.mockInput.typeText("bản nháp dở")
  await setup.waitForFrame((f) => f.includes("› bản nháp dở"))
  setup.mockInput.pressKey("c", { ctrl: true })
  let frame = await setup.waitForFrame((f) => f.includes("Nhấn Ctrl+C lần nữa để thoát"))
  show(frame)
  expect(frame).not.toContain("› bản nháp dở")
  expect(mock.exits).toBe(before)
  // The hint goes away after the window; a late second press only arms again.
  await new Promise((r) => setTimeout(r, 900))
  await setup.waitForFrame((f) => !f.includes("lần nữa để thoát"))
  setup.mockInput.pressKey("c", { ctrl: true })
  await setup.waitForFrame((f) => f.includes("Nhấn Ctrl+C lần nữa để thoát"))
  expect(mock.exits).toBe(before)
  setup.mockInput.pressKey("c", { ctrl: true })
  await waitMcp(() => mock.exits === before + 1)

  // Ctrl+D counts only on an empty prompt.
  disarmExit()
  setup.mockInput.pressKey("d", { ctrl: true })
  await setup.waitForFrame((f) => f.includes("Nhấn Ctrl+D lần nữa để thoát"))
  disarmExit()
})

test("Ctrl+C while answering stops the answer (and arms exit); on an approval it denies", async () => {
  const before = mock.exits
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
  mock.callSlowTool = true
  try {
    await setup.mockInput.typeText("CHẬM ctrl c")
    setup.mockInput.pressEnter()
    await waitMcp(() => state.lines.some((l) => l.kind === "tool" && l.label.includes("cho_lau") && l.status === "running"))
    setup.mockInput.pressKey("c", { ctrl: true })
    await waitMcp(() => !state.streaming)
    expect(JSON.stringify(state.history.at(-1)?.content)).toContain("(đã dừng)")
    expect(mock.exits).toBe(before)
  } finally {
    release()
    mock.callSlowTool = false
    runtime.registry.unregister("cho_lau")
  }
  disarmExit()

  runtime.registry.register({ name: "xoa_thu", description: "Xoá (tool thử)", input: z.object({}), readOnly: false, execute: async () => "đã xoá" })
  const decision = runtime.permissions.check(runtime.registry.get("xoa_thu")!, {}, new AbortController().signal, "test · xoa_thu")
  await setup.waitForFrame((f) => f.includes("Cần xác nhận"))
  setup.mockInput.pressKey("c", { ctrl: true })
  expect((await decision).allow).toBe(false)
  expect(mock.exits).toBe(before)
  runtime.registry.unregister("xoa_thu")
  disarmExit()
  // The denied prompt leaves on the next render; until then it still takes keys. Ending here without
  // waiting made the next tests' keys go to it (8 failures per --parallel=8 run, 4/4 runs); a 900 ms
  // sleep used to cover this.
  await setup.waitForFrame((f) => !f.includes("Cần xác nhận"))
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
