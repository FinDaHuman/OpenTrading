import { beforeAll, expect, test } from "bun:test"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { until } from "./helpers/tui"
import os from "node:os"
import path from "node:path"
import { tuiApp, type TuiSetup } from "./helpers/tui-app"

// Sessions, /save and /export, permission modes, /undo, /permissions, /add-dir, the temp folder.
// Split from tui.test.tsx (#348): this file starts its own app on a fresh home (helpers/tui-app.tsx).
const app = await tuiApp({ connected: true })
const { home, cwd, runtime, osc52, copied, state, setState, loadConfig, saveConfig, currentSession, command, show } = app
let setup: TuiSetup
beforeAll(async () => {
  setup = app.setup
  // The session the first tests reopen and save: one turn with a current_time row (in tui.test.tsx,
  // earlier tests had left it).
  await setup.mockInput.typeText("MẤY-GIỜ rồi?")
  setup.mockInput.pressEnter()
  const answered = () => state.lines.some((l) => l.kind === "assistant" && l.text.includes("HẾT-CÂU-TRẢ-LỜI"))
  await until(() => !state.streaming && answered() && state.lines.some((l) => l.kind === "tool"), 15_000, "the first turn")
})

test("/new starts a fresh session; /sessions reopens the previous one with its tool rows", async () => {
  const before = state.lines.length
  expect(before).toBeGreaterThan(0)
  await setup.mockInput.typeText("/new")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => state.lines.length === 0 && state.history.length === 0)

  await setup.mockInput.typeText("/sessions")
  setup.mockInput.pressEnter()
  // The title shows at once, the list after the sessions are read ("Đang đọc…"): wait for the
  // rows, or Enter lands on an empty list (slow Windows runners, main CI after #103).
  // This folder's sessions first (the title names it); tab shows every folder and back.
  const list = await setup.waitForFrame((f) => f.includes("Phiên ·") && f.includes("lượt") && f.includes("tab mọi thư mục"))
  show(list)
  setup.mockInput.pressTab()
  await setup.waitForFrame((f) => f.includes("Phiên · mọi thư mục") && f.includes("lượt"))
  setup.mockInput.pressTab()
  await setup.waitForFrame((f) => f.includes("tab mọi thư mục") && f.includes("lượt"))
  setup.mockInput.pressEnter() // newest first: the session we just left
  await setup.waitFor(() => state.dialog === undefined && state.lines.length > 0)
  // The "reopened" note is the first line (may be scrolled out of view): check state.
  expect(state.lines[0]).toMatchObject({ kind: "info" })
  expect((state.lines[0] as { text: string }).text).toContain("Mở lại phiên")
  // The count is the session's own (its file's turn lines), the same /save and /export show.
  const told = Number(/· (\d+) lượt$/.exec((state.lines[0] as { text: string }).text)?.[1])
  expect(told).toBe(currentSession().turns)
  // Tool rows come back (the older ones may be scrolled out of view: check state too).
  expect(state.lines.some((l) => l.kind === "tool" && l.label.includes("current_time"))).toBe(true)
  const frame = await setup.waitForFrame((f) => f.includes("● "))
  expect(frame).not.toContain("<nhac_nho>")
  expect(state.history.length).toBeGreaterThan(0)
  expect(state.clock).toBeUndefined() // re-sent on the next turn
  show(frame)
})

test("/save copies the whole conversation as Markdown; /export writes it to a file, never replacing one unasked", async () => {
  const run = command

  // The OS command may not exist (CI without xclip): then OSC52 alone carries the copy.
  const copiedBefore = copied.length
  const oscBefore = osc52.length
  const saved = await run("/save")
  expect(saved.kind).toBe("notice")
  expect(saved.text).toMatch(/Đã copy toàn bộ hội thoại|OSC52/)
  expect(copied.length + osc52.length).toBeGreaterThan(copiedBefore + oscBefore)
  const md = copied.length > copiedBefore ? copied.at(-1)! : osc52.at(-1)!
  expect(md).toContain("## Bạn\n\nMẤY-GIỜ rồi?")
  expect(md).toContain("current_time")
  expect(md).toContain("**Input**")
  expect(md).toContain("HẾT-CÂU-TRẢ-LỜI")
  expect(md).not.toContain("<nhac_nho>")
  // The confirmation is a footer notice, never part of the conversation.
  expect(md).not.toContain("Đã copy toàn bộ")

  // No path: the session's file under OPENTRADING_HOME/exports; again replaces it.
  let line = await run("/export")
  expect(line.kind).toBe("info")
  const [defaultFile] = await readdir(path.join(home, "exports"))
  expect(defaultFile).toMatch(/\.md$/)
  expect(await Bun.file(path.join(home, "exports", defaultFile!)).text()).toBe(md)
  expect((await run("/export")).kind).toBe("info")

  // A path the user typed: ".md" added; an existing file is kept unless --force.
  const target = path.join(cwd, "xuat", "phien")
  line = await run(`/export ${target}`)
  expect(line.text).toContain(`${target}.md`)
  expect(await Bun.file(`${target}.md`).text()).toBe(md)
  line = await run(`/export ${target}`)
  expect(line.kind).toBe("error")
  expect(line.text).toContain("--force")
  expect((await run(`/export ${target} --force`)).kind).toBe("info")
})

test("shift+tab cycles ‖ chỉ đọc ↔ ▸ sửa có hỏi; a write in read-only shows its diff and can switch the mode", async () => {
  expect(runtime.permissions.mode).toBe("read-only")
  const lines = state.lines.length
  // The mode sits on the line under the prompt, with the cycle hint.
  // The mode line is indented 3 columns and starts with the mode glyph (dialog titles use 2).
  const modeRow = (f: string) => f.split("\n").find((r) => /^ {3}(‖|▸)/.test(r)) ?? ""
  await setup.waitForFrame((f) => modeRow(f).includes("‖ chỉ đọc (shift+tab đổi)"))
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((f) => modeRow(f).includes("▸ sửa có hỏi (shift+tab đổi)"))
  expect(runtime.permissions.mode).toBe("ask")

  // The first ▸▸ asks first, and the gate stays in ▸ until the user says yes.
  setup.mockInput.pressTab({ shift: true })
  let frame = await setup.waitForFrame((f) => f.includes("Bật chế độ ▸▸ tự động?"))
  show(frame)
  expect(modeRow(frame)).toContain("▸▸ tự động (chờ xác nhận)")
  expect(frame).toContain("Model duyệt có thể sai")
  expect(frame).toContain("giữ ▸ sửa có hỏi")
  expect(runtime.permissions.mode).toBe("ask")
  // Esc: no, stay in ▸.
  setup.mockInput.pressEscape()
  await setup.waitForFrame((f) => !f.includes("Bật chế độ ▸▸ tự động?") && modeRow(f).includes("▸ sửa có hỏi"))
  expect(runtime.permissions.mode).toBe("ask")
  // Shift+Tab inside the dialog skips auto and moves on to ‖.
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((f) => f.includes("Bật chế độ ▸▸ tự động?"))
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((f) => !f.includes("Bật chế độ ▸▸ tự động?") && modeRow(f).includes("‖ chỉ đọc"))
  expect(runtime.permissions.mode).toBe("read-only")

  // An approval that arrives meanwhile goes first; the dialog comes back after it.
  setup.mockInput.pressTab({ shift: true })
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((f) => f.includes("Bật chế độ ▸▸ tự động?"))
  const write = runtime.registry.get("write_file")!
  let decision = runtime.permissions.check(write, { path: "tui-optin.md", content: "x\n" }, new AbortController().signal, "write_file tui-optin.md", "c-optin")
  frame = await setup.waitForFrame((f) => f.includes("Cho phép chạy?"))
  expect(frame).not.toContain("Bật chế độ ▸▸ tự động?")
  setup.mockInput.pressEscape()
  expect((await decision).allow).toBe(false)
  await setup.waitForFrame((f) => f.includes("Bật chế độ ▸▸ tự động?"))
  expect(runtime.permissions.mode).toBe("ask")

  // Yes: auto from now on, remembered; the next time Shift+Tab goes straight to it.
  setup.mockInput.pressKey("1")
  await setup.waitFor(() => runtime.permissions.mode === "auto")
  await setup.waitFor(async () => (await loadConfig()).permissions?.autoAcknowledged === true)
  expect((await loadConfig()).permissions?.defaultMode).toBeUndefined()
  await setup.waitForFrame((f) => modeRow(f).includes("▸▸ tự động (shift+tab đổi)"))
  // /permissions keeps the explanation for later, while auto is on.
  await setup.mockInput.typeText("/permissions")
  setup.mockInput.pressEnter()
  frame = await setup.waitForFrame((f) => f.includes("Chế độ: ▸▸ tự động"))
  expect(frame).toContain("Model duyệt có thể sai")
  setup.mockInput.pressEscape()
  await setup.waitFor(() => state.dialog === undefined)
  setup.mockInput.pressTab({ shift: true })
  await setup.waitFor(() => runtime.permissions.mode === "read-only")
  setup.mockInput.pressTab({ shift: true })
  setup.mockInput.pressTab({ shift: true })
  await setup.waitFor(() => runtime.permissions.mode === "auto")
  expect(state.autoOptIn).toBeUndefined()
  setup.mockInput.pressTab({ shift: true })
  await setup.waitFor(() => runtime.permissions.mode === "read-only")
  // Nothing about the modes went to the transcript (only the denied write is recorded).
  expect(state.lines.slice(lines).filter((l) => "text" in l && /tự động|chỉ đọc|sửa có hỏi/i.test(l.text))).toEqual([])
  expect(state.lines.slice(lines)).toHaveLength(1)
  await saveConfig({ permissions: undefined })
  setState("autoAcknowledged", false)

  decision = runtime.permissions.check(write, { path: "tui-ke-hoach.md", content: "# Kế hoạch\nTheo dõi FPT\n" }, new AbortController().signal, "write_file tui-ke-hoach.md", "c-tui")
  frame = await setup.waitForFrame((f) => f.includes("đang ở chế độ ‖ chỉ đọc") && f.includes("+ # Kế hoạch"))
  show(frame)
  expect(frame).toContain("Có, và chuyển sang ▸ sửa có hỏi")
  expect(frame).toContain("(mới, 2 dòng)")
  expect(frame).not.toContain("Luôn cho phép")
  setup.mockInput.pressKey("2")
  expect(await decision).toEqual({ allow: true })
  expect(runtime.permissions.mode).toBe("ask")
  runtime.permissions.setMode("read-only")
})

test("--yolo: the red warning asks first and keeps the mode; yes turns on ▸▸▸ bypass, red on the mode line, in the Shift+Tab cycle", async () => {
  const gate = runtime.permissions
  const modeRow = (f: string) => f.split("\n").find((r) => /^ {3}(‖|▸)/.test(r)) ?? ""
  gate.bypassAvailable = true
  setState("yoloWarning", true)
  // A ▸▸ opt-in waiting behind (defaultMode "auto" never accepted) must not undo the yes below.
  setState("autoOptIn", { from: "read-only" })
  try {
    let frame = await setup.waitForFrame((f) => f.includes("CẢNH BÁO: OpenTrading đang chạy ở chế độ ▸▸▸ bỏ qua quyền"))
    show(frame)
    expect(frame).toContain("❯ 1. Không, thoát")
    expect(modeRow(frame)).toContain("▸▸▸ bỏ qua quyền (chờ xác nhận)")
    expect(frame).toContain("Vẫn chặn hoặc vẫn hỏi")
    expect(gate.mode).toBe("read-only")
    // Shift+Tab does not get past the warning.
    setup.mockInput.pressTab({ shift: true })
    await Bun.sleep(50)
    expect(gate.mode).toBe("read-only")
    setup.mockInput.pressKey("2")
    await setup.waitFor(() => gate.mode === "bypass")
    expect(state.autoOptIn).toBeUndefined()
    frame = await setup.waitForFrame((f) => modeRow(f).includes("▸▸▸ bỏ qua quyền (shift+tab đổi)"))
    expect(frame).not.toContain("CẢNH BÁO")
    // Nothing remembered: the next --yolo launch asks again.
    expect(JSON.stringify((await loadConfig()).permissions ?? {})).not.toContain("bypass")
    setup.mockInput.pressTab({ shift: true })
    await setup.waitFor(() => gate.mode === "read-only")
    setup.mockInput.pressTab({ shift: true })
    await setup.waitFor(() => gate.mode === "ask")
  } finally {
    setState("yoloWarning", false)
    gate.bypassAvailable = false
    gate.setMode("read-only")
  }
})

test("/undo lists and puts back the agent's file changes; /permissions lists rules and deletes one with d", async () => {
  const run = command
  const write = runtime.registry.get("write_file")!
  await write.execute({ path: "undo-me.md", content: "x\n" }, { signal: new AbortController().signal, callId: "u1" })
  const file = path.join(cwd, "undo-me.md")
  expect(await Bun.file(file).exists()).toBe(true)
  let line = await run("/undo")
  expect(line.text).toContain("undo-me.md")
  expect(line.text).toContain("tạo")
  const n = runtime.history.list()[0]!.n
  // The list stays in the transcript; the result is a footer notice.
  expect(line.kind).toBe("info")
  line = await run(`/undo ${n}`)
  expect(line).toMatchObject({ kind: "notice", level: "success" })
  expect(line.text).toContain("Đã xoá")
  expect(await Bun.file(file).exists()).toBe(false)
  expect(await run(`/undo ${n}`)).toMatchObject({ kind: "notice", level: "error" })

  await saveConfig({ permissions: { allow: [{ tool: "mcp__demo__echo", scope: "demo@x" }], deny: [{ tool: "write_file", pattern: "*bi-mat*" }] } })
  try {
    await setup.mockInput.typeText("/permissions")
    setup.mockInput.pressEnter()
    let frame = await setup.waitForFrame((f) => f.includes("Quyền · 2 quy tắc") && f.includes("mẫu *bi-mat*"))
    show(frame)
    expect(frame).toContain("Chế độ: ‖ chỉ đọc")
    // The header line is cut at the dialog's width: with a long TEMP the folder does not fit whole.
    const shown = frame.split("\n").find((l) => l.includes("Workspace: "))!.trim()
    expect(shown.length).toBeGreaterThan("Workspace: ".length)
    expect(`Workspace: ${cwd}`.startsWith(shown)).toBe(true)
    setup.mockInput.pressEnter() // the deny rule comes first
    frame = await setup.waitForFrame((f) => f.includes("d xoá"))
    setup.mockInput.pressKey("d")
    // The list shows 1 rule once the dialog has saved and read the config back; reading the
    // file while it is being replaced would race with that save.
    await setup.waitForFrame((f) => f.includes("Quyền · 1 quy tắc"))
    const saved = (await loadConfig()).permissions
    expect(saved?.deny ?? []).toHaveLength(0)
    expect(saved?.allow).toHaveLength(1)
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    await saveConfig({ permissions: undefined })
  }
})

test("/add-dir lists the workspace, adds a folder for the session or for good (--luu), refuses home", async () => {
  const run = command
  expect(await run("/add-dir")).toMatchObject({ kind: "info", text: expect.stringContaining(cwd) })
  const extra = path.join(cwd, "..", path.basename(cwd) + "-bctc")
  await mkdir(extra, { recursive: true })
  try {
    let line = await run(`/add-dir ${extra}`)
    expect(line).toMatchObject({ kind: "notice", level: "success" })
    expect(line.text).toContain("cho phiên này")
    expect(runtime.workspace.roots()).toContain(extra)
    expect(await run(`/add-dir ${extra}`)).toMatchObject({ kind: "notice", level: "error" })
    expect((await run(`/add-dir ${os.homedir()}`)).text).toContain("quá rộng")
    const kept = `${extra}-2`
    await mkdir(kept, { recursive: true })
    line = await run(`/add-dir ${kept} --luu`)
    expect(line.text).toContain("đã lưu")
    expect((await loadConfig()).workspace?.dirs).toEqual([kept])
    await saveConfig({ workspace: undefined })
    await rm(kept, { recursive: true, force: true })
  } finally {
    await rm(extra, { recursive: true, force: true })
  }
})

test("the session's temp folder: a size warning sits under the answer, /scratch shows the folder", async () => {
  const { Scratchpad } = await import("../src/core/fs/scratch")
  const pad = new Scratchpad(cwd, { tmp: path.join(home, "tmp") })
  pad.attach("tui-scratch")
  runtime.workspace.scratch = pad
  await saveConfig({ scratchpad: { warnMB: 0.001 } })
  try {
    const dir = pad.dir()!
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "lon.csv"), "x".repeat(5000))
    await setup.mockInput.typeText("Tính thử trong thư mục tạm")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => !state.streaming && state.lines.some((l) => l.kind === "warning"))
    const warning = state.lines.findLast((l) => l.kind === "warning") as { text: string }
    expect(warning.text).toContain("Thư mục tạm của dự án đã 5 KB")
    expect(warning.text).toContain(pad.project)
    // Under the answer: nothing but the done line between them.
    const at = state.lines.lastIndexOf(warning as never)
    expect(state.lines.slice(0, at).findLast((l) => l.kind !== "done")?.kind).toBe("assistant")
    const frame = await setup.waitForFrame((f) => f.includes("▲ Thư mục tạm của dự án"))
    show(frame)
    const line = await command("/scratch")
    expect(line.kind).toBe("info")
    expect(line.text).toContain(dir)
    expect(line.text).toContain("1 phiên")
  } finally {
    runtime.workspace.scratch = undefined
    await saveConfig({ scratchpad: undefined })
  }
})

test("/permissions: ctrl+r on an auto-mode block grants the retry and never lands in the list's filter; in the list r is a letter", async () => {
  const granted: string[] = []
  const realGrant = runtime.auto.grantRetry.bind(runtime.auto)
  runtime.auto.grantRetry = (d) => void granted.push(d.key)
  runtime.auto.recent.unshift({ at: Date.now(), tool: "shell", summary: "curl https://host-la.example", reason: "Gửi dữ liệu ra ngoài", key: "k-retry" })
  try {
    await setup.mockInput.typeText("/permissions")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((f) => f.includes("1 lần auto mode chặn") && f.includes("gõ để lọc"))
    // In the list r and d only filter.
    await setup.mockInput.typeText("rd")
    let frame = await setup.waitForFrame((f) => f.includes("› rd"))
    expect(granted).toEqual([])
    setup.mockInput.pressBackspace()
    setup.mockInput.pressBackspace()
    await setup.waitForFrame((f) => f.includes("gõ để lọc"))
    setup.mockInput.pressEnter()
    frame = await setup.waitForFrame((f) => f.includes("ctrl+r cho thử lại một lần"))
    // A plain r does nothing here; ctrl+r grants the retry.
    setup.mockInput.pressKey("r")
    await new Promise((r) => setTimeout(r, 100))
    expect(granted).toEqual([])
    setup.mockInput.pressKey("r", { ctrl: true })
    await setup.waitFor(() => granted.length > 0)
    frame = await setup.waitForFrame((f) => f.includes("1 lần auto mode chặn"))
    show(frame)
    expect(granted).toEqual(["k-retry"])
    expect(frame).toContain("gõ để lọc")
    expect(frame).not.toContain("› r")
    setup.mockInput.pressEscape()
    await setup.waitFor(() => state.dialog === undefined)
  } finally {
    runtime.auto.grantRetry = realGrant
    runtime.auto.recent.shift()
  }
})
