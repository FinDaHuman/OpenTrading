import { afterAll, afterEach, expect, spyOn, test } from "bun:test"
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-session-write-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home

// Namespace import: the seam (sessionFiles) is spied on as a property of the module's object.
const store = await import("../src/core/session/store")
const { listSessions, loadSession, Session, sessionsDir } = store

afterAll(async () => {
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const spies: { mockRestore(): void }[] = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})
function spy<K extends keyof typeof store.sessionFiles>(name: K) {
  const s = spyOn(store.sessionFiles, name)
  spies.push(s)
  return s
}

const info = { cwd: "/w", provider: "groq", model: "m1" }
const turn = (n: number): ModelMessage[] => [
  { role: "user", content: `câu ${n}` },
  { role: "assistant", content: `đáp ${n}` },
]
const fail = (message: string, code: string) => Object.assign(new Error(message), { code })
const fileOf = (s: import("../src/core/session/store").Session) => path.join(sessionsDir(), s.file!)
const lines = async (file: string) => (await readFile(file, "utf8")).split("\n").filter((l) => l.trim())
/**
 * The lines of an exit report about these sessions only. settleForExit reports every session this
 * process left, and the tests before this one (in any order) leave theirs.
 */
const about = (report: string | undefined, ...sessions: import("../src/core/session/store").Session[]) =>
  report
    ?.split("\n")
    .filter((line) => sessions.some((s) => line.startsWith(`Phiên "${s.title || s.id}"`)))
    .join("\n") || undefined

/** A session with `n` turns already on disk. */
async function sessionWith(n: number) {
  const s = Session.create()
  for (let i = 1; i <= n; i++) expect((await s.appendTurn(turn(i), info)).saved).toEqual([i])
  return s
}

test("TC-001: a first turn that cannot be written is retried with the next one; the meta line comes first", async () => {
  // A year that has no folder yet (other tests write sessions dated now), long past so its session never
  // shows as the newest in another test's list.
  let year0 = 2001
  while (existsSync(path.join(sessionsDir(), String(year0)))) year0++
  const s = Session.create(new Date(`${year0}-10-29T08:00:00Z`))
  // The year folder the session goes into, from the session's own date, blocked by a file.
  const year = path.relative(sessionsDir(), s.dir).split(path.sep)[0]!
  const blocker = path.join(sessionsDir(), year)
  await mkdir(sessionsDir(), { recursive: true })
  await writeFile(blocker, "chặn")

  const r1 = await s.appendTurn(turn(1), info)
  expect(r1).toMatchObject({ saved: [], pending: [1], stopped: false })
  expect(r1.error).toBeInstanceOf(Error)
  expect(s.path).toBeUndefined()

  await rm(blocker)
  const r2 = await s.appendTurn(turn(2), info)
  expect(r2).toMatchObject({ saved: [1, 2], pending: [], indexPending: false })
  expect(r2.error).toBeUndefined()
  expect((await s.appendTurn(turn(3), info)).saved).toEqual([3])

  const entries = (await lines(s.path!)).map((l) => JSON.parse(l))
  expect(entries[0]).toMatchObject({ type: "meta", id: s.id })
  expect(entries.filter((e) => e.type === "meta")).toHaveLength(1)
  expect((await loadSession(s.id)).messages).toEqual([...turn(1), ...turn(2), ...turn(3)])
  expect((await listSessions()).find((x) => x.id === s.id)).toMatchObject({ turns: 3 })
})

test("a later failure carries the latest attempt's error, not the first one (scenario 3)", async () => {
  const s = await sessionWith(2)
  spy("append")
    .mockImplementationOnce(async () => {
      throw fail("lỗi thứ nhất", "EIO")
    })
    .mockImplementationOnce(async () => {
      throw fail("lỗi thứ hai", "EIO")
    })
  const r3 = await s.appendTurn(turn(3), info)
  expect(r3.pending).toEqual([3])
  expect(r3.error?.message).toBe("lỗi thứ nhất")
  const r4 = await s.appendTurn(turn(4), info)
  expect(r4.pending).toEqual([3, 4])
  expect(r4.error?.message).toBe("lỗi thứ hai")
  expect(await s.flush()).toMatchObject({ saved: [3, 4], pending: [] })
  expect((await loadSession(s.id)).messages).toEqual([1, 2, 3, 4].flatMap(turn))
})

test("a compaction that failed is written before the next turn; resume starts from it (scenario 4)", async () => {
  const s = await sessionWith(1)
  spy("append").mockImplementationOnce(async () => {
    throw fail("đĩa bận", "EBUSY")
  })
  const summary: ModelMessage[] = [{ role: "user", content: "TÓM TẮT" }]
  const rc = await s.appendCompact({ trigger: "manual", before: 2, after: 1, messages: summary })
  expect(rc.pendingCompactions).toBe(1)
  const r2 = await s.appendTurn(turn(2), info)
  expect(r2).toMatchObject({ saved: [2], pendingCompactions: 0, pending: [] })
  expect((await loadSession(s.id)).messages).toEqual([...summary, ...turn(2)])
})

/** Writes two whole lines and half of the third for real, then fails like a full disk. */
const partialAppend = async (file: string, text: string) => {
  const parts = text.split("\n")
  await appendFile(file, `${parts[0]}\n${parts[1]}\n${parts[2]!.slice(0, 10)}`)
  throw fail("no space left on device", "ENOSPC")
}

test("TC-002: a write cut halfway is truncated back, then caught up once", async () => {
  const s = await sessionWith(1)
  const before = (await stat(fileOf(s))).size
  spy("append").mockImplementationOnce(partialAppend)
  const r2 = await s.appendTurn([...turn(2), { role: "assistant", content: "thêm" }], info)
  expect(r2).toMatchObject({ pending: [2], stopped: false })
  expect((await stat(fileOf(s))).size).toBe(before)
  expect((await s.appendTurn(turn(3), info)).saved).toEqual([2, 3])
  expect((await loadSession(s.id)).messages).toEqual([...turn(1), ...turn(2), { role: "assistant", content: "thêm" }, ...turn(3)])
})

test("YC-018: when truncating fails too, nothing more goes into that file", async () => {
  const s = await sessionWith(1)
  const append = spy("append").mockImplementationOnce(partialAppend)
  spy("truncate").mockImplementationOnce(async () => {
    throw fail("resource busy or locked", "EBUSY")
  })
  const r2 = await s.appendTurn([...turn(2), { role: "assistant", content: "thêm" }], info)
  expect(r2).toMatchObject({ stopped: true, pending: [2] })
  expect((r2.error as { code?: string }).code).toBe("EBUSY")
  const onDisk = await readFile(fileOf(s), "utf8")
  const calls = append.mock.calls.length
  const r3 = await s.appendTurn(turn(3), info)
  expect(r3).toMatchObject({ stopped: true, pending: [2, 3], saved: [] })
  expect(append.mock.calls.length).toBe(calls)
  expect(await readFile(fileOf(s), "utf8")).toBe(onDisk)
})

test("YC-005: an index line that failed is written with the next turn", async () => {
  const realAppend = store.sessionFiles.append
  let failIndex = true
  spy("append").mockImplementation(async (file: string, text: string) => {
    if (failIndex && file.endsWith("index.jsonl")) {
      failIndex = false
      throw fail("index bị khoá", "EBUSY")
    }
    return realAppend(file, text)
  })
  const s = Session.create()
  const r1 = await s.appendTurn(turn(1), info)
  expect(r1).toMatchObject({ saved: [1], indexPending: true })
  expect(r1.error?.message).toBe("index bị khoá")
  const r2 = await s.appendTurn(turn(2), info)
  expect(r2).toMatchObject({ saved: [2], indexPending: false })
  expect((await listSessions()).find((x) => x.id === s.id)).toMatchObject({ turns: 2 })
})

test("TC-003: a session file cut mid-line by a crash keeps the next turn whole", async () => {
  const s = await sessionWith(2)
  const file = fileOf(s)
  await truncate(file, (await stat(file)).size - 25)
  const resumed = Session.continue((await listSessions()).find((x) => x.id === s.id)!)
  expect((await resumed.appendTurn(turn(3), info)).saved).toEqual([3])
  const messages = (await loadSession(s.id)).messages
  expect(messages).toContainEqual({ role: "user", content: "câu 3" })
  expect(messages).toContainEqual({ role: "assistant", content: "đáp 3" })
})

test("a torn last index line does not swallow the next session's line", async () => {
  await mkdir(sessionsDir(), { recursive: true })
  await appendFile(path.join(sessionsDir(), "index.jsonl"), '{"id":"cut","file":"x')
  const s = await sessionWith(1)
  expect((await listSessions()).map((x) => x.id)).toContain(s.id)
})

test("TC-004 (core): flush resolves only once turns not awaited are on disk", async () => {
  const s = Session.create()
  void s.appendTurn(turn(1), info)
  void s.appendTurn(turn(2), info)
  const r = await s.flush()
  expect(r).toMatchObject({ pending: [], pendingCompactions: 0, indexPending: false, stopped: false })
  expect((await loadSession(s.id)).messages).toEqual([...turn(1), ...turn(2)])
})

test("TC-008: a session file in today's format reads back the same and takes new turns", async () => {
  const id = "20260915-090000-tc08"
  const rel = "2026/09/" + id + ".jsonl"
  const ts = "2026-09-15T09:00:00.000Z"
  const handwritten = [
    { type: "meta", format: 1, id, createdAt: ts, cwd: "/w" },
    { type: "message", ts, message: { role: "user", content: "Giá FPT?" } },
    { type: "message", ts, message: { role: "assistant", content: "Cần tra tool." } },
    { type: "turn_end", ts, provider: "groq", model: "m1", contextTokens: 120 },
  ]
  await mkdir(path.join(sessionsDir(), "2026", "09"), { recursive: true })
  await writeFile(path.join(sessionsDir(), rel), handwritten.map((e) => JSON.stringify(e)).join("\n") + "\n")
  const summary = { id, file: rel, title: "Giá FPT?", createdAt: ts, updatedAt: ts, turns: 1, cwd: "/w" }
  await appendFile(path.join(sessionsDir(), "index.jsonl"), "\n" + JSON.stringify(summary) + "\n")
  const loaded = await loadSession(id)
  expect(loaded.messages).toEqual([
    { role: "user", content: "Giá FPT?" },
    { role: "assistant", content: "Cần tra tool." },
  ])
  expect(loaded.contextTokens).toBe(120)
  const resumed = Session.continue(loaded.summary)
  expect((await resumed.appendTurn(turn(2), info)).saved).toEqual([2])
  expect((await loadSession(id)).messages).toHaveLength(4)
})

test("R18: two turns written by one drain are each the writer's own: nothing is reported as caught up", async () => {
  const s = await sessionWith(1)
  // Queued back to back: the first drain writes both.
  const [r2, r3] = await Promise.all([s.appendTurn(turn(2), info), s.appendTurn(turn(3), info)])
  expect(r2.saved).toEqual([2, 3])
  expect(tui.receiptLines(s, r2)).toEqual([])
  expect(tui.receiptLines(s, r3)).toEqual([])
})

test("R23: another writer's line that landed between our size check and our failed write is not cut", async () => {
  const s = await sessionWith(1)
  const file = fileOf(s)
  const theirs = JSON.stringify({ type: "message", ts: "x", message: { role: "user", content: "của B" } }) + "\n"
  spy("append").mockImplementationOnce(async (f: string, text: string) => {
    await appendFile(f, theirs) // a second window on the same session
    await appendFile(f, text.slice(0, 20))
    throw fail("no space left on device", "ENOSPC")
  })
  const cut = spy("truncate")
  const r2 = await s.appendTurn(turn(2), info)
  expect(r2).toMatchObject({ stopped: true, pending: [2] })
  expect(cut).not.toHaveBeenCalled()
  expect(await readFile(file, "utf8")).toContain(theirs)
  expect((await loadSession(s.id)).messages).toContainEqual({ role: "user", content: "của B" })
})

// The TUI side: what the user is told from a receipt, and the bounded waits on switch and exit.
const tui = await import("../src/tui/session")
const { ToolRegistry } = await import("../src/core/tools/registry")
type Receipt = import("../src/core/session/store").SaveReceipt
const receipt = (r: Partial<Receipt>): Receipt => ({ saved: [], pending: [], pendingCompactions: 0, pendingRedactions: 0, indexPending: false, stopped: false, ...r })
const texts = (lines: { text?: string }[]) => lines.map((l) => l.text)

test("the TUI words each receipt: pending, caught up (once), stopped (once), index; another session by name", () => {
  const disk = new Error("ổ đầy")
  // The current session is not named. A receipt that leaves no state behind: other test files share this session.
  const index = receipt({ saved: [2], indexPending: true, error: new Error("index bị khoá") })
  expect(texts(tui.receiptLines(tui.currentSession(), index))).toEqual([
    "Đã lưu lượt nhưng chưa cập nhật được danh sách phiên: index bị khoá. Sẽ thử lại.",
  ])
  const s = Session.create()
  s.title = "Định giá HPG"
  expect(texts(tui.receiptLines(s, receipt({ pending: [3, 4], error: disk })))).toEqual([
    'Phiên "Định giá HPG": chưa lưu được lượt 3–4: ổ đầy. Sẽ thử lại khi thoát hoặc khi mở lại phiên này.',
  ])
  // Caught up: only turns once reported unsaved, and only once.
  expect(texts(tui.receiptLines(s, receipt({ saved: [3, 4, 5] })))).toEqual(['Phiên "Định giá HPG": đã lưu bù lượt 3–4.'])
  expect(tui.receiptLines(s, receipt({ saved: [6] }))).toEqual([])
  // Its own session: "said once" is remembered per session.
  const t = Session.create()
  t.title = "Định giá HPG"
  const stopped = receipt({ pending: [5], stopped: true, error: new Error("resource busy or locked") })
  expect(texts(tui.receiptLines(t, stopped))).toEqual([
    'Ngừng lưu phiên "Định giá HPG" từ lượt 5: không khôi phục được file sau lần ghi lỗi (resource busy or locked). Các lượt sau của phiên này không được lưu.',
  ])
  expect(tui.receiptLines(t, receipt({ pending: [5, 6], stopped: true, error: new Error("x") }))).toEqual([])
  // R19: stopped on a compaction, no turn waiting: no turn number is made up.
  const u = Session.create()
  u.title = "Nén"
  expect(texts(tui.receiptLines(u, receipt({ pendingCompactions: 1, stopped: true, error: disk })))).toEqual([
    'Ngừng lưu phiên "Nén": không khôi phục được file sau lần ghi lỗi (ổ đầy). Các lượt sau của phiên này không được lưu.',
  ])
})

test("R19: leaving a session names everything still unsaved, never '0 lượt'", () => {
  const disk = new Error("ổ đầy")
  const other = Session.create()
  other.title = "Phiên cũ"
  expect(tui.leavingLine(other, receipt({ pending: [4, 5], error: disk }))?.text).toBe('Phiên "Phiên cũ" còn 2 lượt chưa lưu được: ổ đầy.')
  expect(tui.leavingLine(other, receipt({ indexPending: true, error: disk }))?.text).toBe(
    'Phiên "Phiên cũ" chưa vào được danh sách phiên (/sessions): ổ đầy.',
  )
  expect(tui.leavingLine(other, receipt({ pendingCompactions: 1, stopped: true, error: disk }))?.text).toBe(
    'Phiên "Phiên cũ" còn 1 bản nén hội thoại chưa lưu được: ổ đầy.',
  )
  expect(tui.leavingLine(other, receipt({ stopped: true, error: disk }))?.text).toBe('Phiên "Phiên cũ" đã ngừng lưu sau lần ghi lỗi: ổ đầy.')
  expect(tui.leavingLine(other, receipt({}))).toBeUndefined()
})

test("R18: a turn caught up by the title's write is reported there, once", async () => {
  const s = await sessionWith(1)
  spy("append").mockImplementationOnce(async () => {
    throw fail("ổ đầy", "ENOSPC")
  })
  expect(texts(tui.receiptLines(s, await s.appendTurn(turn(2), info)))).toEqual([
    'Phiên "câu 1": chưa lưu được lượt 2: ổ đầy. Sẽ thử lại khi thoát hoặc khi mở lại phiên này.',
  ])
  const titled = await s.setTitle("Định giá FPT")
  expect(titled.saved).toEqual([2])
  expect(texts(tui.receiptLines(s, titled))).toEqual(['Phiên "Định giá FPT": đã lưu bù lượt 2.'])
  expect(tui.receiptLines(s, await s.appendTurn(turn(3), info))).toEqual([])
})

test("R18: a catch-up whose receipt nobody reported is said at the next report", async () => {
  const s = await sessionWith(1)
  spy("append").mockImplementationOnce(async () => {
    throw fail("ổ đầy", "ENOSPC")
  })
  tui.receiptLines(s, await s.appendTurn(turn(2), info))
  await s.setTitle("Định giá FPT") // receipt dropped
  expect(texts(tui.receiptLines(s, await s.appendTurn(turn(3), info)))).toEqual(['Phiên "Định giá FPT": đã lưu bù lượt 2.'])
})

test("R20: /save and /export say which turns the transcript lacks", async () => {
  const s = await sessionWith(1)
  spy("append").mockImplementation(async () => {
    throw fail("ổ đầy", "ENOSPC")
  })
  await s.appendTurn(turn(2), info)
  const transcript = await tui.transcriptOfCurrent({ registry: new ToolRegistry() } as never, s)
  expect(transcript?.turns).toBe(1)
  expect(transcript?.unsaved).toBe('Phiên "câu 1" còn 1 lượt chưa lưu được: ổ đầy.')
})

test("R22: resuming the session being written waits for its writes and keeps one writer", async () => {
  const s = await sessionWith(2)
  const realAppend = store.sessionFiles.append
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  spy("append").mockImplementationOnce(async (file: string, text: string) => {
    await gate
    return realAppend(file, text)
  })
  void s.appendTurn(turn(3), info)
  setTimeout(release, 50)
  const same = await tui.openForResume(s, s.id)
  expect(same.session).toBe(s)
  expect(same.loaded.messages).toEqual([1, 2, 3].flatMap(turn))
  const other = await sessionWith(1)
  const elsewhere = await tui.openForResume(s, other.id)
  expect(elsewhere.session).not.toBe(s)
  expect(elsewhere.session.id).toBe(other.id)
})

test("R14: a hung write does not hold up switching; the old session finishes into its own file and says so by name", async () => {
  const old = await sessionWith(4)
  old.title = "Định giá HPG"
  const realAppend = store.sessionFiles.append
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  spy("append").mockImplementationOnce(async (file: string, text: string) => {
    await gate
    return realAppend(file, text)
  })
  void old.appendTurn(turn(5), info)
  let late!: (r: Receipt) => void
  const lateReceipt = new Promise<Receipt>((r) => (late = r))
  const started = Date.now()
  expect(await tui.settleSession(old, 100, late)).toBe("timeout")
  expect(Date.now() - started).toBeLessThan(1_000)

  const fresh = Session.create()
  expect((await fresh.appendTurn(turn(9), info)).saved).toEqual([1])
  expect(fresh.file).not.toBe(old.file)

  release()
  const r = await lateReceipt
  expect(texts(tui.receiptLines(old, r))).toEqual(['Phiên "Định giá HPG": đã lưu bù lượt 5.'])
  expect((await loadSession(old.id)).messages).toEqual([1, 2, 3, 4, 5].flatMap(turn))
  expect((await loadSession(fresh.id)).messages).toEqual(turn(9))
})

test("exit: the line printed when turns stay unsaved, or when writing did not finish in time", async () => {
  // Not the TUI module's current session, which other test files share.
  const s = Session.create()
  s.title = "Thoát"
  const realAppend = store.sessionFiles.append
  // Fails on every attempt: settleForExit retries what is pending.
  const full = spy("append").mockImplementation(async () => {
    throw fail("ổ đầy", "ENOSPC")
  })
  await s.appendTurn(turn(1), info)
  expect(about(await tui.settleForExit(2000, s), s)).toBe('Phiên "Thoát" còn 1 lượt chưa lưu được: ổ đầy.')
  full.mockRestore()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  spy("append").mockImplementationOnce(async (file: string, text: string) => {
    await gate
    return realAppend(file, text)
  })
  void s.appendTurn(turn(2), info)
  // R21: whole seconds, the same line app.tsx prints when its own deadline wins.
  expect(about(await tui.settleForExit(100, s), s)).toBe(tui.exitTimeoutText(s))
  expect(tui.exitTimeoutText(s)).toBe('Phiên "Thoát": chưa ghi xong trong 2 giây khi thoát; lượt cuối có thể chưa được lưu.')
  release()
  expect(about(await tui.settleForExit(2000, s), s)).toBeUndefined()
})

// Review round 2.

/** Holds the next append until `release()`; then it writes for real. */
function holdNextAppend() {
  const realAppend = store.sessionFiles.append
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  spy("append").mockImplementationOnce(async (file: string, text: string) => {
    await gate
    return realAppend(file, text)
  })
  return release
}

test("review 2 #1: resuming a session left with a write still running reuses its object, after the write lands", async () => {
  const s = await sessionWith(3)
  const other = await sessionWith(1)
  const release = holdNextAppend()
  void s.appendTurn(turn(4), info)
  // Left by /new or resume while turn 4 hangs: it goes on writing in the background.
  await tui.openForResume(s, other.id, 50)
  setTimeout(release, 50)
  const back = await tui.openForResume(other, s.id)
  expect(back.session).toBe(s)
  expect(back.loaded.messages).toEqual([1, 2, 3, 4].flatMap(turn))
})

test("review 2 #4: exit also waits for, and reports, sessions left with writes still running", async () => {
  const s = await sessionWith(1)
  s.title = "Bỏ lại"
  const fresh = Session.create()
  const elsewhere = await sessionWith(1)
  const release = holdNextAppend()
  void s.appendTurn(turn(2), info)
  await tui.openForResume(s, elsewhere.id, 50)
  expect(about(await tui.settleForExit(100, fresh), s)).toBe(tui.exitTimeoutText(s))
  release()
  expect(about(await tui.settleForExit(2000, fresh), s)).toBeUndefined()
})

test("review 2 #2: a left session with turns it could not save is not reopened without them", async () => {
  const s = await sessionWith(2)
  s.title = "Còn lượt"
  const other = await sessionWith(1)
  const full = spy("append").mockImplementation(async () => {
    throw fail("ổ đầy", "ENOSPC")
  })
  await s.appendTurn(turn(3), info)
  // Generous deadlines: every write here ends (fails or lands), and the outcome under test is not a
  // timeout. 100 ms was passed by the retries alone on a busy machine ("chưa ghi xong").
  await tui.openForResume(s, other.id, 5_000)
  await expect(tui.openForResume(other, s.id, 5_000)).rejects.toThrow('Phiên "Còn lượt" còn 1 lượt chưa lưu được')
  full.mockRestore()
  // Once saved, it reopens.
  expect((await s.flush()).pending).toEqual([])
  expect((await tui.openForResume(other, s.id, 5_000)).session).toBe(s)
})

test("review 2 #3: a size check that fails for a moment after a failed write is retried, not taken as a stop", async () => {
  const s = await sessionWith(1)
  const before = (await stat(fileOf(s))).size
  const realSize = store.sessionFiles.size
  let calls = 0
  spy("size").mockImplementation(async (file: string) => {
    // The first check after the failed append: the file is held for a moment.
    if (++calls === 2) throw fail("resource busy or locked", "EBUSY")
    return realSize(file)
  })
  spy("append").mockImplementationOnce(partialAppend)
  const r2 = await s.appendTurn([...turn(2), { role: "assistant", content: "thêm" }], info)
  expect(r2).toMatchObject({ stopped: false, pending: [2] })
  expect((await stat(fileOf(s))).size).toBe(before)
})

test("review 2 #5: a session that stops during the wait when leaving says it stopped", async () => {
  const s = await sessionWith(1)
  s.title = "Ngừng khi rời"
  const elsewhere = await sessionWith(1)
  spy("append")
    .mockImplementationOnce(async () => {
      throw fail("ổ đầy", "ENOSPC")
    })
    // The retry inside the wait: half written, and the cut fails.
    .mockImplementationOnce(partialAppend)
  spy("truncate").mockImplementationOnce(async () => {
    throw fail("resource busy or locked", "EBUSY")
  })
  await s.appendTurn(turn(2), info)
  const { left } = await tui.openForResume(s, elsewhere.id, 2000)
  expect(texts(left).join("\n")).toContain('Ngừng lưu phiên "Ngừng khi rời"')
})

// Review round 3.

/** A session whose turn 2 could not be cut back after a half write: it saves nothing more. */
async function stoppedSession(title: string) {
  const s = await sessionWith(1)
  s.title = title
  spy("append").mockImplementationOnce(partialAppend)
  spy("truncate").mockImplementationOnce(async () => {
    throw fail("resource busy or locked", "EBUSY")
  })
  expect((await s.appendTurn([...turn(2), { role: "assistant", content: "thêm" }], info)).stopped).toBe(true)
  return s
}

test("R41: a title that arrives while the first index line is being written still reaches the index", async () => {
  const realAppend = store.sessionFiles.append
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let indexStarted!: () => void
  const started = new Promise<void>((r) => (indexStarted = r))
  let held = false
  spy("append").mockImplementation(async (file: string, text: string) => {
    if (!held && file.endsWith("index.jsonl")) {
      held = true
      indexStarted()
      await gate
    }
    return realAppend(file, text)
  })
  const s = Session.create()
  const first = s.appendTurn(turn(1), info)
  await started
  const titled = s.setTitle("Định giá FPT")
  release()
  await Promise.all([first, titled])
  expect((await listSessions()).find((x) => x.id === s.id)?.title).toBe("Định giá FPT")
})

test("R42: a session that stopped saving is not reopened, and the refusal says why trying again will not help", async () => {
  const s = await stoppedSession("Đã ngừng")
  const elsewhere = await sessionWith(1)
  await tui.openForResume(s, elsewhere.id, 100)
  await expect(tui.openForResume(elsewhere, s.id, 100)).rejects.toThrow(
    'Phiên "Đã ngừng" đã ngừng lưu trong lần chạy này nên không mở lại được; phần đã lưu sẽ mở lại được sau khi khởi động lại OpenTrading.',
  )
})

test("R44: a wrong id is refused before leaving the current session, so nothing it had to say is lost", async () => {
  const s = await sessionWith(1)
  spy("append").mockImplementationOnce(async () => {
    throw fail("ổ đầy", "ENOSPC")
  })
  tui.receiptLines(s, await s.appendTurn(turn(2), info))
  await expect(tui.openForResume(s, "khong-co-phien-nay", 100)).rejects.toThrow("Không tìm thấy phiên")
  expect(texts(tui.receiptLines(s, await s.flush()))).toEqual(['Phiên "câu 1": đã lưu bù lượt 2.'])
})

test("R45: one Session object per session id: reopening a session left earlier reuses it, written or not", async () => {
  const a = await sessionWith(1)
  const b = await sessionWith(1)
  await tui.openForResume(a, b.id, 100)
  const back = await tui.openForResume(b, a.id, 100)
  expect(back.session).toBe(a)
  // And b, left in turn, comes back as the same object too.
  expect((await tui.openForResume(a, b.id, 100)).session).toBe(b)
})

test("R46: a stopped session keeps no compaction content in memory", async () => {
  const s = await stoppedSession("Nén khi ngừng")
  const receipt = await s.appendCompact({ trigger: "manual", before: 2, after: 1, messages: [{ role: "user", content: "TÓM TẮT" }] })
  expect(receipt).toMatchObject({ stopped: true, pendingCompactions: 1 })
  const queue = (s as unknown as { queue: { kind: string; lines: unknown[] }[] }).queue
  expect(queue.filter((p) => p.kind === "compact").map((p) => p.lines)).toEqual([[]])
})

test("a /resume prefix that matches two sessions, one of them open: told to use a longer id, nothing switched or written", async () => {
  // Ids start with the second of creation. A run of this test before this one in the same process
  // (bun test --rerun-each) left two open sessions at that second in src/tui/session.ts, which made the
  // prefix match 4: each run takes the next second.
  const runs = ((globalThis as { __resumePrefixRuns?: number }).__resumePrefixRuns ?? 0) + 1
  ;(globalThis as { __resumePrefixRuns?: number }).__resumePrefixRuns = runs
  const at = new Date(Date.parse("2026-09-20T03:04:05Z") + runs * 1000)
  const a = Session.create(at)
  const b = Session.create(at)
  expect(a.id.slice(0, 15)).toBe(b.id.slice(0, 15))
  await a.appendTurn(turn(1), info)
  await b.appendTurn(turn(1), info)
  // b is the session being written (opened in this run), a is only in the list.
  const before = [await readFile(fileOf(a)), await readFile(fileOf(b))]
  const prefix = a.id.slice(0, 15)
  await expect(tui.openForResume(b, prefix, 50)).rejects.toThrow(`Tiền tố "${prefix}" khớp 2 phiên:`)
  await expect(tui.openForResume(b, prefix, 50)).rejects.toThrow("Dùng id dài hơn.")
  const after = [await readFile(fileOf(a)), await readFile(fileOf(b))]
  expect(after[0]!.equals(before[0]!)).toBe(true)
  expect(after[1]!.equals(before[1]!)).toBe(true)
  // The full id still opens the one asked for, and its own writer.
  const opened = await tui.openForResume(b, a.id, 50)
  expect(opened.session.id).toBe(a.id)
})

test("/save and /export give the session's own turn count, not the index line's (one write behind)", async () => {
  const s = await sessionWith(1)
  const realAppend = store.sessionFiles.append
  // The turn lands, its index line does not.
  spy("append").mockImplementation(async (file: string, text: string) => {
    if (file.endsWith("index.jsonl")) throw fail("index bị khoá", "EBUSY")
    return realAppend(file, text)
  })
  expect((await s.appendTurn(turn(2), info)).indexPending).toBe(true)
  const transcript = await tui.transcriptOfCurrent({ registry: new ToolRegistry() } as never, s)
  expect(transcript?.turns).toBe(2)
})

test("on exit, 'not written within 2 seconds' only for a session that still has writes waiting", async () => {
  const s = await sessionWith(1)
  expect(tui.exitTimeoutLine(s)).toBeUndefined()
  spy("append").mockImplementation(async () => {
    throw fail("ổ đầy", "ENOSPC")
  })
  await s.appendTurn(turn(2), info)
  expect(tui.exitTimeoutLine(s)).toBe(tui.exitTimeoutText(s))
})
