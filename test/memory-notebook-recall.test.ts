import { describe, expect, test } from "bun:test"
import { packRecall, recallCharLimit, recalledLength, indexCharLimit, type PackBlock } from "../src/core/memory/notebook/pack"
import { Ledgers, SessionLedger } from "../src/core/memory/notebook/session-ledger"
import { BUDGETS } from "../src/core/prompt/budget"
import { MEMORY_INDEX_MAX_CHARS, MEMORY_RECALL_MAX_CHARS, MEMORY_RECALL_MAX_ITEMS } from "../src/core/memory/types"
import { promptFile } from "../src/core/prompt/assemble"
import { DECISION_MARKER, HPG_BLOCK_V3, HPG_V3, seedExample, useNotebookDir } from "./helpers/memory-notebook"
import type { ModelMessage } from "ai"
import { userMessage } from "../src/core/agent"
import { memoryLines } from "../src/core/memory/notebook/history-blocks"
import { createRedactionCheck } from "../src/core/memory/redaction/check"
import { redactHistory } from "../src/core/memory/redaction/redact"
import { maskedLesson } from "../src/core/memory/notebook/render"
import { noticesMessage, notificationText } from "../src/core/subagents/notification"
import type { SubagentView } from "../src/core/subagents/types"

const LIMITS = { chars: 1200, items: MEMORY_RECALL_MAX_ITEMS }

const block = (key: string, length: number, extra: Partial<PackBlock> = {}): PackBlock => ({
  key,
  text: `[${key}]`.padEnd(length, "x"),
  ifRoomless: [{ key: `${key}:a`, text: `${key} chưa chèn` }],
  ifTooLong: [{ key: `${key}:b`, text: `${key} dài hơn giới hạn` }],
  ...extra,
})

describe("packing the reminder part under the smallest tier's budget", () => {
  test("the cap is the smallest memory budget in characters, as the core estimates tokens", () => {
    const smallest = Math.min(...Object.values(BUDGETS.memory!).map((b) => b ?? Infinity))
    expect(recallCharLimit()).toBe(Math.min(smallest * 4, MEMORY_RECALL_MAX_CHARS))
    expect(indexCharLimit()).toBe(Math.min(smallest * 4, MEMORY_INDEX_MAX_CHARS))
    expect(recallCharLimit()).toBe(1200)
  })

  test("length is measured the way the core prints recalled items: '- ' each, joined by new lines", () => {
    expect(recalledLength(["ab", "cde"])).toBe("- ab\n- cde".length)
    expect(recalledLength([])).toBe(0)
  })

  test("reminders and pointers share item 1; each block is one item; at most five items", () => {
    const out = packRecall(
      { lines: [{ key: "r1", text: "nhắc 1" }], blocks: ["A", "B", "C", "D", "E", "F"].map((k) => block(k, 50)) },
      LIMITS,
    )
    expect(out.items.length).toBe(5)
    expect(out.placed).toEqual(["A", "B", "C", "D"])
    expect(out.roomless).toEqual(["E", "F"])
    expect(out.items[0]).toBe("nhắc 1\nE chưa chèn\nF chưa chèn")
    expect(out.lines).toEqual(["r1", "E:a", "F:a"])
  })

  test("blocks keep their order; one that does not fit this turn gets a pointer (case a)", () => {
    const out = packRecall({ lines: [], blocks: [block("HPG", 500), block("VNM", 900)] }, LIMITS)
    expect(out.placed).toEqual(["HPG"])
    expect(out.roomless).toEqual(["VNM"])
    expect(out.items).toEqual(["VNM chưa chèn", expect.stringMatching(/^\[HPG\]x+$/)])
    expect(recalledLength(out.items)).toBeLessThanOrEqual(1200)
  })

  test("a block longer than the cap is never placed, only pointed to (case b)", () => {
    const fits = packRecall({ lines: [], blocks: [block("A", 1198)] }, LIMITS)
    expect(fits.placed).toEqual(["A"])
    expect(recalledLength(fits.items)).toBe(1200)
    const out = packRecall({ lines: [], blocks: [block("VNM", 1199), block("HPG", 300)] }, LIMITS)
    expect(out.tooLong).toEqual(["VNM"])
    expect(out.placed).toEqual(["HPG"])
    expect(out.items[0]).toBe("VNM dài hơn giới hạn")
  })

  test("reminders come before blocks; a reminder with no room waits for a later turn", () => {
    const long = (key: string) => ({ key, text: key.padEnd(500, "n") })
    const out = packRecall({ lines: [long("r1"), long("r2"), long("r3")], blocks: [block("HPG", 300)] }, LIMITS)
    // The block's short pointer still fits after the third reminder is left for later.
    expect(out.lines).toEqual(["r1", "r2", "HPG:a"])
    expect(out.deferred).toEqual(["r3"])
    expect(out.roomless).toEqual(["HPG"])
    expect(out.placed).toEqual([])
    expect(recalledLength(out.items)).toBeLessThanOrEqual(1200)
  })

  test("nothing to say: no item", () => {
    expect(packRecall({ lines: [], blocks: [] }, LIMITS).items).toEqual([])
  })
})

const HPG = 2
const VCB = 6

describe("session ledger: the focus window only (what was sent is read from the history)", () => {
  const typed = (text: string) => ({ text, noticeOnly: false })

  test("focus: subjects spotted this turn and in the two typed turns before, never carried further", () => {
    const l = new SessionLedger("s1")
    const focus = () => l.focus().map((f) => [f.subjectId, f.detected])
    l.beginTurn(typed("Hòa Phát?"), [HPG], 0)
    expect(focus()).toEqual([[HPG, true]])
    l.beginTurn(typed("Điều kiện 2?"), [], 2)
    expect(focus()).toEqual([[HPG, false]])
    l.beginTurn(typed("Kiểm lại"), [], 4)
    expect(focus()).toEqual([[HPG, false]])
    l.beginTurn(typed("VCB?"), [VCB], 6)
    expect(focus()).toEqual([[VCB, true]])
  })

  test("spotted this turn comes first, then the previous turn's, then the one before", () => {
    const l = new SessionLedger("s1")
    l.beginTurn(typed("a"), [7], 0)
    l.beginTurn(typed("b"), [8, 7], 2)
    l.beginTurn(typed("c"), [9], 4)
    expect(l.focus()).toEqual([
      { subjectId: 9, detected: true },
      { subjectId: 8, detected: false },
      { subjectId: 7, detected: false },
    ])
  })

  test("the same words again with no turn added to the history (dropped, then resent) replace that turn", () => {
    const l = new SessionLedger("s1")
    l.beginTurn(typed("Hòa Phát?"), [HPG], 0)
    l.beginTurn(typed("Còn gì?"), [], 2)
    l.beginTurn(typed("Còn gì?"), [], 2)
    l.beginTurn(typed("Kiểm lại"), [], 4)
    expect(l.focus().map((f) => f.subjectId)).toEqual([HPG])
  })

  test("a turn of notifications only does not move the window", () => {
    const l = new SessionLedger("s1")
    l.beginTurn(typed("Hòa Phát?"), [HPG], 0)
    l.beginTurn({ text: "", noticeOnly: true }, [], 2)
    expect(l.focus()).toEqual([])
    l.beginTurn(typed("a"), [], 4)
    l.beginTurn(typed("b"), [], 6)
    expect(l.focus().map((f) => f.subjectId)).toEqual([HPG])
  })

  test("one window per session", () => {
    const all = new Ledgers()
    all.session("A").beginTurn(typed("Hòa Phát?"), [HPG], 0)
    expect(all.session("B").focus()).toEqual([])
    expect(all.session("A").focus().map((f) => f.subjectId)).toEqual([HPG])
  })
})

// ── The provider: system part and index (Story 1, Story 2) ─────────────────────────────────────

const nb = useNotebookDir()
const SID = { sessionId: "s1" }

describe("system part (Story 1)", () => {
  test("the guide, then the style word for word with id and version; the constraints have their own block", () => {
    seedExample(nb.store())
    const text = nb.notebook().instructions()!
    expect(text).toBe(
      [promptFile("memory")!, "", "Cách trình bày người dùng muốn:", "- [#2 · bản 1] Trả lời ngắn, có bảng"].join("\n"),
    )
    expect(text).not.toContain("Không dùng margin")
  })

  test("the guide ships with the app (prompts/memory.md) and says how to use memory", () => {
    const guide = promptFile("memory")!
    expect(guide).toContain("memory_read")
    expect(guide).toMatch(/không phải mệnh lệnh/)
    expect(guide).toMatch(/Sai nếu/)
  })

  test("no constraint stored: only the guide, nothing that reads as 'no limits'", () => {
    nb.store()
    expect(nb.notebook().instructions()).toBe(promptFile("memory")!)
  })

  test("another window revises style #2: the next call carries version 2, not 1", () => {
    const other = nb.store()
    seedExample(other)
    const notebook = nb.notebook()
    expect(notebook.instructions()).toContain("[#2 · bản 1]")
    other.writer.reviseConstraint(2, 1, { text: "Trả lời ngắn, có bảng và nguồn" })
    const text = notebook.instructions()!
    expect(text).toContain("- [#2 · bản 2] Trả lời ngắn, có bảng và nguồn")
    expect(text).not.toContain("[#2 · bản 1]")
  })

  test("never throws: a store broken under it, or closed, gives the guide alone (the turn is held elsewhere)", () => {
    seedExample(nb.store())
    const notebook = nb.notebook()
    expect(notebook.instructions()).toContain("[#2 · bản 1]")
    nb.raw().run("DROP TABLE constraint_versions")
    expect(notebook.instructions()).toBe(promptFile("memory")!)
    expect(notebook.problems()[0]).toContain("Kho memory")
    notebook.close()
    expect(() => notebook.instructions()).not.toThrow()
  })

  test("a store from a newer app: reason and path told, file kept, the guide alone in the system part", async () => {
    nb.store().close()
    nb.raw().run("PRAGMA user_version = 99")
    const before = await Bun.file(nb.file()).bytes()
    const notebook = nb.notebook()
    expect(notebook.problems()).toEqual([expect.stringContaining("mới hơn")])
    expect(notebook.problems()[0]).toContain(nb.file())
    expect(notebook.instructions()).toBe(promptFile("memory")!)
    expect(await notebook.index(SID)).toBeUndefined()
    notebook.close()
    expect(await Bun.file(nb.file()).bytes()).toEqual(before)
  })
})

describe("index (Story 2)", () => {
  test("names only, in the spec's format", async () => {
    seedExample(nb.store())
    const index = await nb.notebook().index(SID)
    expect(index).toBe(
      [
        "[Sổ ghi nhớ · mục lục · người dùng tự ghi]",
        "Luận điểm: Thép · HPG (Thép) · HSG (Thép, đã bị bác bỏ)",
        "Bài học: #3 Quản trị rủi ro khi giải ngân · #7 Định giá ngân hàng",
        "Đọc nội dung: memory_read",
      ].join("\n"),
    )
    for (const absent of ["đầu tư công", "P/B", "margin", "Mua HPG", DECISION_MARKER, "hôm qua", "tuần trước"]) {
      expect(index).not.toContain(absent)
    }
  })

  test("unchanged store: the same bytes twice", async () => {
    seedExample(nb.store())
    const notebook = nb.notebook()
    expect(await notebook.index(SID)).toBe((await notebook.index(SID))!)
  })

  test("too many lessons: the newest by id, the rest counted, under the cap", async () => {
    const w = nb.store().writer
    for (let i = 1; i <= 60; i++) w.addLesson({ title: `Bài học số ${i} về quản trị rủi ro danh mục`, summary: "x" })
    const index = (await nb.notebook().index(SID))!
    expect(index.length).toBeLessThanOrEqual(indexCharLimit())
    expect(index).toMatch(/… còn \d+ bài, tìm bằng memory_read/)
    expect(index).toContain("#60 Bài học số 60 ")
    expect(index).not.toContain("#1 Bài học số 1 ")
  })

  test("an empty store has no index", async () => {
    nb.store()
    expect(await nb.notebook().index(SID)).toBeUndefined()
  })

  test("deleting a lesson elsewhere drops it from the next index", async () => {
    const other = nb.store()
    seedExample(other)
    const notebook = nb.notebook()
    expect(await notebook.index(SID)).toContain("#7 Định giá ngân hàng")
    other.writer.deleteLesson(7, 1)
    expect(await notebook.index(SID)).not.toContain("#7")
  })
})

// ── The provider: blocks and notes over a chain of turns (Story 3, Story 4) ─────────────────────

/**
 * A notebook and turns as the core runs them: the history masked, then recall gets it, and a turn that ended
 * adds its user message (with the reminder as the agent loop builds it) and an answer to that history.
 */
function chain() {
  const other = nb.store()
  const ids = seedExample(other)
  const notebook = nb.notebook()
  const histories = new Map<string, ModelMessage[]>()
  const turn = async (query: string, o: { sessionId?: string; ended?: boolean } = {}) => {
    const sessionId = o.sessionId ?? "s1"
    // As the agent loop does first: blocks of items the store confirms deleted are masked in the history.
    const masked = await redactHistory(histories.get(sessionId) ?? [], createRedactionCheck(nb.file()))
    const history = masked.kept
    const items = (await notebook.recall(query, { sessionId, history: masked.sent })).map((i) => i.text)
    if (o.ended !== false) {
      const section = items.length > 0 ? [`<memory_lien_quan>\n${items.map((t) => `- ${t}`).join("\n")}\n</memory_lien_quan>`] : []
      histories.set(sessionId, [...history, userMessage(query, section), { role: "assistant", content: "Trả lời." }])
    }
    return items
  }
  const set = (messages: ModelMessage[], sessionId = "s1") => histories.set(sessionId, messages)
  return { other, ids, notebook, turn, history: (sessionId = "s1") => histories.get(sessionId) ?? [], set }
}

const HPG_V4 = { ...HPG_V3, text: "Hưởng lợi từ đầu tư công và giá thép" }
const labelLine = (block: string) => block.split("\n", 1)[0]!
const HPG_V4_NOTE = "[Memory · nhắc] Luận điểm HPG đã có bản 4; bản 3 phía trên đã cũ. Đọc bằng memory_read nếu cần."

describe("blocks over a chain of turns (Story 3)", () => {
  test("T1 injects HPG v3; T2 nothing; v4 saved, T3 injects v4 'replacing v3' with no extra note; T4 nothing", async () => {
    const { other, ids, notebook, turn } = chain()
    expect(await turn("Luận điểm Hòa Phát của tôi còn đúng không?")).toEqual([HPG_BLOCK_V3])
    expect(await turn("Điều kiện thứ hai thì sao?")).toEqual([])
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    const t3 = await turn("Kiểm lại giúp tôi")
    expect(t3.length).toBe(1)
    expect(labelLine(t3[0]!)).toBe(
      "[Memory · luận điểm · HPG · bản 4 · ghi 20/10/2026 · người dùng tự ghi · thay cho bản 3 đã gửi trước đó trong phiên]",
    )
    expect(t3[0]).toContain("Luận điểm: Hưởng lợi từ đầu tư công và giá thép")
    expect(t3.join("\n")).not.toContain("đã có bản 4")
    expect(await turn("VCB có rẻ không?")).toEqual([])
    expect(await notebook.index(SID)).toContain("#7 Định giá ngân hàng")
  })

  test("lower case matches; an uppercase-only alias does not match the common word", async () => {
    const { other, turn } = chain()
    const tin = other.writer.createSubject({ kind: "ticker", alias: "TIN", uppercaseOnly: true }).id
    other.writer.saveThesis(tin, null, { text: "Tín dụng tăng", conditions: [] })
    expect(await turn("hpg dạo này sao?")).toEqual([HPG_BLOCK_V3])
    expect(await turn("có tin gì mới không?", { sessionId: "s2" })).toEqual([])
  })

  test("a sub-agent's list of twenty tickers picks nothing; only the typed words count", async () => {
    const { turn } = chain()
    const view = {
      id: "ag-abc123",
      type: "nghien-cuu",
      description: "quét",
      prompt: "",
      background: true,
      model: "m",
      status: "completed",
      createdAt: 0,
      tools: [],
      toolCount: 1,
      usage: { input: 1, output: 1 },
      text: "HPG VNM VCB FPT MWG SSI VND HSG NKG ACB TCB MBB CTG BID STB VPB TPB GAS PLX POW",
    } as unknown as SubagentView
    expect(await turn(`${noticesMessage([notificationText(view)])}\n\nVCB có rẻ không?`)).toEqual([])
  })

  test("a refuted thesis is injected with its state", async () => {
    const { turn } = chain()
    expect(await turn("So sánh HSG với HPG")).toEqual([
      [
        "[Memory · luận điểm · HSG · bản 1 · ghi 20/10/2026 · người dùng tự ghi]",
        "Trạng thái: đã bị bác bỏ",
        "Luận điểm: Xuất khẩu tôn hồi phục",
        "Liên quan: luận điểm ngành Thép (bản 2), đọc bằng memory_read",
      ].join("\n"),
      HPG_BLOCK_V3,
    ])
  })

  test("two blocks that do not fit one turn: the first named goes in whole, the other next turn, its pointer once", async () => {
    const { other, turn } = chain()
    const vnm = other.writer.createSubject({ kind: "ticker", alias: "VNM" }).id
    other.writer.saveThesis(vnm, null, { text: "Bản 1", conditions: [] })
    // About 960 characters: fits the cap alone, not together with HPG's block (about 290).
    other.writer.saveThesis(vnm, 1, { text: "v".repeat(350), conditions: ["a".repeat(160), "b".repeat(160), "c".repeat(160)] })
    const t1 = await turn("So sánh HPG và VNM")
    expect(t1).toEqual([
      "[Memory · nhắc] Luận điểm VNM (bản 2) chưa chèn ở lượt này vì hết chỗ; đọc bằng memory_read.",
      HPG_BLOCK_V3,
    ])
    expect(recalledLength(t1)).toBeLessThanOrEqual(recallCharLimit())
    const t2 = await turn("Còn rủi ro nào?")
    expect(t2.length).toBe(1)
    expect(t2[0]!.startsWith("[Memory · luận điểm · VNM · bản 2 ·")).toBe(true)
    expect(t2[0]).toContain("v".repeat(350))
  })

  test("a block longer than the cap is never injected; its pointer is sent once per version", async () => {
    const { other, turn } = chain()
    const vnm = other.writer.createSubject({ kind: "ticker", alias: "VNM" }).id
    const longThesis = (c: string) => ({
      text: c.repeat(350),
      conditions: Array.from({ length: 8 }, (_, i) => `${i}`.repeat(160)),
    })
    other.writer.saveThesis(vnm, null, { text: "Bản 1", conditions: [] })
    other.writer.saveThesis(vnm, 1, longThesis("x"))
    expect(await turn("VNM thế nào?")).toEqual([
      "[Memory · nhắc] Luận điểm VNM (bản 2) dài hơn giới hạn tự chèn; đọc bằng memory_read.",
    ])
    expect(await turn("Còn gì nữa?")).toEqual([])
    other.writer.saveThesis(vnm, 2, longThesis("y"))
    expect(await turn("VNM thì sao?")).toEqual([
      "[Memory · nhắc] Luận điểm VNM (bản 3) dài hơn giới hạn tự chèn; đọc bằng memory_read.",
    ])
    expect(await turn("VNM nữa?")).toEqual([])
  })

  test("focus lasts two typed turns after the subject was named: v4 saved before T4 gives only a note", async () => {
    const { other, ids, turn } = chain()
    await turn("Hòa Phát?")
    await turn("Điều kiện 2?")
    await turn("Kiểm lại")
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    expect(await turn("VCB?")).toEqual([HPG_V4_NOTE])
  })

  test("focus, the other way: v4 saved before T3 still finds HPG in focus and injects the block", async () => {
    const { other, ids, turn } = chain()
    await turn("Hòa Phát?")
    await turn("Điều kiện 2?")
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    const t3 = await turn("Kiểm lại")
    expect(t3.length).toBe(1)
    expect(labelLine(t3[0]!)).toContain("bản 4 · ghi 20/10/2026 · người dùng tự ghi · thay cho bản 3")
  })

  test("a turn that never ended (dropped for context, then resent) gets its block again", async () => {
    const { turn } = chain()
    expect(await turn("Hòa Phát?", { ended: false })).toEqual([HPG_BLOCK_V3])
    expect(await turn("Hòa Phát?")).toEqual([HPG_BLOCK_V3])
    expect(await turn("Còn gì?")).toEqual([])
  })

  test("a new session starts with nothing sent; the old one keeps what it had", async () => {
    const { turn } = chain()
    expect(await turn("Hòa Phát?")).toEqual([HPG_BLOCK_V3])
    expect(await turn("Hòa Phát?", { sessionId: "s2" })).toEqual([HPG_BLOCK_V3])
    expect(await turn("Hòa Phát?")).toEqual([])
  })

  test("a ticker without a thesis, in a sector that has one: no block, no pointer", async () => {
    const { other, ids, turn } = chain()
    other.writer.createSubject({ kind: "ticker", alias: "NKG", sectorId: ids.steel })
    expect(await turn("NKG thế nào?")).toEqual([])
  })
})

describe("notes about what changed (Story 4)", () => {
  test("out of focus, v4 gives only a note; named again, the block 'replacing v3' and no repeated note", async () => {
    const { other, ids, turn } = chain()
    expect(await turn("Hòa Phát?")).toEqual([HPG_BLOCK_V3])
    expect(await turn("Còn ACB?")).toEqual([])
    expect(await turn("Còn FPT?")).toEqual([])
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    expect(await turn("Còn VCB?")).toEqual([HPG_V4_NOTE])
    const t5 = await turn("HPG thì sao?")
    expect(t5.length).toBe(1)
    expect(labelLine(t5[0]!)).toContain(
      "bản 4 · ghi 20/10/2026 · người dùng tự ghi · thay cho bản 3 đã gửi trước đó trong phiên]",
    )
    expect(await turn("Tiếp")).toEqual([])
  })

  test("a state change is noted once", async () => {
    const { other, ids, turn } = chain()
    await turn("Hòa Phát?")
    other.writer.setThesisState(ids.hpg, 3, "closed")
    expect(await turn("Tiếp đi")).toEqual(["[Memory · nhắc] Luận điểm HPG (bản 3) đã chuyển sang trạng thái: đã đóng."])
    expect(await turn("Tiếp nữa")).toEqual([])
  })

  test("a deleted thesis that was sent is noted once", async () => {
    const { other, ids, turn } = chain()
    await turn("Hòa Phát?")
    other.writer.deleteThesis(ids.hpg, 3)
    expect(await turn("Còn ACB?")).toEqual([
      "[Memory · nhắc] Luận điểm HPG đã bị người dùng xoá; không dùng nội dung luận điểm HPG phía trên nữa.",
    ])
    expect(await turn("Còn FPT?")).toEqual([])
  })

  test("nothing is noted about what this session never sent", async () => {
    const { other, notebook, turn } = chain()
    await turn("VCB?")
    other.writer.deleteLesson(7, 1)
    expect(await turn("Còn ACB thì sao?")).toEqual([])
    expect(await notebook.index(SID)).not.toContain("#7")
  })

  test("a note that never reached the history is sent again", async () => {
    const { other, ids, turn } = chain()
    await turn("Hòa Phát?")
    await turn("a")
    await turn("b")
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    expect(await turn("c", { ended: false })).toEqual([HPG_V4_NOTE])
    expect(await turn("d")).toEqual([HPG_V4_NOTE])
    expect(await turn("e")).toEqual([])
  })
})

describe("what was sent is read from the history (a new provider knows it too)", () => {
  const recallWith = async (history: ModelMessage[], query: string) =>
    (await nb.notebook().recall(query, { sessionId: "s1", history })).map((i) => i.text)

  test("blocks, notes and pointers already in the history are not sent again by a restarted app", async () => {
    const { other, ids, turn, history } = chain()
    const vnm = other.writer.createSubject({ kind: "ticker", alias: "VNM" }).id
    other.writer.saveThesis(vnm, null, { text: "x".repeat(350), conditions: Array.from({ length: 8 }, (_, i) => `${i}`.repeat(160)) })
    expect(await turn("Hòa Phát và VNM?")).toEqual([
      "[Memory · nhắc] Luận điểm VNM (bản 1) dài hơn giới hạn tự chèn; đọc bằng memory_read.",
      HPG_BLOCK_V3,
    ])
    await turn("a")
    await turn("b")
    other.writer.saveThesis(ids.hpg, 3, HPG_V4)
    expect(await turn("c")).toEqual([HPG_V4_NOTE])
    expect(await recallWith(history(), "Hòa Phát và VNM thì sao?")).toEqual([
      expect.stringContaining("bản 4 · ghi 20/10/2026 · người dùng tự ghi · thay cho bản 3"),
    ])
    expect(await recallWith(history(), "Còn gì?")).toEqual([])
  })

  test("a block masked in the history brings one deletion note; the note in the history stops it", async () => {
    const { other, turn, history, set } = chain()
    await turn("x")
    const read: ModelMessage[] = [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "memory_read", input: { lesson: 7 } }] },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c1", toolName: "memory_read", output: { type: "text", value: maskedLesson(7) } }],
      },
    ]
    set([...history(), ...read])
    other.writer.deleteLesson(7, 1)
    const note = "[Memory · nhắc] Bài học #7 đã bị người dùng xoá; không dùng nội dung #7 phía trên nữa."
    expect(await turn("Còn ACB?")).toEqual([note])
    expect(await turn("Còn FPT?")).toEqual([])
    expect(await recallWith(history(), "Còn VCB?")).toEqual([])
  })

  test("a lesson read by memory_read counts as sent: its new version is noted", async () => {
    const { other, turn, history, set } = chain()
    await turn("x")
    const block = (await nb.notebook().tools()[0]!.execute({ lesson: 7 }, { signal: new AbortController().signal, callId: "c" })) as string
    set([
      ...history(),
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "memory_read", input: { lesson: 7 } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "memory_read", output: { type: "text", value: block } }] },
    ])
    other.writer.reviseLesson(7, 1, { title: "Định giá ngân hàng", summary: "Dùng P/B, ROE và NIM" })
    expect(await turn("Tiếp")).toEqual([
      "[Memory · nhắc] Bài học #7 đã có bản 2; bản 1 phía trên đã cũ. Đọc bằng memory_read nếu cần.",
    ])
    expect(await turn("Tiếp nữa")).toEqual([])
  })

  test("the store error line is sent once per reason, read from the history", async () => {
    const store = nb.store()
    seedExample(store)
    nb.raw().run("PRAGMA user_version = 99")
    const first = await nb.notebook().recall("Hòa Phát?", { sessionId: "s1", history: [] })
    const err = "[Memory · lỗi] Kho memory không mở được: kho do phiên bản OpenTrading mới hơn tạo."
    expect(first.map((i) => i.text)).toEqual([err])
    const history = [userMessage("Hòa Phát?", [`<memory_lien_quan>
- ${err}
</memory_lien_quan>`]), { role: "assistant", content: "Trả lời." }] as ModelMessage[]
    expect(memoryLines(history).lines).toEqual([{ kind: "error", reason: "kho do phiên bản OpenTrading mới hơn tạo" }])
    expect(await nb.notebook().recall("Tiếp", { sessionId: "s1", history })).toEqual([])
  })
})

describe("code review fixes, round 3", () => {
  test("two notes in one turn: the next turn repeats neither", async () => {
    const { other, ids, turn } = chain()
    await turn("So sánh HSG với HPG")
    other.writer.setThesisState(ids.hpg, 3, "closed")
    other.writer.setThesisState(ids.hsg, 1, "watching")
    // Both notes go in one item, the way pack.ts puts every note line together.
    const t = await turn("a")
    expect(t.length).toBe(1)
    expect(t[0]).toContain("Luận điểm HPG (bản 3) đã chuyển sang trạng thái")
    expect(t[0]).toContain("Luận điểm HSG (bản 1) đã chuyển sang trạng thái")
    expect(await turn("b")).toEqual([])
  })

  test("a thesis deleted and written again, then named: the new block, no deletion note", async () => {
    const { other, turn } = chain()
    const fpt = other.writer.createSubject({ kind: "ticker", alias: "FPT" }).id
    other.writer.saveThesis(fpt, null, { text: "FPT-BAN-1", conditions: [] })
    expect((await turn("FPT?")).join("")).toContain("FPT-BAN-1")
    other.writer.deleteThesis(fpt, 1)
    other.writer.saveThesis(fpt, null, { text: "FPT-BAN-2", conditions: [] })
    const items = (await turn("FPT thế nào?")).join("\n")
    expect(items).toContain("FPT-BAN-2")
    expect(items).not.toContain("đã bị người dùng xoá")
  })

  test("the state the model saw last is the later of the block and the state note", async () => {
    const { other, ids, turn, history, set } = chain()
    await turn("Hòa Phát?")
    other.writer.setThesisState(ids.hpg, 3, "refuted")
    expect(await turn("a")).toEqual(["[Memory · nhắc] Luận điểm HPG (bản 3) đã chuyển sang trạng thái: đã bị bác bỏ."])
    other.writer.setThesisState(ids.hpg, 3, "watching")
    // A later memory_read shows the block with the state as it is now: watching.
    const block = (await nb.notebook().tools()[0]!.execute({ subject: "HPG" }, { signal: new AbortController().signal, callId: "c" })) as string
    set([
      ...history(),
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c9", toolName: "memory_read", input: { subject: "HPG" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c9", toolName: "memory_read", output: { type: "text", value: block } }] },
    ])
    expect(await turn("b")).toEqual([])
  })
})

describe("code review fixes", () => {
  test("a state that changes back and forth is noted each time it differs from what the model saw last", async () => {
    const { other, ids, turn } = chain()
    await turn("Hòa Phát?")
    other.writer.setThesisState(ids.hpg, 3, "refuted")
    expect(await turn("a")).toEqual(["[Memory · nhắc] Luận điểm HPG (bản 3) đã chuyển sang trạng thái: đã bị bác bỏ."])
    other.writer.setThesisState(ids.hpg, 3, "watching")
    expect(await turn("b")).toEqual(["[Memory · nhắc] Luận điểm HPG (bản 3) đã chuyển sang trạng thái: đang theo dõi."])
    other.writer.setThesisState(ids.hpg, 3, "refuted")
    expect(await turn("c")).toEqual(["[Memory · nhắc] Luận điểm HPG (bản 3) đã chuyển sang trạng thái: đã bị bác bỏ."])
    expect(await turn("d")).toEqual([])
  })

  test("a store error told before a turn that read fine is told again", async () => {
    const store = nb.store()
    seedExample(store)
    const err = "[Memory · lỗi] Kho memory không mở được: kho do phiên bản OpenTrading mới hơn tạo."
    const reminder = (items: string[]) => [`<memory_lien_quan>\n${items.map((t) => `- ${t}`).join("\n")}\n</memory_lien_quan>`]
    const history = [
      userMessage("Hòa Phát?", reminder([err])),
      { role: "assistant", content: "Trả lời." },
      userMessage("Hòa Phát nữa?", reminder([HPG_BLOCK_V3])),
      { role: "assistant", content: "Trả lời." },
    ] as ModelMessage[]
    nb.raw().run("PRAGMA user_version = 99")
    expect((await nb.notebook().recall("Tiếp", { sessionId: "s1", history })).map((i) => i.text)).toEqual([err])
  })

  test("a thesis sent under a code since retired: not announced as deleted, not injected again under the new code", async () => {
    const { other, ids, turn } = chain()
    expect(await turn("Hòa Phát?")).toEqual([HPG_BLOCK_V3])
    other.writer.addAlias(ids.hpg, "HPX")
    other.writer.retireAlias(ids.hpg, "HPG")
    expect(await turn("Còn ACB?")).toEqual([])
    // Typed words still match the codes in use only: HPX is found, HPG no longer is.
    expect(await turn("HPX thế nào?")).toEqual([])
    expect(await turn("HPG thì sao?", { sessionId: "s2" })).toEqual([])
  })
})

describe("speed (TC-012)", () => {
  test("100 theses and 100 lessons: the memory part of a request builds cold in under 50 ms", async () => {
    const w = nb.store().writer
    for (let i = 1; i <= 100; i++) {
      const id = w.createSubject({ kind: "ticker", alias: `MA${i}` }).id
      w.saveThesis(id, null, {
        text: `Luận điểm ${i}`,
        conditions: ["Sai nếu doanh thu giảm", "Sai nếu nợ tăng"],
        reviewBy: "2026-12-31",
      })
      w.addLesson({ title: `Bài học ${i}`, summary: `Tóm tắt ${i}`, tags: ["định giá"] })
    }
    // Three cold builds, each by a fresh provider on the same store; the fastest counts. One measure on a
    // slow CI machine, paused by a garbage collection or a virus scan, would fail at random.
    const runs: number[] = []
    for (let run = 0; run < 3; run++) {
      const notebook = nb.notebook()
      const start = performance.now()
      const items = await notebook.recall("So sánh MA1 với MA50 và MA99", { sessionId: "s1" })
      notebook.instructions()
      await notebook.index(SID)
      runs.push(performance.now() - start)
      expect(items.length).toBe(3)
      notebook.close()
    }
    console.log(`TC-012: memory part built cold in ${runs.map((ms) => ms.toFixed(1)).join(", ")} ms (100 theses, 100 lessons)`)
    expect(Math.min(...runs)).toBeLessThan(50)
  })
})
