import { beforeAll, expect, test } from "bun:test"
import { until } from "./helpers/tui"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// Todos, the context size, /compact, overflow recovery and idle compaction.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { mock, idleTimerForTests, state, setState, reconcile, setKey, show, waitMcp, sendWith, slowTool } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

test("todo_write: the open list is pinned above the prompt, the transcript keeps one line, an answer left open retires it", async () => {
  await setKey("nvidia", "nvapi-good-key")
  const gate = await slowTool()
  await setup.mockInput.typeText("VIỆC-CẦN-LÀM cho FPT")
  setup.mockInput.pressEnter()
  // Mid-turn (the slow tool runs after the list is saved): the open list is pinned.
  await setup.waitFor(() => state.lines.some((l) => l.kind === "tool" && l.name === "todo_write" && l.status === "ok"))
  const frame = await setup.waitForFrame((f) => f.includes("Việc cần làm · 1/3") && f.includes("● Cập nhật việc cần làm (1/3 xong)"))
  show(frame)
  expect(frame).toContain("● Cập nhật việc cần làm (1/3 xong)")
  expect(frame).toContain("[>] Lấy BCTC 4 quý")
  expect(frame).toContain("[ ] So sánh với ngành")
  // The list is in the panel, not repeated under the tool row (the working row may name the item).
  expect(frame.split("[>] Lấy BCTC 4 quý").length - 1).toBe(1)
  // The panel sits between the transcript and the prompt.
  const rows = frame.split("\n")
  const panel = rows.findIndex((r) => r.includes("Việc cần làm · 1/3"))
  const prompt = rows.findIndex((r) => r.includes("› "))
  expect(panel).toBeGreaterThan(rows.findIndex((r) => r.includes("❯ VIỆC-CẦN-LÀM")))
  expect(prompt).toBeGreaterThan(panel)
  mock.callSlowTool = false
  gate.release()
  await setup.waitFor(() => !state.streaming)
  expect(state.liveTodos).toBeUndefined() // back to history once the turn is saved
  // The model answered with items open: the list is retired (not pinned, not marked done) and
  // the transcript names what stays unconfirmed.
  const after = await setup.waitForFrame((f) => f.includes("CHƯA được xác nhận là xong") && !f.includes("Việc cần làm · 1/3"))
  expect(after).toContain("[>] Lấy BCTC 4 quý")

  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  const cleared = await setup.waitForFrame((f) => !f.includes("Việc cần làm") && !f.includes("CHƯA được xác nhận"))
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

test("a context-overflow error compacts the conversation and sends the message again, once", async () => {
  await setKey("nvidia", "nvapi-good-key")
  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.history.length === 0)
  const filler = "số liệu ".repeat(300)
  // Three long turns straight into history (no requests), so compaction has a head to summarize.
  for (const text of ["dài một", "dài hai", "dài ba"]) {
    setState("history", (h) => [...h, { role: "user", content: `${text} ${filler}` }, { role: "assistant", content: `trả lời ${text} ${filler}` }])
  }
  mock.overflowing = 1
  try {
    await setup.mockInput.typeText("TRÀN-NGỮ-CẢNH hỏi tiếp")
    setup.mockInput.pressEnter()
    await waitMcp(() => JSON.stringify(state.history.at(-1) ?? "").includes("HẾT-CÂU-TRẢ-LỜI") && !state.streaming)
    expect(mock.overflowing).toBe(0)
    expect(state.lines.some((l) => l.kind === "info" && l.text.includes("đang nén rồi thử lại một lần"))).toBe(true)
    expect(state.lines.some((l) => l.kind === "info" && l.text.includes("gõ /compact"))).toBe(false)
    // The message shows once; in history it is asked once, after the summary, and answered.
    expect(state.lines.filter((l) => l.kind === "user" && l.text === "TRÀN-NGỮ-CẢNH hỏi tiếp")).toHaveLength(1)
    expect(JSON.stringify(state.history[0])).toContain("tom_tat_hoi_thoai")
    const asked = state.history.filter((m) => m.role === "user" && JSON.stringify(m.content).includes("TRÀN-NGỮ-CẢNH"))
    expect(asked).toHaveLength(1)
    expect(JSON.stringify(state.history.at(-1))).toContain("HẾT-CÂU-TRẢ-LỜI")
    expect(JSON.stringify(state.history)).not.toContain("(lỗi)")
    const frame = await setup.waitForFrame((f) => f.includes("Đã nén hội thoại"))
    show(frame)
  } finally {
    mock.overflowing = 0
  }
})

test("a context overflow after a tool ran keeps that turn, compacts, and continues without running the tool again", async () => {
  await setKey("nvidia", "nvapi-good-key")
  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.history.length === 0)
  const filler = "số liệu ".repeat(300)
  for (const text of ["dài một", "dài hai", "dài ba"]) {
    setState("history", (h) => [...h, { role: "user", content: `${text} ${filler}` }, { role: "assistant", content: `trả lời ${text} ${filler}` }])
  }
  mock.overflowing = 1
  try {
    await setup.mockInput.typeText("TRÀN-SAU-TOOL mấy giờ")
    setup.mockInput.pressEnter()
    await waitMcp(() => JSON.stringify(state.history.at(-1) ?? "").includes("HẾT-CÂU-TRẢ-LỜI") && !state.streaming)
    expect(mock.overflowing).toBe(0)
    const text = JSON.stringify(state.history)
    expect(text).toContain("tom_tat_hoi_thoai")
    // The turn with its tool result stays; the harness asks to continue from there.
    expect(text.match(/call_before_overflow/g)?.length).toBe(2) // the call and its result, once
    expect(text).toContain("Lượt trước bị ngắt vì hội thoại quá dài")
    expect(state.lines.filter((l) => l.kind === "tool" && l.name === "current_time")).toHaveLength(1)
  } finally {
    mock.overflowing = 0
  }
})

test("idle compaction (33d): a big conversation left idle is summarized once; never while a subagent works or auto-compaction is off", async () => {
  const saved = { provider: state.provider, model: state.model, idleCompactMinTokens: state.idleCompactMinTokens, idleCompactMinutes: state.idleCompactMinutes }
  await setKey("groq", "gsk-good-key")
  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.history.length === 0)
  expect(idleTimerForTests().armed).toBe(false) // nothing to compact yet
  setState({ provider: "groq", model: "test-model" })
  try {
    for (const text of ["rảnh một", "rảnh hai", "rảnh ba"]) {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      await setup.waitFor(() => state.lines.some((l) => l.kind === "user" && l.text === text))
      await waitMcp(() => !state.streaming)
    }
    // Armed after the turn; a small conversation is left alone when it fires.
    await setup.waitFor(() => idleTimerForTests().armed)
    expect(idleTimerForTests().fireNow()).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(state.lines.some((l) => l.kind === "compact")).toBe(false)

    // Over the floor (lowered for the test) while a background subagent still works: wait.
    // A small conversation waits for the next turn; changing the setting (/config) re-arms at once.
    setState({ idleCompactMinTokens: 1_000, contextTokens: 5_000, idleCompactMinutes: 30 })
    const busy = { id: "ag-idle", type: "nghien-cuu", description: "Nền", prompt: "", background: true, model: "", status: "running" as const, createdAt: Date.now(), startedAt: Date.now(), tools: [], toolCount: 0, usage: { input: 0, output: 0 }, text: "" }
    setState("agents", reconcile({ [busy.id]: busy }))
    await setup.waitFor(() => idleTimerForTests().armed)
    idleTimerForTests().fireNow()
    await new Promise((r) => setTimeout(r, 20))
    expect(state.lines.some((l) => l.kind === "compact")).toBe(false)
    expect(idleTimerForTests().armed).toBe(true) // tries again after another idle spell
    setState("agents", reconcile({}))

    // Auto-compaction off: idle compaction is off too (nothing pending).
    setState("autoCompactOff", true)
    expect(idleTimerForTests().fireNow()).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(state.lines.some((l) => l.kind === "compact")).toBe(false)
    setState("autoCompactOff", false)

    await setup.waitFor(() => idleTimerForTests().armed)
    idleTimerForTests().fireNow()
    await waitMcp(() => state.lines.some((l) => l.kind === "compact") && !state.streaming)
    expect(state.lines.some((l) => l.kind === "info" && l.text.startsWith(`Bạn vắng ${state.idleCompactMinutes} phút`))).toBe(true)
    expect(JSON.stringify(state.history[0])).toContain("tom_tat_hoi_thoai")
    // Once per idle spell: not armed again until the next turn.
    await new Promise((r) => setTimeout(r, 20))
    expect(idleTimerForTests().armed).toBe(false)
    const frame = await setup.waitForFrame((f) => f.includes("Đã nén hội thoại"))
    show(frame)
  } finally {
    setState({ ...saved, autoCompactOff: false })
    setState("agents", reconcile({}))
  }
})

test("prompt: a message typed during /compact is sent once the compaction ends", async () => {
  // Enough turns that /compact has something to summarize (the last two stay verbatim).
  for (const text of ["nén một", "nén hai", "nén ba"]) {
    await setup.mockInput.typeText(text)
    await sendWith("test-model", text)
  }
  let open = () => {}
  mock.summaryGate = new Promise<void>((r) => (open = r))
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
    mock.summaryGate = undefined
  }
}, 30_000)
