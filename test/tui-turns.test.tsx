import { beforeAll, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { createEffect, createRoot } from "solid-js"
import { until } from "./helpers/tui"
import path from "node:path"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// A turn on screen: tool rows, retries, the stop gate, harness markup, streaming; folder trust; the loop guard.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { home, cwd, runtime, mock, state, setState, LOADED_PREFIX, SOURCE_FAILED_PREFIX, setKey, currentSession, show, waitMcp, lastTurnAnswers, turnEnded } = app
let setup: TuiSetup
beforeAll(async () => {
  setup = app.setup
  // A first turn, titled, before the tests that check a turn's lines (in tui.test.tsx earlier tests had
  // chatted). The first turn's own receipt can say "chưa cập nhật được danh sách phiên" when the
  // generated title lands while its index line is written (a race of its own, #396).
  await setup.mockInput.typeText("Chào")
  setup.mockInput.pressEnter()
  await until(() => !state.streaming && state.lines.some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI")), 15_000, "the first turn")
  await until(() => currentSession().title !== "Chào" && !currentSession().hasPending, 15_000, "the first turn's title")
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
  const frame = await setup.waitForFrame((f) => f.includes("Danh tính & bất biến") && f.includes("Danh sách skill"))
  // INVESTOR.md is still the untouched template /profile wrote: its examples are comments, nothing is sent.
  expect(frame).not.toContain("Hồ sơ nhà đầu tư")
  expect(frame).toContain("hạng B")
  show(frame)
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/context shows the investor profile layer once INVESTOR.md has real content", async () => {
  const file = path.join(home, "INVESTOR.md")
  const template = await Bun.file(file).text()
  try {
    await Bun.write(file, "# Hồ sơ nhà đầu tư\n\nKhẩu vị rủi ro: thấp. Chỉ mua cổ phiếu ngân hàng, giữ trên 1 năm.\n")
    await setup.mockInput.typeText("/context")
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((f) => f.includes("Danh tính & bất biến") && f.includes("Hồ sơ nhà đầu tư"))
    expect(frame).toContain("Hồ sơ nhà đầu tư")
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    await Bun.write(file, template)
  }
})

test("a retried request waits on the working row (with its deadline) and leaves nothing in the transcript", async () => {
  await setKey("nvidia", "nvapi-good-key")
  mock.overloaded = 2
  // Every retry the working row sees, in order.
  const seen: { attempt: number; until: number; label: string }[] = []
  const stop = createRoot((dispose) => {
    createEffect(() => {
      const retry = state.activity?.retry
      if (retry) seen.push({ attempt: retry.attempt, until: retry.until, label: retry.label })
    })
    return dispose
  })
  try {
    const before = state.lines.length
    await setup.mockInput.typeText("QUÁ-TẢI thử")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.lines.slice(before).some((l) => l.kind === "user" && l.text === "QUÁ-TẢI thử"))
    await setup.waitFor(() => !state.streaming)
    const turn = state.lines.slice(before)
    expect(turn.some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI"))).toBe(true)
    expect(turn.filter((l) => "text" in l && /thử lại|lỗi tạm thời/.test(l.text))).toEqual([])
    expect(seen.map((r) => r.attempt)).toEqual([1, 2])
    expect(seen[0]!.label).toBe("provider lỗi tạm thời (503)")
    // OPENTRADING_RETRY_SCALE=0: the deadline is the real (zero) wait, not the nominal delay.
    expect(seen[0]!.until).toBeLessThanOrEqual(Date.now())
    expect(state.activity).toBeUndefined()
  } finally {
    stop()
  }
})

test("a real retry wait counts down on the working row above the prompt, then is gone", async () => {
  await setKey("nvidia", "nvapi-good-key")
  const saved = process.env.OPENTRADING_RETRY_SCALE
  // The first backoff (2–2.5 s) really waits half of that: long enough to see the row.
  process.env.OPENTRADING_RETRY_SCALE = "0.5"
  mock.overloaded = 1
  try {
    await setup.mockInput.typeText("QUÁ-TẢI đếm ngược")
    setup.mockInput.pressEnter()
    let frame = ""
    for (let i = 0; i < 100 && !frame.includes("thử lại sau"); i++) {
      await new Promise((r) => setTimeout(r, 20))
      await setup.renderOnce()
      frame = setup.captureCharFrame()
    }
    show(frame)
    expect(frame).toMatch(/△ Provider lỗi tạm thời \(503\) · thử lại sau [12]s \(lần 1\/4\) · esc dừng/)
    const rows = frame.split("\n")
    expect(rows.findIndex((r) => r.includes("thử lại sau"))).toBeLessThan(rows.findIndex((r) => r.includes("› ")))
    await waitMcp(() => !state.streaming)
    const answered = state.lines.findIndex((l) => l.kind === "user" && l.text === "QUÁ-TẢI đếm ngược")
    expect(state.lines.slice(answered).some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI"))).toBe(true)
    frame = await setup.waitForFrame((f) => f.includes("QUÁ-TẢI đếm ngược") && !f.includes("đang trả lời…"))
    expect(frame).not.toContain("thử lại sau")
    expect(frame).not.toContain("lỗi tạm thời")
  } finally {
    if (saved === undefined) delete process.env.OPENTRADING_RETRY_SCALE
    else process.env.OPENTRADING_RETRY_SCALE = saved
    mock.overloaded = 0
  }
})

test("a tool call renders as a ● row with its result under ⎿, then the answer", async () => {
  await setKey("nvidia", "nvapi-good-key")
  await setup.mockInput.typeText("MẤY-GIỜ rồi?")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("HẾT-CÂU-TRẢ-LỜI") && f.includes("● current_time()"))
  // Claude Code style: ❯ for the user, ● for answers and calls, ⎿ for the result.
  expect(frame).toContain("  ⎿  ")
  expect(frame).toContain("❯ MẤY-GIỜ rồi?")
  expect(frame).not.toContain("◆ OpenTrading")
  expect(frame).toContain("Vietnam time")
  show(frame)
  await setup.waitFor(() => !state.streaming)
  const roles = state.history.map((m) => m.role)
  expect(roles.slice(-4)).toEqual(["user", "assistant", "tool", "assistant"])
})

test("a promise the stop gate sends back leaves the screen: the notice stays, the answer shows once (13/11 m3)", async () => {
  const prompt = "HỨA-GIỜ bây giờ?"
  await setup.mockInput.typeText(prompt)
  setup.mockInput.pressEnter()
  const frame = await turnEnded(prompt)
  show(frame)
  expect(frame).not.toContain("Mình sẽ lấy giờ hiện tại")
  expect(frame).toContain("Model nói sẽ lấy thêm dữ liệu")
  expect(frame).toContain("● current_time()")
  // The screen holds what a reopened session shows.
  const { shown, stored } = lastTurnAnswers(prompt)
  expect(shown).toEqual(stored)
  expect(shown).toHaveLength(1)
})

test("a preamble beside a tool call, then an empty step: the preamble leaves the screen as it leaves history", async () => {
  const prompt = "DẠO-ĐẦU mấy giờ?"
  await setup.mockInput.typeText(prompt)
  setup.mockInput.pressEnter()
  const frame = await turnEnded(prompt)
  show(frame)
  // History dropped the preamble with the empty step (dropFinalText); the screen used to keep it.
  expect(frame).not.toContain("LỜI-DẠO-ĐẦU")
  expect(frame).toContain("● current_time()")
  const { shown, stored } = lastTurnAnswers(prompt)
  expect(stored.join(" ")).not.toContain("LỜI-DẠO-ĐẦU")
  expect(shown).toEqual(stored)
})

test("a draft beside a closing todo_write is taken off the screen; its todo row stays", async () => {
  const prompt = "NHÁP-TODO phân tích FPT"
  await setup.mockInput.typeText(prompt)
  setup.mockInput.pressEnter()
  const frame = await turnEnded(prompt)
  show(frame)
  expect(frame).not.toContain("Kết quả đã lấy")
  expect(frame).toContain("bản nháp")
  const from = state.lines.findLastIndex((l) => l.kind === "user" && l.text === prompt)
  expect(state.lines.slice(from).some((l) => l.kind === "tool" && l.callId === "call_draft_todo")).toBe(true)
  const { shown, stored } = lastTurnAnswers(prompt)
  expect(shown).toEqual(stored)
})

test("ctrl+o wraps a long error line instead of cutting it with …", async () => {
  const long = "Lỗi máy chủ MCP: " + "kết nối bị đóng giữa chừng ".repeat(8) + "ĐUÔI-LỖI-CUỐI"
  const before = state.lines.length
  setState("lines", (lines) => [...lines, { kind: "tool", callId: "c-wrap", name: "demo", label: "demo_loi()", status: "error", output: `${long}\ndòng hai` }])
  try {
    let frame = await setup.waitForFrame((f) => f.includes("● demo_loi()") && f.includes("dòng hai"))
    // Collapsed: one row per line, cut at the width.
    expect(frame).not.toContain("ĐUÔI-LỖI-CUỐI")
    setState("expandTools", true)
    frame = await setup.waitForFrame((f) => f.includes("ĐUÔI-LỖI-CUỐI"))
    show(frame)
    // The continuation rows hang under the text, not under ⎿.
    const rows = frame.split("\n")
    const head = rows.findIndex((r) => r.includes("⎿  Lỗi máy chủ MCP"))
    expect(head).toBeGreaterThanOrEqual(0)
    // Columns 0–1 may hold the animated background; compare from the gutter on.
    const col = rows[head]!.indexOf("Lỗi máy chủ")
    const next = rows[head + 1]!
    expect(next.slice(2, col).trim()).toBe("")
    expect(next[col]).not.toBe(" ")
  } finally {
    setState("expandTools", false)
    setState("lines", (lines) => lines.slice(0, before))
  }
})

test("a deferred tool loaded by its first call reads as a grey note, wrapped, not a red error", async () => {
  const output = `${LOADED_PREFIX}mcp__opentrading__market_movers\nTool mcp__opentrading__market_movers chưa có trong bước này nên chưa chạy; đã nạp xong — gọi lại đúng lệnh với tên mcp__opentrading__market_movers. CUỐI-CÂU`
  const before = state.lines.length
  setState("lines", (lines) => [...lines, { kind: "tool", callId: "c-loaded", name: "market_movers", label: "market_movers()", status: "error", output }])
  try {
    const frame = await setup.waitForFrame((f) => f.includes("● market_movers()") && f.includes("CUỐI-CÂU"))
    show(frame)
  } finally {
    setState("lines", (lines) => lines.slice(0, before))
  }
})

test("a session saved before the English runtime text (20/11/2026) still shows its blocks, refusals and loaded tools as such", async () => {
  // The texts exactly as denial.ts and the tool loader wrote them in Vietnamese.
  const blocked = "Auto mode chặn shell [Git phá huỷ]: Xoá nhánh remote khi người dùng chưa nêu tên NHÁNH-CŨ.\n\nĐừng làm đúng việc này bằng tool hay lệnh khác (write_file, edit_file, tool MCP, subagent, script, lệnh viết lại): HƯỚNG-DẪN-CŨ."
  const refused =
    "Người dùng từ chối chạy tool này (auto mode đã chặn [Gửi dữ liệu ra ngoài]: Gửi file ra HOST-CŨ). Lời nhắn của người dùng: SAU\n\nĐừng làm đúng việc này bằng tool hay lệnh khác."
  const loaded = "Đã nạp tool: mcp__opentrading__market_movers\nTool mcp__opentrading__market_movers chưa có trong bước này nên chưa chạy. NẠP-CŨ"
  const before = state.lines.length
  setState("lines", (lines) => [
    ...lines,
    { kind: "tool", callId: "c-old-block", name: "shell", label: "shell git push origin --delete x", status: "error", output: blocked },
    { kind: "tool", callId: "c-old-refused", name: "mcp__x__create", label: "x · create", status: "error", output: refused },
    { kind: "tool", callId: "c-old-loaded", name: "market_movers", label: "market_movers()", status: "error", output: loaded },
  ])
  try {
    const frame = await setup.waitForFrame((f) => f.includes("NHÁNH-CŨ") && f.includes("HOST-CŨ") && f.includes("NẠP-CŨ"))
    show(frame)
    expect(frame).toContain("✘ Auto mode chặn shell [Git phá huỷ]")
    expect(frame).toContain("/permissions để cho thử lại")
    expect(frame).toContain('✘ Đã từ chối (auto mode đã chặn [Gửi dữ liệu ra ngoài]: Gửi file ra HOST-CŨ) — "SAU"')
    // The deferred tool its first call loaded: the grey one-line note, not the loader line.
    expect(frame).not.toContain("Đã nạp tool:")
    // Collapsed like a new session: the old guidance for the model stays out of view.
    expect(frame).not.toContain("HƯỚNG-DẪN-CŨ")
  } finally {
    setState("lines", (lines) => lines.slice(0, before))
  }
})

test("a source that failed shows its notice, not the envelope, and no green dot", async () => {
  const notice = `${SOURCE_FAILED_PREFIX} vn_fundamentals: nguồn quá thời gian. Có thể thử lại một lần ở bước sau. CUỐI-CÂU`
  const output = `${notice}\n{"availability":"unavailable","ENVELOPE":1}`
  const before = state.lines.length
  setState("lines", (lines) => [...lines, { kind: "tool", callId: "c-source", name: "vn_fundamentals", label: "vn_fundamentals()", status: "ok", output }])
  try {
    const frame = await setup.waitForFrame((f) => f.includes("● vn_fundamentals()") && f.includes("CUỐI-CÂU"))
    expect(frame).not.toContain("ENVELOPE")
  } finally {
    setState("lines", (lines) => lines.slice(0, before))
  }
})

test("an auto-mode block reads as one line with its rule and reason; ctrl+o shows what the model was told", async () => {
  const { blockedMessage, deniedMessage } = await import("../src/core/permission")
  const blocked = blockedMessage("shell", { label: "Git phá huỷ", reason: "Xoá nhánh remote khi người dùng chưa nêu tên NHÁNH-X" })
  const refused = deniedMessage({ reason: "user", auto: { label: "Gửi dữ liệu ra ngoài", reason: "Gửi file ra HOST-LẠ" } }, { tool: "mcp__x__create" })
  const before = state.lines.length
  setState("lines", (lines) => [
    ...lines,
    { kind: "tool", callId: "c-block", name: "shell", label: "shell git push origin --delete x", status: "error", output: blocked },
    { kind: "tool", callId: "c-refused", name: "mcp__x__create", label: "x · create", status: "error", output: refused },
  ])
  try {
    let frame = await setup.waitForFrame((f) => f.includes("NHÁNH-X") && f.includes("HOST-LẠ"))
    show(frame)
    expect(frame).toContain("✘ Auto mode blocked shell [Git phá huỷ]")
    expect(frame).toContain("/permissions để cho thử lại")
    expect(frame).toContain("✘ Đã từ chối (auto mode had blocked it [Gửi dữ liệu ra ngoài]")
    // The guidance for the model stays out of the collapsed view.
    expect(frame).not.toContain("Do not do this same thing")
    setState("expandTools", true)
    frame = await setup.waitForFrame((f) => f.includes("Do not do this same thing"))
    show(frame)
  } finally {
    setState("expandTools", false)
    setState("lines", (lines) => lines.slice(0, before))
  }
})

test("a new auto-mode block raises one toast; a block handed to the user, or a count change, does not", async () => {
  const { watchAutoBlocks, AUTO_BLOCK_KEY } = await import("../src/tui/auto-notice")
  const listeners = new Set<() => void>()
  const auto = {
    recent: [] as { tool: string }[],
    consecutive: 0,
    total: 0,
    onChange: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
  }
  const seen: { key: string; text: string }[] = []
  const off = watchAutoBlocks(auto as never, (n) => seen.push(n))
  const fire = () => listeners.forEach((l) => l())
  fire() // request counter only
  auto.recent.unshift({ tool: "shell" })
  auto.consecutive = 1
  fire()
  fire() // the same block again (e.g. a pause notice)
  auto.recent.unshift({ tool: "write_file" })
  auto.consecutive = 3 // reached the limit: the approval dialog says it
  fire()
  off()
  expect(seen).toEqual([expect.objectContaining({ key: AUTO_BLOCK_KEY, text: "shell bị auto mode chặn · /permissions" })])
})

test("the context size follows each step's usage while a turn is still running", async () => {
  await setKey("nvidia", "nvapi-good-key")
  let release = () => {}
  mock.usageGate = new Promise<void>((resolve) => (release = resolve))
  try {
    await setup.mockInput.typeText("ĐẾM-TOKEN đi")
    setup.mockInput.pressEnter()
    // The tool step reported 50000 in + 10 out; the answer is still held.
    await setup.waitFor(() => state.contextTokens === 50_010)
    expect(state.streaming).toBe(true)
  } finally {
    release()
    mock.usageGate = undefined
  }
  await setup.waitFor(() => !state.streaming)
})

test("harness markup a model writes never shows, not even half a tag while it streams (13/11)", async () => {
  await setKey("nvidia", "nvapi-good-key")
  // Every text the answer line held while it streamed.
  const seen = new Set<string>()
  const stop = createRoot((dispose) => {
    createEffect(() => {
      const last = state.lines.at(-1)
      if (last?.kind === "assistant") seen.add(last.text)
    })
    return dispose
  })
  const before = state.lines.length
  try {
    await setup.mockInput.typeText("MARKUP-GIẢ nhé")
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.streaming && state.lines.slice(before).some((l) => l.kind === "assistant" && l.text.includes("HPG-ĐÃ-XONG")))
  } finally {
    stop()
  }
  const frame = await setup.waitForFrame((f) => f.includes("HPG-ĐÃ-XONG"))
  show(frame)
  for (const text of [...seen, frame]) {
    expect(text).not.toContain("BÍ-MẬT-NHẮC-VIỆC")
    expect(text).not.toContain("todo_write")
    expect(text).not.toMatch(/<\/?nhac_n/)
  }
  expect(frame).toContain("Mở đầu.")
  const answer = state.lines.findLast((l) => l.kind === "assistant")
  expect(answer?.kind === "assistant" && answer.text).toBe("Mở đầu.\nHPG-ĐÃ-XONG, xem `<bat_bien>` trong code.")
  expect(JSON.stringify(state.history.at(-1))).not.toContain("BÍ-MẬT")
})

// Regression: every token was its own store write, so the answer was re-laid-out per token.
test("streamed text reaches the transcript in batches, whole and in order", async () => {
  await setKey("nvidia", "nvapi-good-key")
  const seen = new Set<string>()
  const stop = createRoot((dispose) => {
    createEffect(() => {
      const last = state.lines.at(-1)
      if (last?.kind === "assistant") seen.add(last.text)
    })
    return dispose
  })
  const before = state.lines.length
  try {
    await setup.mockInput.typeText("NHIỀU-MẨU nhé")
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.streaming && state.lines.slice(before).some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI")))
  } finally {
    stop()
  }
  const answer = state.lines.findLast((l) => l.kind === "assistant")
  expect(answer?.kind === "assistant" && answer.text).toBe(Array.from({ length: 60 }, (_, i) => `m${i} `).join("") + "HẾT-CÂU-TRẢ-LỜI")
  // 61 deltas, a handful of writes.
  expect(seen.size).toBeLessThan(10)
})

test("a folder with its own skills/agents asks for trust first; skip leaves them out, trust loads them", async () => {
  const { projectExtras } = await import("../src/core/folder-trust")
  const { reloadAgents } = await import("../src/tui/dialogs/agents")
  const own = path.join(cwd, ".opentrading")
  await mkdir(path.join(own, "skills", "ky-nang-thu-muc"), { recursive: true })
  await writeFile(path.join(own, "skills", "ky-nang-thu-muc", "SKILL.md"), "---\nname: ky-nang-thu-muc\ndescription: Skill của thư mục\n---\nThân\n")
  await mkdir(path.join(own, "agents"), { recursive: true })
  await writeFile(path.join(own, "agents", "agent-thu-muc.md"), "---\nname: agent-thu-muc\ndescription: Agent của thư mục\n---\nChỉ dẫn.\n")
  const saved = { skills: state.skills, skillProblems: state.skillProblems }
  try {
    const extras = (await projectExtras(cwd))!
    expect(extras).toMatchObject({ skills: 1, agents: 1 })
    // What startup does for an untrusted folder (the app is mounted once for the whole file).
    setState({ projectAllowed: false, folderTrust: extras })
    // Spaces folded: the folder's path comes first on that line, and a long one wraps "1 skill, 1 agent".
    let frame = await setup.waitForFrame((f) => f.includes("Thư mục này có skill/agent riêng") && f.replace(/\s+/g, " ").includes("1 skill, 1 agent"))
    show(frame)
    expect(frame).toContain("Tin cậy và nạp")
    expect(frame).not.toContain("Hỏi về thị trường") // the prompt waits

    // Skip: nothing of the folder loads, /skills says why; reloading agents keeps them out.
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.folderTrust === undefined && state.projectSkipped !== undefined)
    await reloadAgents(runtime)
    expect(state.agentDefs.some((a) => a.name === "agent-thu-muc")).toBe(false)
    expect(state.skills.some((s) => s.name === "ky-nang-thu-muc")).toBe(false)
    await setup.mockInput.typeText("/skills")
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes("1 skill của thư mục (.opentrading/skills) chưa nạp"))
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)

    // Trust: saved for next time, both load at once.
    setState({ folderTrust: extras })
    await setup.waitForFrame((f) => f.includes("Thư mục này có skill/agent riêng"))
    setup.mockInput.pressEnter()
    await setup.waitFor(() => state.skills.some((s) => s.name === "ky-nang-thu-muc" && s.source === "project"))
    await setup.waitFor(() => state.agentDefs.some((a) => a.name === "agent-thu-muc"))
    expect(state.projectAllowed).toBe(true)
    expect(state.projectSkipped).toBeUndefined()
    const { FolderTrust } = await import("../src/core/folder-trust")
    expect(await new FolderTrust().isTrusted(cwd)).toBe(true)
  } finally {
    await rm(own, { recursive: true, force: true })
    setState({ ...saved, folderTrust: undefined, projectAllowed: true, projectSkipped: undefined })
    await reloadAgents(runtime)
  }
})

// Last: its transcript (tool rows + the stock answer) would satisfy later tests' frame waits.
test("the third identical call asks before it runs; esc stops the loop and the turn answers", async () => {
  await setKey("nvidia", "nvapi-good-key")
  const before = state.lines.length
  await setup.mockInput.typeText("LẶP-LẠI giờ")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("cùng tham số 3 lần liên tiếp"))
  show(frame)
  expect(frame).toContain("Cho phép chạy?")
  setup.mockInput.pressEscape()
  await setup.waitFor(() => !state.streaming)
  const turn = state.lines.slice(before)
  const rows = turn.filter((l) => l.kind === "tool")
  expect(rows).toHaveLength(3)
  expect(rows.map((l) => l.kind === "tool" && l.status)).toEqual(["ok", "ok", "error"])
  expect(turn.some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI"))).toBe(true)
})
