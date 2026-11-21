import { beforeAll, expect, test } from "bun:test"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { z } from "zod"
import { until } from "./helpers/tui"
import path from "node:path"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// Subagents: panel rows, approvals, /agents, background runs, /tasks.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { home, runtime, memory, mock, state, setState, say, reconcile, readJson, saveConfig, currentSession, show, waitMcp, settledPrompt } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

test("subagents: parallel spawns are one line in the transcript and one row each on the panel; over the limit one waits for a slot; ctrl+o shows the tree", async () => {
  await saveConfig({ ...(await readJson<object>(path.join(home, "config.json"), {})), subagents: { maxConcurrent: 1 } })
  runtime.subagents.setMax(1)
  let release!: () => void
  mock.childGate = new Promise((r) => (release = r))
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
    frame = await setup.waitForFrame((f) => /└─ nghien-cuu \(Định giá CMG\)[^\n]*\n\s*⎿ Xong \(0 tool · /.test(f))
    // Each expanded row carries its whole brief (several lines): the first row is one page up.
    setup.mockInput.pressKey("\x1b[5~") // PgUp
    await setup.waitForFrame((f) => /├─ nghien-cuu \(Định giá FPT\)[^\n]*\n\s*│  ⎿ Xong \(0 tool · /.test(f))
    setup.mockInput.pressKey("\x1b[6~") // PgDn: back down
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
    mock.childGate = undefined
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
  expect(runtime.registry.get("spawn_subagent")!.description).toContain("- tra-cuu: a quick lookup")
  expect(runtime.registry.get("spawn_subagent")!.description).toContain("- rieng-tui: Loại riêng để thử\n")
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
  mock.childGate = new Promise((r) => (release = r))
  try {
    await setup.mockInput.typeText("SUBAGENT-NEN")
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.streaming && state.history.some((m) => m.role === "tool" && JSON.stringify(m.content).includes("started in the background")))
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
    mock.childGate = undefined
    await waitMcp(() => !state.streaming)
  }
}, 30_000)

test("subagent panel: between two model steps the row shows the last tool, not 'Đang khởi động…'", async () => {
  let release!: () => void
  mock.childAfterTool = new Promise((r) => (release = r))
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
    mock.childAfterTool = undefined
  }
}, 30_000)

test("subagent panel: ↓ at the end of the prompt selects a row; enter opens it in /tasks; x twice stops it; typing goes back", async () => {
  // Agents of earlier tests that finished a moment ago would still linger on the panel.
  setState("agents", reconcile({}))
  let release!: () => void
  mock.childGate = new Promise((r) => (release = r))
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
    mock.childGate = undefined
    setState("panelFocus", undefined)
    await waitMcp(() => !state.streaming)
    for (let i = 0; i < 3; i++) setup.mockInput.pressBackspace()
  }
}, 30_000)

test("background subagent: /clear stops it and its result never reaches the new conversation", async () => {
  mock.childGate = new Promise(() => {})
  try {
    await setup.mockInput.typeText("SUBAGENT-NEN")
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.streaming && Object.values(state.agents).some((a) => a.background && a.status !== "completed" && a.status !== "stopped"))
    const id = Object.values(state.agents).find((a) => a.background && (a.status === "running" || a.status === "queued"))!.id
    const old = currentSession().id
    await setup.mockInput.typeText("/clear")
    setup.mockInput.pressEnter()
    await waitMcp(() => runtime.subagents.get(id)?.status === "stopped")
    // /clear has switched to the new conversation (its run was stopped on the way out): only then
    // do the checks below say anything. Under full CPU load, 50 ms after the stop was not enough.
    await until(() => currentSession().id !== old, 10_000, "/clear to start the new conversation")
    await new Promise((r) => setTimeout(r, 50))
    expect(state.notices).toEqual([])
    expect(state.lines.some((l) => l.kind === "agent-notice")).toBe(false)
    expect(state.streaming).toBe(false)
    // The stopped run of the old session does not reappear in the new one (/tasks, /context).
    expect(Object.keys(state.agents)).toHaveLength(0)
  } finally {
    mock.childGate = undefined
  }
}, 30_000)

test("/agents lists exactly the tools a subagent gets: never the main agent's own (session history)", async () => {
  const { resolvedTools } = await import("../src/tui/dialogs/agents")
  const { childRegistry } = await import("../src/core/subagents/manager")
  const def = { name: "tat-ca", description: "x", tools: undefined, disallowedTools: undefined }
  const listed = resolvedTools(runtime, def as never)
  expect(listed).not.toContain("session_list")
  expect(listed).not.toContain("session_get")
  const child = childRegistry(runtime.registry, { id: "ag-x", type: "tat-ca", description: "x" })
    .list()
    .map((t) => t.name)
    .filter((n) => n !== "tool_search")
  expect([...listed].sort()).toEqual([...child].sort())
})
