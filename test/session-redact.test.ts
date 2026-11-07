import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ModelMessage } from "ai"
import { maskedLesson, renderLessonBlock } from "../src/core/memory/notebook/render"
import { createRedactionCheck } from "../src/core/memory/redaction/check"
import { useTempStores } from "./helpers/memory-store"

// Isolated state dir before core modules read it.
const home = await mkdtemp(path.join(os.tmpdir(), "ot-session-redact-"))
const previous = process.env.OPENTRADING_HOME
process.env.OPENTRADING_HOME = home

// Namespace import: the seam (sessionFiles) is spied on as a property of the module's object.
const store = await import("../src/core/session/store")
const { loadSession, Session, sessionsDir } = store

afterAll(async () => {
  if (previous === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = previous
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const spies: { mockRestore(): void }[] = []
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
})
function spy<K extends keyof typeof store.sessionFiles>(name: K) {
  const s = spyOn(store.sessionFiles, name)
  spies.push(s)
  return s
}

const stores = useTempStores()
const info = { cwd: "/w", provider: "groq", model: "m1" }
const fail = (message: string, code: string) => Object.assign(new Error(message), { code })
const AT = "2026-11-01T08:00:00.000Z"

const lesson = (id: number, marker: string) =>
  renderLessonBlock({ id, version: 1, title: "Cắt lỗ", summary: marker, appliesToDisplay: [], tags: [], createdAt: AT })
/** A turn whose memory_read result is the lesson block. */
const readTurn = (n: number, block: string): ModelMessage[] => [
  { role: "user", content: `câu ${n}` },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: `c${n}`, toolName: "memory_read", input: { lesson: 7 } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: `c${n}`, toolName: "memory_read", output: { type: "text", value: block } }] },
  { role: "assistant", content: `đáp ${n}` },
]
const plain = (n: number): ModelMessage[] => [
  { role: "user", content: `câu ${n}` },
  { role: "assistant", content: `đáp ${n}` },
]
const fileOf = (s: import("../src/core/session/store").Session) => path.join(sessionsDir(), s.file!)
const entries = async (file: string) =>
  (await readFile(file, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      // A torn line left by a crash stays in the file; the reader skips it, and so does this.
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
const turnsIn = async (file: string) => (await entries(file)).filter((e) => e.type === "turn_end").map((e) => e.turn)
const ITEM7 = [{ kind: "lesson" as const, id: 7, versions: [1] }]

/** A handwritten session file and its index line, the way an older build left them. */
async function handwritten(id: string, lines: object[], turns: number) {
  const rel = `2026/09/${id}.jsonl`
  const ts = "2026-09-15T09:00:00.000Z"
  await mkdir(path.join(sessionsDir(), "2026", "09"), { recursive: true })
  await writeFile(
    path.join(sessionsDir(), rel),
    [{ type: "meta", format: 1, id, createdAt: ts, cwd: "/w" }, ...lines].map((e) => JSON.stringify(e)).join("\n") + "\n",
  )
  const summary = { id, file: rel, title: "cũ", createdAt: ts, updatedAt: ts, turns, cwd: "/w" }
  await appendFile(path.join(sessionsDir(), "index.jsonl"), "\n" + JSON.stringify(summary) + "\n")
  return rel
}
const oldTurn = (n: number) => [
  { type: "message", ts: "x", message: { role: "user", content: `câu ${n}` } },
  { type: "message", ts: "x", message: { role: "assistant", content: `đáp ${n}` } },
  { type: "turn_end", ts: "x", provider: "groq", model: "m1" },
]

describe("turn numbers", () => {
  test("turn_end carries 1, 2, 3; loadSession reports the last", async () => {
    const s = Session.create()
    for (let i = 1; i <= 3; i++) await s.appendTurn(plain(i), info)
    expect(await turnsIn(fileOf(s))).toEqual([1, 2, 3])
    expect((await loadSession(s.id)).lastTurn).toBe(3)
  })

  test("a turn written late keeps its number, the same one the receipt gave", async () => {
    const s = Session.create()
    await s.appendTurn(plain(1), info)
    spy("append").mockImplementationOnce(async () => {
      throw fail("đầy đĩa", "ENOSPC")
    })
    expect((await s.appendTurn(plain(2), info)).pending).toEqual([2])
    expect((await s.appendTurn(plain(3), info)).saved).toEqual([2, 3])
    expect(await turnsIn(fileOf(s))).toEqual([1, 2, 3])
  })

  test("a torn last line (a crash mid-write) is not counted", async () => {
    const s = Session.create()
    for (let i = 1; i <= 2; i++) await s.appendTurn(plain(i), info)
    await appendFile(fileOf(s), '{"type":"turn_end","ts":"x","turn":3')
    const loaded = await loadSession(s.id)
    expect(loaded.lastTurn).toBe(2)
    const resumed = Session.continue(loaded.summary, loaded.lastTurn)
    expect((await resumed.appendTurn(plain(3), info)).saved).toEqual([3])
    expect(await turnsIn(fileOf(s))).toEqual([1, 2, 3])
  })

  test("an older session with no turn field: four turns, the next is 5", async () => {
    const id = "20260915-090000-old4"
    await handwritten(id, [...oldTurn(1), ...oldTurn(2), ...oldTurn(3), ...oldTurn(4)], 4)
    const loaded = await loadSession(id)
    expect(loaded.lastTurn).toBe(4)
    const resumed = Session.continue(loaded.summary, loaded.lastTurn)
    expect((await resumed.appendTurn(plain(5), info)).saved).toEqual([5])
    expect((await entries(path.join(sessionsDir(), loaded.summary.file))).filter((e) => e.type === "turn_end").at(-1).turn).toBe(5)
  })

  test("an index line behind the file (6 turns, the index says 4): the next is 7, from the file", async () => {
    const s = Session.create()
    for (let i = 1; i <= 6; i++) await s.appendTurn(plain(i), info)
    const loaded0 = await loadSession(s.id)
    await appendFile(path.join(sessionsDir(), "index.jsonl"), JSON.stringify({ ...loaded0.summary, turns: 4 }) + "\n")
    const loaded = await loadSession(s.id)
    expect(loaded.summary.turns).toBe(4)
    expect(loaded.lastTurn).toBe(6)
    const resumed = Session.continue(loaded.summary, loaded.lastTurn)
    expect((await resumed.appendTurn(plain(7), info)).saved).toEqual([7])
    expect((await turnsIn(fileOf(s))).at(-1)).toBe(7)
  })
})

describe("session_get (the main agent's tool for old sessions)", () => {
  test("reads with the masks, writes nothing; no store: nothing of a block shows either", async () => {
    const { sessionHistoryTools } = await import("../src/core/tools/session/history")
    const mem = stores.open()
    for (let i = 1; i <= 7; i++) mem.writer.addLesson({ title: `Bài ${i}`, summary: `Tóm tắt ${i}` })
    mem.writer.deleteLesson(7, 1)
    const s = Session.create()
    await s.appendTurn(readTurn(1, lesson(7, "DANHDAU-7")), info)
    const before = await readFile(fileOf(s))
    const ctx = { signal: new AbortController().signal, callId: "c" }
    const get = (check?: ReturnType<typeof createRedactionCheck>) =>
      sessionHistoryTools({ redaction: check }).find((t) => t.name === "session_get")!.execute({ id: s.id }, ctx)
    const withStore = String(await get(createRedactionCheck(stores.file())))
    const noStore = String(await get(createRedactionCheck(path.join(home, "khong-co.db"))))
    for (const out of [withStore, noStore]) {
      expect(out).toContain(`Phiên ${s.id}`)
      expect(out).not.toContain("DANHDAU-7")
    }
    expect((await readFile(fileOf(s))).equals(before)).toBe(true)
    // The tool reads through the check (its output never shows a block, so the call is what can be seen).
    const real = createRedactionCheck(stores.file())
    let asked = 0
    await get({ file: real.file, check: (blocks) => (asked++, real.check(blocks)) })
    expect(asked).toBe(1)
  })
})

describe("code review fixes", () => {
  test("turn_end lines all unreadable while the index says 5: the next turn is 6, not 1", async () => {
    const id = "20260915-090000-dmg5"
    const lines = [1, 2, 3, 4, 5].flatMap((n) => oldTurn(n).slice(0, 2))
    await handwritten(id, lines, 5)
    const loaded = await loadSession(id)
    expect(loaded.lastTurn).toBe(0)
    const resumed = Session.continue(loaded.summary, loaded.lastTurn)
    expect((await resumed.appendTurn(plain(6), info)).saved).toEqual([6])
  })
})

describe("redact lines", () => {
  test("one line after the turns waiting; a turn caught up on is written as it was, the line after it", async () => {
    const s = Session.create()
    await s.appendTurn(plain(1), info)
    spy("append").mockImplementationOnce(async () => {
      throw fail("đầy đĩa", "ENOSPC")
    })
    const block = lesson(7, "DANHDAU-7")
    expect((await s.appendTurn(readTurn(2, block), info)).pending).toEqual([2])
    const before = await readFile(fileOf(s))
    const r = await s.appendRedaction(ITEM7)
    expect(r).toMatchObject({ saved: [2], pending: [], pendingCompactions: 0, pendingRedactions: 0 })
    const after = await readFile(fileOf(s))
    // Every line there before is still there byte for byte.
    expect(after.subarray(0, before.length).equals(before)).toBe(true)
    const all = await entries(fileOf(s))
    expect(all.at(-1)).toMatchObject({ type: "redact", items: ITEM7 })
    expect(all.at(-2)).toMatchObject({ type: "turn_end", turn: 2 })
    // The turn is in the file verbatim: the block as the model saw it.
    expect(JSON.stringify(all.slice(0, -1))).toContain("DANHDAU-7")
    expect(JSON.stringify(all.at(-1))).not.toContain("DANHDAU-7")
  })

  test("a redact line that fails midway is cut back and written later; it is not counted as a compaction", async () => {
    const s = Session.create()
    await s.appendTurn(readTurn(1, lesson(7, "DANHDAU-7")), info)
    const before = await readFile(fileOf(s))
    const real = store.sessionFiles.append
    spy("append").mockImplementationOnce(async (file, text) => {
      await real(file, text.slice(0, Math.floor(text.length / 2)))
      throw fail("đầy đĩa", "ENOSPC")
    })
    const r1 = await s.appendRedaction(ITEM7)
    expect(r1).toMatchObject({ saved: [], pending: [], pendingCompactions: 0, pendingRedactions: 1, stopped: false })
    expect(r1.error).toBeInstanceOf(Error)
    expect((await readFile(fileOf(s))).equals(before)).toBe(true)
    const r2 = await s.flush()
    expect(r2).toMatchObject({ pendingRedactions: 0, pendingCompactions: 0 })
    expect((await entries(fileOf(s))).at(-1)).toMatchObject({ type: "redact", items: ITEM7 })
  })

  test("a session that stopped writing never gets the line", async () => {
    const s = Session.create()
    await s.appendTurn(plain(1), info)
    const real = store.sessionFiles.append
    spy("append").mockImplementationOnce(async (file, text) => {
      await real(file, text.slice(0, 5))
      throw fail("đầy đĩa", "ENOSPC")
    })
    spy("truncate").mockImplementation(async () => {
      throw fail("đang bị giữ", "EBUSY")
    })
    expect((await s.appendTurn(plain(2), info)).stopped).toBe(true)
    const before = await readFile(fileOf(s))
    const r = await s.appendRedaction(ITEM7)
    expect(r).toMatchObject({ stopped: true, pendingRedactions: 1 })
    expect((await readFile(fileOf(s))).equals(before)).toBe(true)
  })

  test("nothing to record: no line", async () => {
    const s = Session.create()
    await s.appendTurn(plain(1), info)
    const before = await readFile(fileOf(s))
    expect(await s.appendRedaction([])).toMatchObject({ pendingRedactions: 0 })
    expect((await readFile(fileOf(s))).equals(before)).toBe(true)
  })
})

describe("loadSession", () => {
  test("a line masks the blocks before it, a compaction's history included; a later block is left", async () => {
    const s = Session.create()
    const block = lesson(7, "DANHDAU-7")
    await s.appendTurn(readTurn(1, block), info)
    await s.appendCompact({ trigger: "manual", before: 4, after: 4, messages: readTurn(1, block) })
    await s.appendRedaction(ITEM7)
    await s.appendTurn(readTurn(2, block), info)
    const loaded = await loadSession(s.id)
    const model = JSON.stringify(loaded.messages)
    expect(model.split("DANHDAU-7").length - 1).toBe(1)
    expect(model).toContain(JSON.stringify(maskedLesson(7)).slice(1, -1))
    // The transcript: turn 1 masked, turn 2 (after the line) as written.
    expect(JSON.stringify(loaded.display).split("DANHDAU-7").length - 1).toBe(1)
    expect(loaded.redaction).toEqual({ fromFile: 1, confirmed: [] })
  })

  test("with the check: a lesson the store has deleted is masked even with no line in the file yet", async () => {
    const mem = stores.open()
    for (let i = 1; i <= 7; i++) mem.writer.addLesson({ title: `Bài ${i}`, summary: `Tóm tắt ${i}` })
    mem.writer.deleteLesson(7, 1)
    const s = Session.create()
    await s.appendTurn(readTurn(1, lesson(7, "DANHDAU-7")), info)
    const fileBefore = await readFile(fileOf(s))
    const loaded = await loadSession(s.id, { check: createRedactionCheck(stores.file()) })
    expect(JSON.stringify(loaded.messages)).not.toContain("DANHDAU-7")
    expect(JSON.stringify(loaded.display)).not.toContain("DANHDAU-7")
    expect(loaded.redaction).toEqual({ fromFile: 0, confirmed: ITEM7 })
    // Reading never writes: recording the line is the caller's choice.
    expect((await readFile(fileOf(s))).equals(fileBefore)).toBe(true)
  })

  test("no store file: the history keeps the block, what is shown holds it, nothing confirmed", async () => {
    const s = Session.create()
    await s.appendTurn(readTurn(1, lesson(7, "DANHDAU-7")), info)
    const loaded = await loadSession(s.id, { check: createRedactionCheck(stores.file()) })
    expect(JSON.stringify(loaded.messages)).toContain("DANHDAU-7")
    expect(JSON.stringify(loaded.display)).not.toContain("DANHDAU-7")
    expect(loaded.redaction).toEqual({ fromFile: 0, confirmed: [], temporary: { state: "missing", blocks: 1 } })
  })

  test("a torn redact line is skipped like any damaged line", async () => {
    const s = Session.create()
    await s.appendTurn(readTurn(1, lesson(7, "DANHDAU-7")), info)
    await appendFile(fileOf(s), '{"type":"redact","ts":"x","items":[{"kind":"lesson","id":7')
    const loaded = await loadSession(s.id)
    expect(JSON.stringify(loaded.messages)).toContain("DANHDAU-7")
    expect(loaded.redaction.fromFile).toBe(0)
  })

  test("a malformed redact line (wrong item shape) is skipped", async () => {
    const s = Session.create()
    await s.appendTurn(readTurn(1, lesson(7, "DANHDAU-7")), info)
    await appendFile(fileOf(s), JSON.stringify({ type: "redact", ts: "x", items: [{ kind: "lesson", id: "7", versions: [1] }] }) + "\n")
    expect(JSON.stringify((await loadSession(s.id)).messages)).toContain("DANHDAU-7")
  })

  test("a session written before this format opens exactly as before, with or without the check", async () => {
    const id = "20260915-090000-pre6"
    await handwritten(id, [...oldTurn(1), ...oldTurn(2)], 2)
    const expected = [...plain(1), ...plain(2)]
    const bare = await loadSession(id)
    expect(bare.messages).toEqual(expected)
    expect(bare.display).toEqual(expected)
    const checked = await loadSession(id, { check: createRedactionCheck(stores.file()) })
    expect(checked.messages).toEqual(expected)
    expect(checked.redaction).toEqual({ fromFile: 0, confirmed: [] })
  })

  test("the previous build's reading rules (it skips line types it does not know) read the new file", async () => {
    const s = Session.create()
    const block = lesson(7, "DANHDAU-7")
    await s.appendTurn(readTurn(1, block), info)
    await s.appendRedaction(ITEM7)
    await s.appendTurn(plain(2), info)
    // The dispatch the loader had before this spec: meta, message, compact, turn_end, chart, harness.
    const known = new Set(["meta", "message", "compact", "turn_end", "chart", "harness"])
    const messages: ModelMessage[] = []
    for (const e of await entries(fileOf(s))) {
      if (!known.has(e.type)) continue
      if (e.type === "message") messages.push(e.message)
    }
    expect(messages).toEqual([...readTurn(1, block), ...plain(2)])
  })
})
