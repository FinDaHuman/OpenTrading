import { beforeAll, expect, test } from "bun:test"
import { z } from "zod"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// Approval prompts during a turn, and Esc while answering.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { runtime, mock, state, show, waitMcp } = app
let setup: TuiSetup
beforeAll(async () => {
  setup = app.setup
  // The first test calls the MCP demo's tool: its server must be up (in tui.test.tsx the /mcp tests ran first).
  await waitMcp(() => state.mcp[0]?.state === "connected")
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
  // The still background can leave a dot in the left gutter of any row: match past it.
  frame = await setup.waitForFrame((f) => /● demo · ghi_chu.*\n[^\n]*⎿  ✘ Đã từ chối/.test(f))
  await waitMcp(() => !state.streaming)
  expect(toolResult()).toContain("The user declined to run this tool")
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
  mock.callSlowTool = true
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
    mock.callSlowTool = false
    runtime.registry.unregister("cho_lau")
  }
}, 30_000)
