import { beforeAll, expect, test } from "bun:test"
import path from "node:path"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// /mcp, /tools and MCP prompts as slash commands.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { home, runtime, memory, chatCalls, state, setState, readJson, saveConfig, show, waitMcp } = app
let setup: TuiSetup
beforeAll(() => {
  setup = app.setup
})

test("/mcp: grouped list → server menu → tools → tool detail, esc steps back", async () => {
  await waitMcp(() => state.mcp[0]?.state === "connected")
  const bar = await setup.waitForFrame((f) => f.includes("MCP 1/1"))
  expect(bar).toContain("MCP 1/1")
  await setup.mockInput.typeText("/mcp")
  setup.mockInput.pressEnter()
  let frame = await setup.waitForFrame((f) => f.includes("Quản lý MCP server"))
  show(frame)
  expect(frame).toContain("1 server · 1 đang kết nối")
  expect(frame).toContain("Của bạn (")
  expect(frame).toMatch(/❯ demo · ✓ đã kết nối · 4 tool/)
  expect(frame).toContain("Có sẵn (đang tắt")
  expect(frame).toMatch(/context7 · ○ không cần đăng nhập/)
  expect(frame).toContain("+ Thêm server tuỳ chỉnh")
  // The panel replaces the prompt input.
  expect(frame).not.toContain("Hỏi về thị trường")

  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("demo · MCP server"))
  show(frame)
  expect(frame).toContain("Trạng thái")
  expect(frame).toContain("✓ đã kết nối · 4 tool")
  expect(frame).toContain("Lệnh")
  expect(frame).toContain("Khả năng")
  expect(frame).toContain("/demo:phan_tich")
  expect(frame).toMatch(/❯ 1\. Xem tool/)
  expect(frame).toContain("Kết nối lại")
  expect(frame).toContain("Tắt")

  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Tool của demo"))
  expect(frame).toMatch(/◇ add +\[chỉ đọc\]/)
  expect(frame).toMatch(/◆ ghi_chu +\[ghi\]/)
  // Labels are words in brackets, never emoji (⚠ rendered as a colour emoji in Windows Terminal).
  expect(frame).not.toContain("⚠")
  // The [label] column lines up whatever the name length.
  const labelCols = frame.split("\n").filter((l) => /[◇◆] \S+ +\[/.test(l)).map((l) => l.indexOf("["))
  expect(new Set(labelCols).size).toBe(1)
  for (let i = 0; i < 3; i++) setup.mockInput.pressArrow("down")
  await setup.waitForFrame((f) => f.includes("❯ ◆ ghi_chu"))
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Tên đầy đủ"))
  show(frame)
  expect(frame).toContain("[ghi]")
  expect(frame).toContain("mcp__demo__ghi_chu")
  expect(frame).toMatch(/• noi_dung \(bắt buộc\): string - Nội dung ghi chú/)

  // Wait between presses: two ESC bytes in one read ("\x1b\x1b") parse as a single
  // alt+escape keypress.
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Tool của demo") && f.includes("❯ ◆ ghi_chu"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("demo · MCP server"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Quản lý MCP server") && f.includes("❯ demo"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
}, 30_000)

test("/mcp server screen: a page-long error or prompt list never draws rows over each other", async () => {
  await waitMcp(() => state.mcp[0]?.state === "connected")
  const { state: was, error, tools, prompts: hadPrompts } = state.mcp[0]!
  const original = { state: was, error, tools: [...tools], prompts: [...hadPrompts] }
  const lines = (f: string) => f.split("\n")
  setup.resize(80, 24)
  try {
    // A long prompt list wraps under the value column instead of being cut at the edge.
    const prompts = Array.from({ length: 6 }, (_, i) => ({ name: `quy_trinh_rat_dai_so_${i}`, arguments: [] }))
    setState("mcp", 0, { prompts })
    await setup.mockInput.typeText("/mcp")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("❯ demo"))
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("demo · MCP server") && f.includes("Xem tool"))
    show(frame)
    // Short terminal: the list is cut to what fits ("… +N"), and the whole menu stays.
    expect(frame).toContain("/demo:quy_trinh_rat_dai_so_0")
    expect(frame).toMatch(/… \+\d+/)
    expect(frame).toContain("4. Xoá khỏi cấu hình")
    setup.resize(160, 40)
    frame = await setup.waitForFrame((f) => f.includes("/demo:quy_trinh_rat_dai_so_5"))
    show(frame)
    setup.resize(80, 24)

    // A raw HTML 502 body as the SDK reports it (the manager already shortens these; the
    // panel cleans whatever it is given too).
    const html = `Streamable HTTP error: Error POSTing to endpoint: <!DOCTYPE html>\n<html lang="en">\n${"  <meta name=x content=y>\n".repeat(40)}${"d09GMk9UVE8AAKewAAwAAAABa6QAAKdfAAEAAAAAAAAAAAAA".repeat(60)}`
    setState("mcp", 0, { state: "failed", error: html, tools: [], prompts: [] })
    frame = await setup.waitForFrame((f) => f.includes("Lỗi:") && f.includes("[trang HTML]"))
    expect(frame).not.toContain("<meta")
    // Any other page-long error (a stderr dump) is cut to what fits.
    setState("mcp", 0, { error: `stderr: ${"Traceback line with some details\n".repeat(200)}` })
    frame = await setup.waitForFrame((f) => f.includes("Lỗi: stderr") && f.includes("Kết nối lại"))
    // Scroll the menu: the bug showed while moving through it.
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressArrow("down")
    frame = await setup.waitForFrame((f) => f.includes("❯ 3. Xoá khỏi cấu hình"))
    show(frame)
    // Each field keeps its own line (label, then value), with nothing drawn over it.
    expect(frame).toMatch(/│ Trạng thái +✘ lỗi +│/)
    expect(lines(frame).find((l) => l.includes("Lệnh"))).toMatch(/^ *│ Lệnh +\S.*│ *$/)
    expect(lines(frame).find((l) => l.includes("Cấu hình"))).toMatch(/^ *│ Cấu hình +\S.*│ *$/)
    expect(frame).toMatch(/ 1\. Kết nối lại/)
    expect(frame).toMatch(/ 2\. Tắt/)
    expect(frame).toContain("esc quay lại")
    expect(lines(frame).filter((l) => l.includes("Lỗi:"))).toHaveLength(1)
    expect(frame).toContain("…")
  } finally {
    setState("mcp", 0, original)
    setup.resize(100, 32)
  }
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Quản lý MCP server"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
}, 30_000)

test("/mcp: space turns a server off and on (saved to mcp.json); catalog entries open their own screen", async () => {
  await setup.mockInput.typeText("/mcp")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("❯ demo"))
  setup.mockInput.pressKey(" ")
  await waitMcp(() => state.mcp[0]?.state === "disabled")
  let saved = await readJson<{ mcpServers: Record<string, { enabled?: boolean }> }>(path.join(home, "mcp.json"), { mcpServers: {} })
  expect(saved.mcpServers.demo!.enabled).toBe(false)
  await setup.waitForFrame((f) => f.includes("demo · ○ đã tắt"))
  setup.mockInput.pressKey(" ")
  await waitMcp(() => state.mcp[0]?.state === "connected")
  saved = await readJson(path.join(home, "mcp.json"), { mcpServers: {} })
  expect(saved.mcpServers.demo!.enabled).toBeUndefined()

  setup.mockInput.pressArrow("down")
  await setup.waitForFrame((f) => f.includes("❯ context7"))
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((f) => f.includes("Context7 · có sẵn, đang tắt"))
  show(frame)
  expect(frame).toContain("https://mcp.context7.com/mcp (http)")
  expect(frame).toContain("enter để bật")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("❯ context7") && f.includes("Quản lý MCP server"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
}, 30_000)

test("/mcp: enabling an OAuth catalog entry connects, then starts the login (no stuck screen)", async () => {
  const { MCP_CATALOG } = await import("../src/core/mcp/catalog")
  const { startHttpServer } = await import("./fixtures/remote-mcp")
  const remote = startHttpServer({ oauth: true })
  const notion = MCP_CATALOG.find((e) => e.id === "notion")!
  const build = notion.build
  notion.build = () => ({ type: "http", url: remote.url })
  const realLogin = runtime.mcp.login.bind(runtime.mcp)
  const logins: string[] = []
  runtime.mcp.login = async (name, opts) => {
    logins.push(name)
    opts.onUrl("https://login.example/authorize?client_id=x&state=y")
    await new Promise<void>((resolve) => opts.signal?.addEventListener("abort", () => resolve(), { once: true }))
    throw new Error("Đã huỷ đăng nhập.")
  }
  try {
    await setup.mockInput.typeText("/mcp")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("❯ demo"))
    for (let i = 0; i < 3; i++) setup.mockInput.pressArrow("down") // context7, github, notion
    await setup.waitForFrame((f) => f.includes("❯ notion"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("Notion · có sẵn, đang tắt") && f.includes("enter để bật"))
    setup.mockInput.pressEnter()
    await waitMcp(() => logins.length === 1)
    expect(logins).toEqual(["notion"])
    expect(state.mcp.find((s) => s.name === "notion")?.state).toBe("needs-auth")
    const frame = await setup.waitForFrame((f) => f.includes("Đang đăng nhập notion") && f.includes("login.example"))
    show(frame)
    // c copies the link; the login view has no input for it to land in.
    expect(frame).toContain("(c để copy)")
    setup.mockInput.pressKey("c")
    await setup.waitForFrame((f) => f.includes("Đang đăng nhập notion") && !f.includes("› c"))
    // Esc cancels the login and returns to the server screen.
    setup.mockInput.pressEscape()
    await setup.waitForFrame((f) => f.includes("notion · MCP server"))
    // Then remove it again (global servers can be removed from the panel).
    // Menu for a server that needs auth: 1 Đăng nhập · 2 Kết nối lại · 3 Tắt · 4 Xoá…
    const menu = await setup.waitForFrame((f) => f.includes("4. Xoá khỏi cấu hình"))
    expect(menu).toContain("1. Đăng nhập")
    await setup.mockInput.typeText("4")
    await setup.waitForFrame((f) => f.includes("Xoá \"notion\""))
    setup.mockInput.pressEnter()
    await waitMcp(() => !state.mcp.some((s) => s.name === "notion"))
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    notion.build = build
    runtime.mcp.login = realLogin
    remote.stop()
  }
}, 30_000)

test("/mcp: r reconnects the highlighted server; the panel has no filter and the prompt gets nothing", async () => {
  const restarted: string[] = []
  const realRestart = runtime.mcp.restart.bind(runtime.mcp)
  runtime.mcp.restart = async (name) => void restarted.push(name)
  try {
    await setup.mockInput.typeText("/mcp")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("❯ demo"))
    setup.mockInput.pressKey("r")
    await setup.waitFor(() => restarted.length > 0)
    expect(restarted).toEqual(["demo"])
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
    // Nothing was typed into the prompt under the panel.
    await setup.waitForFrame((f) => f.includes("Hỏi về thị trường"))
  } finally {
    runtime.mcp.restart = realRestart
  }
})

test("/mcp: a pasted token is never shown on screen", async () => {
  await setup.mockInput.typeText("/mcp")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("❯ demo"))
  for (let i = 0; i < 2; i++) setup.mockInput.pressArrow("down") // context7, github
  await setup.waitForFrame((f) => f.includes("❯ github"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("GitHub Personal Access Token"))
  await setup.mockInput.pasteBracketedText("ghp_SECRET_1234567890")
  const frame = await setup.waitForFrame((f) => f.includes("21 ký tự"))
  show(frame)
  expect(frame).not.toContain("ghp_SECRET")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Quản lý MCP server"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("/tools lists built-in and MCP tools", async () => {
  // Tool search forced on: the demo server's tools are marked as deferred.
  await saveConfig({ toolSearch: "on" })
  let frame: string
  try {
    await setup.mockInput.typeText("/tools")
    setup.mockInput.pressEnter()
    // 6 core built-ins (current_time, load_skill, ask_user, todo_write, tool_search, read_file)
    // + 16 local tools (glob_files, grep_files, write_file, edit_file, shell, chart, session, watchlist_local, web, spawn_subagent, send_message, stop_agent, doctor_local, desk_run)
    // + read_result + 4 from the demo MCP server (memory is off here: no memory_read)
    frame = await setup.waitForFrame((f) => f.includes("Tool · 27") && f.includes("16 tool hoãn"))
    show(frame)
    // Regression for the 01/10 screenshot: every tool is exactly one line, long descriptions
    // end in "…" instead of wrapping mid-word, and the mark column is straight.
    const rows = frame.split("\n").filter((l) => /^ {2}(❯ |  )[◇◆] \S/.test(l))
    expect(rows.length).toBeGreaterThanOrEqual(7)
    expect(new Set(rows.map((r) => r.search(/[◇◆]/))).size).toBe(1)
    // Labels sit in their own right-hand column, so descriptions still start at one cell.
    expect(new Set(rows.map((r) => r.search(/\[(chỉ đọc|ghi|không hoàn tác)\]/))).size).toBe(1)
    const timeRow = rows.find((r) => r.includes("current_time"))!
    expect(timeRow).toMatch(/…\s+\[chỉ đọc\]\s*$/)
    expect(frame).not.toMatch(/^\s+Asia\/H/m)
    expect(frame).toContain("Có sẵn")
    // 3 demo tools (add is alwaysLoad) + 21 optional local tools (incl. glob_files/grep_files/write_file/edit_file) (incl. web_search/web_fetch) (chart, session, watchlist, doctor, send_message, stop_agent); desk_run is on demand, shell always declared (arithmetic)
    expect(frame).toContain("16 tool hoãn: model chỉ thấy tên")
    expect(timeRow).not.toContain("hoãn · ")
    // read_file and spawn_subagent sit below the fold now.
    expect(rows.find((r) => r.includes(" glob_files "))).toContain("hoãn · ")
    expect(rows.find((r) => r.includes(" chart_render "))).toContain("hoãn · ")
    // ↑ from the first row wraps to the last: the MCP group sits below the fold (memory is off: no Memory group).
    setup.mockInput.pressArrow("up")
    frame = await setup.waitForFrame((f) => f.includes("MCP · demo") && f.includes("27/27"))
    show(frame)
    const tail = frame.split("\n").filter((l) => /^ {2}(❯ |  )[◇◆] \S/.test(l))
    expect(tail.find((r) => r.includes(" echo "))).toContain("hoãn · ")
    setup.mockInput.pressArrow("down")
    await setup.waitForFrame((f) => f.includes("1/27"))
  } finally {
    await saveConfig({ toolSearch: undefined })
  }
  // Enter shows the tool's details; esc goes back to the list, esc again closes.
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Chi tiết tool") && f.includes("Tên đầy đủ"))
  // First row is ask_user (built-ins sort by name); native zod schemas show their parameters.
  expect(frame).toContain("ask_user")
  expect(frame).toMatch(/• questions \(bắt buộc\): array/)
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => f.includes("Tool · 27"))
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
})

test("a lone '/' + enter is never sent to the model", async () => {
  const before = chatCalls.length
  const lines = state.lines.length
  await setup.mockInput.typeText("/ ")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => !f.includes("› / "))
  expect(chatCalls.length).toBe(before)
  expect(state.lines.length).toBe(lines)
})

test("MCP prompts are slash commands: suggested, argument-checked, sent as the user's message", async () => {
  await setup.mockInput.typeText("/demo:")
  const frame = await setup.waitForFrame((f) => f.includes("/demo:phan_tich <ma> [goc_nhin]"))
  expect(frame).toContain("Phân tích nhanh một mã cổ phiếu")
  show(frame)
  for (let i = 0; i < "/demo:".length; i++) setup.mockInput.pressBackspace()
  await setup.waitForFrame((f) => !f.includes("enter chạy · tab điền"))

  // The prompt needs <ma>: enter on it in the list fills "/demo:phan_tich " and shows the arguments.
  await setup.mockInput.typeText("/demo:phan_tich")
  setup.mockInput.pressEnter()
  const hint = await setup.waitForFrame((f) => f.includes("› /demo:phan_tich ") && f.includes("<ma> [goc_nhin]"))
  show(hint)
  // Enter again without arguments: the usage error.
  setup.mockInput.pressEnter()
  await setup.waitForFrame((f) => f.includes("Thiếu ma"))

  await setup.mockInput.typeText("/demo:phan_tich vcb biên lãi gộp")
  setup.mockInput.pressEnter()
  const sent = await setup.waitForFrame((f) => f.includes("Phân tích nhanh mã VCB, trọng tâm: biên lãi gộp"))
  expect(sent).toContain("Prompt /demo:phan_tich của server demo")
  // Sent as the user's own message (the provider's reply does not matter here).
  expect(state.lines.some((l) => l.kind === "user" && l.text.startsWith("Phân tích nhanh mã VCB, trọng tâm: biên lãi gộp."))).toBe(true)
  for (let i = 0; i < 100 && state.streaming; i++) await new Promise((r) => setTimeout(r, 50))
})
