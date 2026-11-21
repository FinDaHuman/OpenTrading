import { beforeAll, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { z } from "zod"
import { pastEnterGrace } from "./helpers/clock"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// /watchlist and ultradesk: the keyword, /desk, the card, desk runs.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { runtime, state, setState, reconcile, currentSession, command, show, disarmExit } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

test("/watchlist: edits by command, opens a list and shows live quotes from the MCP quote tool", async () => {
  const asked: string[][] = []
  runtime.registry.register({
    name: "mcp__fakewl__vn_equity_quote_batch",
    source: "mcp:fakewl",
    description: "quotes",
    input: z.object({ symbols: z.array(z.string()) }),
    readOnly: true,
    deferrable: true,
    execute: async (input) => {
      asked.push((input as { symbols: string[] }).symbols)
      return JSON.stringify({
        data: { quotes: [{ symbol: "VCB", close_price: 57300, percent_change: 1.2, volume_accumulated: 2_100_000 }, { symbol: "HPG", close_price: 26900, percent_change: -0.4 }] },
        provenance: { source: "vnstock", as_of: "2026-10-10T14:30:00+07:00" },
      })
    },
  })
  try {
    for (const command of ["/watchlist new dai-han", "/watchlist add dai-han vcb, hpg FPT"]) {
      await setup.mockInput.typeText(command)
      setup.mockInput.pressEnter()
    }
    await setup.waitForFrame((f) => f.includes('"DAI-HAN": FPT, HPG, VCB'))
    await setup.mockInput.typeText("/watchlist")
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("Watchlist cá nhân · 1") && f.includes("DAI-HAN"))
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes("Watchlist DAI-HAN · 3 mã") && f.includes("57.300") && f.includes("Không có giá: FPT"))
    show(frame)
    expect(frame).toContain("+1,2%")
    expect(frame).toContain("KL 2,1M")
    expect(frame).toContain("nguồn: vnstock")
    expect(asked).toEqual([["FPT", "HPG", "VCB"]])
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => f.includes("Watchlist cá nhân · 1"))
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    runtime.registry.unregister("mcp__fakewl__")
  }
})

test("/watchlist <a name that is no list>: the lists open and r is a letter of their filter", async () => {
  await setup.mockInput.typeText("/watchlist khong-co")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Watchlist cá nhân · ") && f.includes("gõ để lọc"))
  await setup.mockInput.typeText("r")
  const frame = await setup.waitForFrame((f) => f.includes("› r"))
  show(frame)
  // One esc closes the dialog: there is no list view to step back from.
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("ultradesk: the keyword is hinted while typed; /desk on|off shows on the mode line; /desk without runs", async () => {
  await setup.mockInput.typeText("ultradesk so sánh FPT")
  let frame = await setup.waitForFrame((f) => f.includes("ultradesk: yêu cầu này được chạy playbook"))
  show(frame)
  setup.mockInput.pressKey("c", { ctrl: true })
  await setup.waitForFrame((f) => !f.includes("ultradesk so sánh FPT"))
  disarmExit()
  await setup.mockInput.typeText("/desk on")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("desk ●"))
  expect(state.deskMode).toBe(true)
  await setup.mockInput.typeText("/desk off")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => !state.deskMode)
  await setup.waitForFrame((f) => !f.includes("desk ●"))
  await setup.mockInput.typeText("/desk")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Chưa có run ultradesk nào"))
  show(frame)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/desk: a run of an earlier sitting (only on disk) resumes with ctrl+r from its detail view, as the text there says", async () => {
  const { DeskJournal } = await import("../src/core/desk/journal")
  const { currentSession } = await import("../src/tui/session")
  const id = "dk-disk01"
  const journal = new DeskJournal(currentSession().dir, id)
  await journal.writeMeta({
    format: 1,
    id,
    playbook: "sang-loc",
    version: "1",
    args: { tickers: ["FPT", "VCB"] },
    size: "small",
    status: "partial",
    cut: "quota",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    counters: { agents: 1, cached: 0, requests: 3, input: 10, output: 5 },
  })
  const resumed: string[] = []
  const real = runtime.desk.resume.bind(runtime.desk)
  runtime.desk.resume = async (runId: string) => {
    resumed.push(runId)
    throw new Error("không chạy thật trong test")
  }
  try {
    await setup.mockInput.typeText("/desk")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes(`sang-loc · ${id}`))
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((f) => f.includes(`Ultradesk · ${id}`) && f.includes("Run của lần mở trước"))
    show(frame)
    expect(frame).toContain("ctrl+r chạy tiếp · esc")
    setup.mockInput.pressKey("r", { ctrl: true })
    await setup.waitFor(() => resumed.length > 0)
    expect(resumed).toEqual([id])
  } finally {
    runtime.desk.resume = real
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
    await rm(journal.dir, { recursive: true, force: true })
  }
})

test("/desk: ctrl+p/ctrl+x act on the run and leave the filter alone; a plain p or x only filters the agents", async () => {
  const agent = (key: string, label: string) => ({ key, label, phase: "Thu thập", type: "phan-tich", status: "running" as const, requests: 1, tokens: { input: 10, output: 5 } })
  const run = {
    id: "dk-keys01",
    playbook: "phan-bien",
    version: "1",
    args: {},
    size: "small" as const,
    status: "running" as const,
    phases: [{ title: "Thu thập", total: 2, done: 0, failed: 0 }],
    agents: [agent("k1", "thẻ điểm FPT"), agent("k2", "phản biện HPG")],
    logs: [],
    createdAt: Date.now(),
    counters: { agents: 2, cached: 0, requests: 2, input: 10, output: 5 },
    sessionId: undefined,
  }
  const calls: string[] = []
  const real = { pause: runtime.desk.pause, stop: runtime.desk.stop, resume: runtime.desk.resume }
  runtime.desk.pause = (id: string) => (calls.push(`pause ${id}`), true)
  runtime.desk.stop = (id: string) => (calls.push(`stop ${id}`), true)
  runtime.desk.resume = async (id: string) => {
    calls.push(`resume ${id}`)
    throw new Error("không chạy thật trong test")
  }
  setState("deskRuns", "dk-keys01", run)
  try {
    await setup.mockInput.typeText("/desk")
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("Ultradesk · dk-keys01") && f.includes("phản biện HPG"))
    expect(frame).toContain("ctrl+p tạm dừng · ctrl+x dừng")
    // Plain letters are the filter's: nothing happens to the run.
    await setup.mockInput.typeText("px")
    frame = await setup.waitForFrame((f) => f.includes("› px"))
    expect(calls).toEqual([])
    setup.mockInput.pressBackspace()
    setup.mockInput.pressBackspace()
    await setup.waitForFrame((f) => f.includes("gõ để lọc"))
    // ctrl+p, ctrl+x: the run acts, the filter stays empty. ctrl+r does nothing on a live run.
    setup.mockInput.pressKey("p", { ctrl: true })
    setup.mockInput.pressKey("x", { ctrl: true })
    setup.mockInput.pressKey("r", { ctrl: true })
    await setup.waitFor(() => calls.length >= 2)
    frame = await setup.waitForFrame((f) => f.includes("Ultradesk · dk-keys01"))
    show(frame)
    expect(calls).toEqual(["pause dk-keys01", "stop dk-keys01"])
    expect(frame).toContain("gõ để lọc")
    expect(frame).toContain("phản biện HPG")
  } finally {
    Object.assign(runtime.desk, real)
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
    setState("deskRuns", reconcile({}))
  }
})

test("ultradesk card: ←→ change the size and its cost, a large run warns, enter runs with what was chosen", async () => {
  const estimates = { small: { agents: 6, requests: 36 }, medium: { agents: 14, requests: 84 }, large: { agents: 46, requests: 276 }, unrestricted: { agents: 46, requests: 276 } }
  const asking = runtime.deskApprovals.ask({
    playbook: "sang-loc",
    description: "Sàng lọc nhiều mã",
    phases: ["Thu thập", "Kiểm chứng", "Tổng hợp"],
    summary: "8 mã: FPT, MWG, HPG, … (+5)",
    args: { tickers: ["FPT"] },
    size: "small",
    estimates,
    warnRequests: 150,
    model: "groq · test-model",
    reason: "first-time",
  })
  let frame = await setup.waitForFrame((f) => f.includes("ultradesk · sang-loc") && f.includes("6 agent · ~36 request"))
  show(frame)
  expect(frame).toContain("Thu thập → Kiểm chứng → Tổng hợp")
  expect(frame).toContain("Chạy, không hỏi lại sang-loc")
  // From "Chạy" up to the size row, then right twice: medium, then large (which warns).
  setup.mockInput.pressArrow("up")
  setup.mockInput.pressArrow("up")
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((f) => f.includes("◂ medium ▸") && f.includes("14 agent · ~84 request"))
  setup.mockInput.pressArrow("right")
  frame = await setup.waitForFrame((f) => f.includes("◂ large ▸") && f.includes("Run này có thể tốn tới ~276 request"))
  show(frame)
  pastEnterGrace()
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  expect(await asking).toEqual({ run: true, size: "large", effort: undefined, remember: false })
  await setup.waitFor(() => state.deskApproval === undefined)
})

test("a desk run is one panel row and one mode-line pill, never a row per agent", async () => {
  const run = {
    id: "dk-tui001",
    playbook: "sang-loc",
    version: "1",
    args: {},
    size: "small" as const,
    status: "running" as const,
    phases: [
      { title: "Thu thập", total: 3, done: 1, failed: 0 },
      { title: "Tổng hợp", total: 0, done: 0, failed: 0 },
    ],
    agents: [],
    logs: [],
    createdAt: Date.now(),
    counters: { agents: 2, cached: 0, requests: 5, input: 100, output: 20 },
    sessionId: undefined,
  }
  const child = {
    id: "ag-desk01",
    type: "tra-cuu",
    description: "chấm điểm MWG",
    prompt: "",
    background: false,
    model: "",
    status: "running" as const,
    createdAt: Date.now(),
    tools: [],
    toolCount: 0,
    usage: { input: 0, output: 0 },
    text: "",
    deskRunId: "dk-tui001",
  }
  setState("deskRuns", "dk-tui001", run)
  setState("agents", "ag-desk01", child)
  try {
    const frame = await setup.waitForFrame((f) => f.includes("ultradesk") && f.includes("sang-loc · Thu thập 1/3"))
    show(frame)
    expect(frame).toContain("desk sang-loc 2 agent")
    expect(frame).not.toContain("chấm điểm MWG")
  } finally {
    setState("deskRuns", reconcile({}))
    const { "ag-desk01": _gone, ...rest } = state.agents
    setState("agents", reconcile(rest))
  }
  await setup.waitForFrame((f) => !f.includes("sang-loc · Thu thập"))
})

test("a desk run shows a live card under its desk_run row, folds to one line when done, and /desk lists every agent", async () => {
  const t0 = Date.now() - 72_000
  const agent = (key: string, phase: string, label: string, status: "done" | "running" | "queued", agentId?: string) => ({ key, label, phase, type: phase === "Thu thập" ? "phan-tich" : "phan-bien", status, agentId, requests: status === "done" ? 4 : 1, tokens: { input: 900, output: 300 } })
  const run = {
    id: "dk-card01",
    playbook: "sang-loc",
    version: "1",
    args: { tickers: ["FPT", "MWG", "VNM", "HPG"] },
    size: "medium" as const,
    effort: "high" as const,
    status: "running" as const,
    phases: [
      { title: "Thu thập", total: 4, done: 2, failed: 0 },
      { title: "Phản biện", total: 1, done: 0, failed: 0 },
      { title: "Tổng hợp", total: 0, done: 0, failed: 0 },
    ],
    agents: [
      agent("a1", "Thu thập", "FPT", "done", "ag-card1"),
      agent("a2", "Thu thập", "VNM", "done", "ag-card2"),
      agent("a3", "Thu thập", "MWG", "running", "ag-card3"),
      agent("a4", "Thu thập", "HPG", "running", "ag-card4"),
      agent("a5", "Phản biện", "FPT", "queued"),
    ],
    logs: ["Xếp hạng tạm: FPT 7.8 · VNM 6.9"],
    createdAt: t0,
    counters: { agents: 4, cached: 0, requests: 12, input: 182_000, output: 21_000 },
    sessionId: undefined,
  }
  const sub = (id: string, label: string, tool: string, running: boolean) => ({
    id,
    type: "phan-tich",
    description: label,
    prompt: `Chấm điểm ${label}`,
    background: false,
    model: "",
    status: running ? ("running" as const) : ("completed" as const),
    createdAt: t0,
    startedAt: t0 + 1000,
    endedAt: running ? undefined : t0 + 30_000,
    tools: [{ callId: `${id}-t`, name: tool.split("(")[0]!, label: tool, status: running ? ("running" as const) : ("ok" as const) }],
    toolCount: 1,
    usage: { input: 900, output: 1200 },
    text: "",
    deskRunId: "dk-card01",
  })
  const before = state.lines.length
  setState("lines", (lines) => [
    ...lines,
    { kind: "tool", callId: "c-desk", name: "desk_run", label: "desk_run(sang_loc)", status: "ok", output: "Đã bắt đầu run ultradesk dk-card01: playbook sang-loc, quy mô medium (~9 agent, ~60 request).\nRun chạy nền…" },
  ])
  setState("agents", "ag-card1", sub("ag-card1", "FPT", "vn_financials(FPT)", false))
  setState("agents", "ag-card2", sub("ag-card2", "VNM", "vn_financials(VNM)", false))
  setState("agents", "ag-card3", sub("ag-card3", "MWG", "vn_financials(MWG)", true))
  setState("agents", "ag-card4", sub("ag-card4", "HPG", "market_snapshot(HPG)", true))
  setState("deskRuns", "dk-card01", run)
  try {
    let frame = await setup.waitForFrame((f) => f.includes("◆ ultradesk · sang-loc · dk-card01") && f.includes("MWG · vn_financials(MWG)"))
    show(frame)
    expect(frame).toMatch(/đang chạy · 1m ?1\ds/)
    expect(frame).toMatch(/━+[╺─]+\s+2\/\d+ agent · \d+%/)
    expect(frame).toMatch(/Thu thập\s+━+[╺─]*\s+2\/4/)
    expect(frame).toContain("chờ lượt · 2 đang chạy")
    expect(frame).toContain("» Xếp hạng tạm: FPT 7.8")

    await setup.mockInput.typeText("/desk")
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes("↑↓ chọn agent") && f.includes("phan-bien · FPT"))
    show(frame)
    expect(frame).toMatch(/Thu thập[\s\S]*phan-tich · MWG[\s\S]*Phản biện[\s\S]*phan-bien · FPT/)
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)

    // Done: one line in the chat; ctrl+o shows the final card.
    setState("deskRuns", "dk-card01", { ...run, status: "done", endedAt: t0 + 100_000, agents: run.agents.map((a) => ({ ...a, status: "done" as const })), phases: run.phases.map((p) => ({ ...p, done: p.total })) })
    frame = await setup.waitForFrame((f) => f.includes("◆ ultradesk sang-loc · xong"))
    expect(frame).not.toContain("◆ ultradesk · sang-loc · dk-card01")
    setState("expandTools", true)
    frame = await setup.waitForFrame((f) => f.includes("◆ ultradesk · sang-loc · dk-card01") && /✓ xong · 1m ?40s/.test(f))
    show(frame)
  } finally {
    setState("expandTools", false)
    setState("deskRuns", reconcile({}))
    const rest = Object.fromEntries(Object.entries(state.agents).filter(([id]) => !id.startsWith("ag-card")))
    setState("agents", reconcile(rest))
    setState("lines", (lines) => lines.slice(0, before))
  }
})
