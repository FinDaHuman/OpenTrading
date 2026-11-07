import type { ModelMessage } from "ai"
import { readdirSync, writeFileSync } from "node:fs"
import { describe, expect, spyOn, test } from "bun:test"
import { userMessage } from "../src/core/agent"
import { memoryLines, type HistoryBlock } from "../src/core/memory/notebook/history-blocks"
import {
  alreadyShown,
  heldLesson,
  heldThesis,
  maskedLesson,
  maskedThesis,
  renderLessonBlock,
  renderThesisBlock,
} from "../src/core/memory/notebook/render"
import { createRedactionCheck, redactionDisk, type RedactionCheck } from "../src/core/memory/redaction/check"
import { applyRedactLines, redactHistory, temporaryNotice } from "../src/core/memory/redaction/redact"
import type { MemoryStore } from "../src/core/memory/store/open"
import { truncate } from "../src/core/tools/wrap"
import { useTempStores } from "./helpers/memory-store"

const t = useTempStores()
const DECISION_MARKER = "MARKER-quyet-dinh-redact-9d1e"
const LIVE_MARKER = "MARKER-bai-hoc-con-4b7a"
const AT = "2026-11-01T08:00:00.000Z"

const lessonInput = (title: string, summary = `Tóm tắt ${title}`) => ({ title, summary, tags: ["thép"] })

/**
 * HPG (sector Thép) with theses 1–3 and its old code "HPGX" retired; lesson A live (two versions), lesson B
 * deleted after version 1; a decision carrying a marker.
 */
function seed(store: MemoryStore) {
  const w = store.writer
  const steel = w.createSubject({ kind: "sector", alias: "Thép" }).id
  w.saveThesis(steel, null, { text: "Chu kỳ thép", conditions: [] })
  const hpg = w.createSubject({ kind: "ticker", alias: "HPGX", sectorId: steel }).id
  w.saveThesis(hpg, null, { text: "Bản 1", conditions: [] })
  w.saveThesis(hpg, 1, { text: "Bản 2", conditions: [] })
  w.saveThesis(hpg, 2, { text: "Biên lợi nhuận < 10% & phục hồi\nnhờ quặng", conditions: ["Sai nếu giá thép giảm 20%"], reviewBy: "2026-12-31" })
  w.addAlias(hpg, "HPG")
  w.retireAlias(hpg, "HPGX")
  const a = w.addLesson({ ...lessonInput("Cắt lỗ"), detail: LIVE_MARKER }).id
  w.reviseLesson(a, 1, { ...lessonInput("Cắt lỗ", "Cắt lỗ sớm hơn"), detail: LIVE_MARKER })
  const b = w.addLesson(lessonInput("Đuổi giá")).id
  w.deleteLesson(b, 1)
  w.addDecision({ subjectId: hpg, thesisVersion: 3, action: "Mua", reason: DECISION_MARKER })
  return { steel, hpg, a, b }
}

const thesisBlock = (display: string, version: number, text: string, opts: { sector?: boolean; state?: string; conditions?: string[]; reviewBy?: string } = {}) =>
  renderThesisBlock(
    {
      subjectId: 0,
      display,
      version,
      text,
      conditions: opts.conditions ?? [],
      reviewBy: opts.reviewBy,
      state: opts.state ?? "watching",
      validFrom: AT,
    },
    opts.sector ? { sector: { display: "Thép", version: 1 } } : {},
  )
const HPG3 = (opts: { state?: string; sector?: boolean; display?: string } = {}) =>
  thesisBlock(opts.display ?? "HPG", 3, "Biên lợi nhuận < 10% & phục hồi\nnhờ quặng", {
    conditions: ["Sai nếu giá thép giảm 20%"],
    reviewBy: "2026-12-31",
    sector: opts.sector ?? true,
    state: opts.state,
  })
const lessonBlock = (id: number, version: number, title: string, summary = `Tóm tắt ${title}`, detail?: string) =>
  renderLessonBlock({ id, version, title, summary, appliesToDisplay: ["HPG"], tags: ["thép"], detail, createdAt: AT })

const section = (items: string[]) => `<memory_lien_quan>\n${items.map((x) => `- ${x}`).join("\n")}\n</memory_lien_quan>`
const remind = (items: string[], typed = "Còn HPG thì sao?") => userMessage(typed, [section(items)])
const toolResult = (value: string, id = "c1"): ModelMessage => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: id, toolName: "memory_read", output: { type: "text", value } }],
})
const answer = (text: string): ModelMessage => ({ role: "assistant", content: [{ type: "text", text }] })
const search = (...blocks: string[]) => `Bài học khớp «thép» (${blocks.length} bài, xếp theo độ khớp):\n${blocks.join("\n\n")}`

const blocksOf = (history: readonly ModelMessage[]) => memoryLines(history).blocks
async function verdicts(check: RedactionCheck, history: readonly ModelMessage[]) {
  const blocks = blocksOf(history)
  const result = await check.check(blocks)
  if (result.state !== "checked") throw new Error(result.state)
  return blocks.map((b) => [b.kind, b.ref, b.version, result.verdict(b)])
}

describe("createRedactionCheck", () => {
  test("no store file: missing, nothing created", async () => {
    const result = await createRedactionCheck(t.file()).check(blocksOf([remind([HPG3()])]))
    expect(result).toEqual({ state: "missing" })
    expect(readdirSync(t.dir())).toEqual([])
  })

  test("a store from a newer build, a file that is not a store: failed, with the reason", async () => {
    const store = t.open({}, "newer.db")
    seed(store)
    store.close()
    t.raw("newer.db").run("PRAGMA user_version = 99")
    writeFileSync(t.file("text.db"), "Không phải SQLite. ".repeat(50))
    const blocks = blocksOf([remind([HPG3()])])
    const newer = await createRedactionCheck(t.file("newer.db")).check(blocks)
    const text = await createRedactionCheck(t.file("text.db")).check(blocks)
    expect(newer).toEqual({ state: "failed", reason: "kho do phiên bản OpenTrading mới hơn tạo" })
    expect(text.state).toBe("failed")
    expect((text as { reason: string }).reason.length).toBeGreaterThan(0)
  })

  test("a readable store: deleted lesson and absent lesson are deleted, live versions live", async () => {
    const store = t.open()
    const ids = seed(store)
    const history = [
      remind([HPG3(), lessonBlock(ids.b, 1, "Đuổi giá")]),
      toolResult(search(lessonBlock(ids.a, 1, "Cắt lỗ", undefined, LIVE_MARKER), lessonBlock(99, 1, "Không có"))),
    ]
    expect(await verdicts(createRedactionCheck(t.file()), history)).toEqual([
      ["thesis", "HPG", 3, "live"],
      ["lesson", ids.b, 1, "deleted"],
      ["lesson", ids.a, 1, "live"],
      ["lesson", 99, 1, "deleted"],
    ])
  })

  test("a thesis block under a name the subject no longer uses is still found", async () => {
    const store = t.open()
    seed(store)
    const history = [remind([thesisBlock("HPGX", 2, "Bản 2"), thesisBlock("HPGX", 7, "Không có bản này")])]
    expect(await verdicts(createRedactionCheck(t.file()), history)).toEqual([
      ["thesis", "HPGX", 2, "live"],
      ["thesis", "HPGX", 7, "deleted"],
    ])
  })

  test("a store re-created the same day: same number with other content is mismatch, same content live", async () => {
    const other = t.open({}, "other.db")
    const same = t.open({}, "same.db")
    other.writer.addLesson(lessonInput("Bài khác"))
    same.writer.addLesson(lessonInput("Cắt lỗ"))
    const history = [toolResult(lessonBlock(1, 1, "Cắt lỗ"))]
    expect(await verdicts(createRedactionCheck(t.file("other.db")), history)).toEqual([["lesson", 1, 1, "mismatch"]])
    expect(await verdicts(createRedactionCheck(t.file("same.db")), history)).toEqual([["lesson", 1, 1, "live"]])
  })

  test("a cut block: content is not compared; a deleted item is still deleted", async () => {
    const store = t.open()
    const ids = seed(store)
    const full = blocksOf([toolResult(search(lessonBlock(ids.a, 1, "Nội dung khác hẳn"), lessonBlock(ids.b, 1, "Đuổi giá")))])
    const cut = full.map((b): HistoryBlock => ({ ...b, complete: false, lines: b.lines.slice(0, 1) }))
    const result = await createRedactionCheck(t.file()).check(cut)
    if (result.state !== "checked") throw new Error(result.state)
    expect(cut.map((b) => result.verdict(b))).toEqual(["live", "deleted"])
  })

  test("a content line escaped differently from the rebuilt one is mismatch, never deleted", async () => {
    const store = t.open()
    seed(store)
    const drifted = HPG3().replace("&lt; 10% &amp;", "< 10% &")
    expect(drifted).not.toBe(HPG3())
    expect(await verdicts(createRedactionCheck(t.file()), [remind([drifted])])).toEqual([["thesis", "HPG", 3, "mismatch"]])
  })

  test("'Trạng thái:' and 'Liên quan:' may change without a new version: still live", async () => {
    const store = t.open()
    seed(store)
    const history = [remind([HPG3({ state: "refuted", sector: false })]), remind([HPG3({ sector: true })])]
    expect((await verdicts(createRedactionCheck(t.file()), history)).map((v) => v[3])).toEqual(["live", "live"])
  })

  test("a look at the file that hangs: failed within the deadline", async () => {
    const store = t.open()
    seed(store)
    const spy = spyOn(redactionDisk, "probe").mockImplementation(() => new Promise(() => {}))
    try {
      const started = Date.now()
      const result = await createRedactionCheck(t.file(), { deadlineMs: 100 }).check(blocksOf([remind([HPG3()])]))
      expect(result.state).toBe("failed")
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      spy.mockRestore()
    }
  })

  test("a history with no block never looks at the store", async () => {
    const spy = spyOn(redactionDisk, "probe")
    try {
      const result = await createRedactionCheck(t.file()).check([])
      expect(result.state).toBe("checked")
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  test("nothing from the store or a decision leaves the check", async () => {
    const store = t.open()
    const ids = seed(store)
    const history = [toolResult(search(lessonBlock(ids.a, 2, "Cắt lỗ", "Khác", "khác"), lessonBlock(ids.b, 1, "Đuổi giá")))]
    const result = await createRedactionCheck(t.file()).check(blocksOf(history))
    const redaction = await redactHistory(history, createRedactionCheck(t.file()))
    const seen = JSON.stringify(result) + JSON.stringify(redaction.record) + JSON.stringify(redaction.temporary ?? null)
    for (const marker of [DECISION_MARKER, LIVE_MARKER, "Cắt lỗ sớm hơn"]) expect(seen).not.toContain(marker)
  })
})

/** A fixed answer from the store, for the masking rules alone. */
const fixed = (verdict: (b: HistoryBlock) => "deleted" | "mismatch" | "live"): RedactionCheck => ({
  file: "memory.db",
  check: async () => ({ state: "checked", verdict }),
})
const state = (s: "missing" | "failed"): RedactionCheck => ({
  file: "memory.db",
  check: async () => (s === "missing" ? { state: "missing" } : { state: "failed", reason: "dữ liệu trong kho bị hỏng" }),
})
const deletes = (...refs: (number | string)[]) => fixed((b) => (refs.includes(b.ref) ? "deleted" : "live"))

describe("redactHistory", () => {
  const L7 = lessonBlock(7, 1, "Cắt lỗ", "DANHDAU-7")
  const L3 = lessonBlock(3, 1, "Đuổi giá", "DANHDAU-3")
  const history = (): ModelMessage[] => [
    remind([HPG3(), L7], "Phân tích HPG"),
    answer("HPG ổn"),
    remind([], "Bài học nào về thép?"),
    toolResult(search(L3, L7)),
    answer("Có hai bài"),
  ]

  test("only the block's own text is replaced; everything else is byte for byte the same", async () => {
    const before = history()
    const copy = structuredClone(before)
    const r = await redactHistory(before, deletes(7))
    expect(before).toEqual(copy)
    expect(JSON.stringify(r.kept).includes("DANHDAU-7")).toBe(false)
    expect(JSON.stringify(r.kept).includes("DANHDAU-3")).toBe(true)
    const expected = structuredClone(before)
    const p0 = (expected[0]!.content as { text: string }[])[0]!
    p0.text = p0.text.replace(L7, maskedLesson(7))
    const out = ((expected[3]!.content as unknown[])[0] as { output: { value: string } }).output
    out.value = out.value.replace(L7, maskedLesson(7))
    expect(r.kept).toEqual(expected)
    expect(r.sent).toEqual(expected)
    // Untouched messages are passed on as they are.
    expect(r.kept[1]).toBe(before[1]!)
    expect(r.record).toEqual([{ kind: "lesson", id: 7, versions: [1] }])
    expect(r.temporary).toBeUndefined()
  })

  test("every version of an item is masked; the record groups by item", async () => {
    const h = [
      remind([HPG3(), thesisBlock("HPG", 2, "Bản 2"), lessonBlock(7, 2, "Cắt lỗ")]),
      toolResult(lessonBlock(7, 1, "Cắt lỗ")),
    ]
    const r = await redactHistory(h, deletes(7, "HPG"))
    expect(blocksOf(r.kept)).toEqual([])
    expect(r.record).toEqual([
      { kind: "thesis", name: "HPG", versions: [2, 3] },
      { kind: "lesson", id: 7, versions: [1, 2] },
    ])
    expect(JSON.stringify(r.kept)).toContain(maskedThesis("HPG"))
  })

  test("no store or an unreadable one: history kept as is, every block held in what is sent, nothing recorded", async () => {
    for (const s of ["missing", "failed"] as const) {
      const before = history()
      const r = await redactHistory(before, state(s))
      expect(r.kept).toEqual(before)
      expect(blocksOf(r.sent)).toEqual([])
      const sent = JSON.stringify(r.sent)
      expect(sent).toContain(heldLesson(7, 1))
      expect(sent).toContain(heldThesis("HPG", 3))
      expect(sent).not.toContain("DANHDAU-")
      expect(r.record).toEqual([])
      expect(r.temporary).toEqual(
        s === "missing" ? { state: "missing", blocks: 4 } : { state: "failed", reason: "dữ liệu trong kho bị hỏng", blocks: 4 },
      )
    }
  })

  test("mismatch (a store re-created the same day): history unchanged, only that block held, nothing recorded", async () => {
    const before = history()
    const r = await redactHistory(before, fixed((b) => (b.ref === 3 ? "mismatch" : "live")))
    expect(r.kept).toEqual(before)
    expect(JSON.stringify(r.sent)).toContain(heldLesson(3, 1))
    expect(JSON.stringify(r.sent)).not.toContain("DANHDAU-3")
    expect(JSON.stringify(r.sent)).toContain("DANHDAU-7")
    expect(r.record).toEqual([])
    expect(r.temporary).toEqual({ state: "mismatch", blocks: 1 })
  })

  test("a cut block of a live item is left alone", async () => {
    const store = t.open()
    const id = store.writer.addLesson({ title: "Dài", summary: "Ngắn", detail: "x ".repeat(1_900) }).id
    const whole = renderLessonBlock({ id, version: 1, title: "Dài", summary: "Ngắn", appliesToDisplay: [], tags: [], detail: "x ".repeat(1_900), createdAt: AT })
    const h = [toolResult(`${whole.slice(0, 500)}\n\n[... đã lược 3100 ký tự ...]\n\n${whole.slice(-200)}`)]
    expect(blocksOf(h).map((b) => b.complete)).toEqual([false])
    const r = await redactHistory(h, createRedactionCheck(t.file()))
    expect(r.kept).toEqual(h)
    expect(r.sent).toEqual(h)
    expect(r.record).toEqual([])
  })

  test("a label right after the output cap's mark is not trusted: never deleted, only held", async () => {
    const store = t.open()
    // Stored text holding something that looks like the label of a lesson the store never had.
    const fake = "[Memory · bài học · #42 · bản 1 · ghi 20/10/2026 · người dùng tự ghi]"
    const detail = `${"x ".repeat(900)}${fake}\nDANHDAU-42 phần sau`
    const id = store.writer.addLesson({ title: "Chủ", summary: "Ngắn", detail }).id
    const whole = renderLessonBlock({ id, version: 1, title: "Chủ", summary: "Ngắn", appliesToDisplay: [], tags: [], detail, createdAt: AT })
    const at = whole.indexOf(fake)
    // The real truncate(), with the cap chosen so its tail starts exactly at the look-alike.
    let cut = ""
    for (let max = 10; max < whole.length && !cut; max++) {
      if (max - Math.floor(max * 0.7) === whole.length - at) cut = truncate(whole, max)
    }
    expect(cut.split("...]\n\n")[1]!.startsWith(fake)).toBe(true)
    const h = [toolResult(cut)]
    expect(blocksOf(h).map((b) => [b.ref, b.labelSure])).toEqual([
      [id, true],
      [42, false],
    ])
    const r = await redactHistory(h, createRedactionCheck(t.file()))
    expect(r.record).toEqual([])
    expect(r.kept).toEqual(h)
    expect(JSON.stringify(r.sent)).toContain(heldLesson(42, 1))
    expect(JSON.stringify(r.sent)).not.toContain("DANHDAU-42")
    expect(r.temporary).toEqual({ state: "mismatch", blocks: 1 })
  })

  test("the held text never says deleted", () => {
    expect(heldLesson(7, 1)).not.toContain("đã bị người dùng xoá")
    expect(heldThesis("HPG", 3)).not.toContain("đã bị người dùng xoá")
    expect(maskedLesson(7)).toContain("đã bị người dùng xoá")
  })

  test("a history with no block: nothing changes, nothing to say", async () => {
    const h = [remind([], "xin chào"), answer("chào")]
    for (const check of [state("missing"), state("failed"), deletes(7)]) {
      const r = await redactHistory(h, check)
      expect(r).toEqual({ kept: h, sent: h, record: [] })
    }
  })

  test("no check at all (eval runner): nothing changes", async () => {
    const h = history()
    expect(await redactHistory(h, undefined)).toEqual({ kept: h, sent: h, record: [] })
  })

  test("run twice: the second run records nothing", async () => {
    const first = await redactHistory(history(), deletes(7))
    const second = await redactHistory(first.kept, deletes(7))
    expect(second.record).toEqual([])
    expect(second.kept).toEqual(first.kept)
  })
})

describe("applyRedactLines", () => {
  test("masks the listed items and versions only; a block written after the line is not masked", () => {
    const L7 = lessonBlock(7, 1, "Cắt lỗ", "DANHDAU-7")
    const before = [remind([L7, lessonBlock(7, 2, "Cắt lỗ", "DANHDAU-7b"), HPG3()])]
    const masked = applyRedactLines(before, [{ kind: "lesson", id: 7, versions: [1] }])
    expect(JSON.stringify(masked)).not.toContain("DANHDAU-7\\n")
    expect(blocksOf(masked).map((b) => [b.ref, b.version])).toEqual([
      [7, 2],
      ["HPG", 3],
    ])
    // The session reader applies a line to what came before it: a later block stays.
    const later = [...masked, toolResult(L7)]
    expect(blocksOf(later).map((b) => [b.ref, b.version])).toEqual([
      [7, 2],
      ["HPG", 3],
      [7, 1],
    ])
  })
})

describe("code review fixes", () => {
  test("a redact line never masks a block whose label is unsure (right after the output cap's mark)", () => {
    const sure = lessonBlock(7, 1, "Cắt lỗ", "DANHDAU-sure")
    const tail = lessonBlock(7, 1, "Cắt lỗ", "DANHDAU-unsure")
    const h = [toolResult(`${sure}\n\nx\n\n[... đã lược 10 ký tự ...]\n\n${tail}`)]
    expect(blocksOf(h).map((b) => b.labelSure)).toEqual([true, false])
    const masked = JSON.stringify(applyRedactLines(h, [{ kind: "lesson", id: 7, versions: [1] }]))
    expect(masked).not.toContain("DANHDAU-sure")
    expect(masked).toContain("DANHDAU-unsure")
  })
})

describe("words", () => {
  test("a notice for each of the three held cases", () => {
    expect(temporaryNotice({ state: "missing", blocks: 2 })).toBe(
      "Không tìm thấy kho memory; các khối memory trong phiên này tạm được che cho tới khi có lại kho.",
    )
    expect(temporaryNotice({ state: "failed", reason: "dữ liệu trong kho bị hỏng", blocks: 1 })).toBe(
      "Kho memory không đọc được: dữ liệu trong kho bị hỏng; các khối memory trong phiên này tạm được che.",
    )
    expect(temporaryNotice({ state: "mismatch", blocks: 1 })).toBe(
      "Một số khối memory trong phiên này khác bản đang có trong kho (có thể kho đã được tạo lại); các khối đó tạm được che.",
    )
  })

  test("memory_read's short answer points at the label", () => {
    expect(alreadyShown.lesson(7, 1)).toBe(
      "Bài học #7 bản 1 đã có phía trên trong hội thoại, ở khối có nhãn [Memory · bài học · #7 · bản 1 · …]; nội dung không đổi.",
    )
    expect(alreadyShown.thesis("HPG", 3)).toBe(
      "Luận điểm HPG bản 3 đã có phía trên trong hội thoại, ở khối có nhãn [Memory · luận điểm · HPG · bản 3 · …]; nội dung không đổi.",
    )
  })
})
