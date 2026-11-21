import { beforeAll, expect, test } from "bun:test"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// The 80x24 layout: panels, notices, todos and subagents keep the prompt and status bar on screen.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { state, setState, resetNotifications, say, reconcile, command, show } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

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
