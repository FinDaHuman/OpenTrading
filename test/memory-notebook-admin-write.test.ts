import { describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { countChars } from "../src/core/memory/limits"
import { createNotebookAdmin, notebookAdmin, type NotebookAdmin } from "../src/core/memory/notebook/admin"
import type { NewSubjectDraft, ThesisDraft } from "../src/core/memory/notebook/drafts"
import { exportFileName, renderNotebookMarkdown } from "../src/core/memory/notebook/export"
import { MemoryStoreError } from "../src/core/memory/store/errors"
import type { MemoryStore, MemoryWriter } from "../src/core/memory/store/open"
import { DECISION_MARKER, seedExample, seedRenamed, useNotebookDir } from "./helpers/memory-notebook"

const nb = useNotebookDir()
const MARK = "MARKER-form-8c1d"
const KEY = "sk-ant-api03-" + "A1b2C3d4E5f6G7h8".repeat(3)

function setup() {
  const other = nb.store()
  const ids = seedExample(other)
  const renamed = seedRenamed(other)
  const admin = notebookAdmin(nb.notebook())!
  return { other, admin, ...ids, renamed }
}

const busy = () => new MemoryStoreError("busy", "Kho memory đang bận (một cửa sổ OpenTrading khác đang ghi). Thử lại.")

/** The same store with one write failing as busy: a step after the subjects were created. */
function failingAdmin(store: MemoryStore, op: keyof MemoryWriter): NotebookAdmin {
  const writer = {
    ...store.writer,
    [op]: () => {
      throw busy()
    },
  } as MemoryWriter
  return createNotebookAdmin({
    path: store.path,
    reader: () => store.reader,
    writer: () => writer,
    problem: () => undefined,
    closed: () => false,
  })
}

const thesis = (text = "Chuyển đổi số"): ThesisDraft => ({ text, conditions: ["Sai nếu doanh thu giảm"] })
const newTicker = (alias: string, extra: Partial<NewSubjectDraft> = {}): NewSubjectDraft => ({
  kind: "ticker",
  alias,
  otherAliases: [],
  uppercaseOnly: false,
  ...extra,
})
const withAlias = (store: MemoryStore, alias: string) =>
  store.reader.subjects().filter((s) => s.aliases.some((a) => !a.retiredAt && a.alias.toUpperCase() === alias.toUpperCase()))

describe("reads that fill a form", () => {
  test("constraint draft, active totals, sectors", () => {
    const { admin } = setup()
    expect(admin.constraintDraft(1)).toEqual({
      ok: true,
      value: { id: 1, version: 2, kind: "constraint", text: "Không dùng margin, kể cả T+0" },
    })
    expect(admin.constraintDraft(3)).toEqual({ ok: false, message: "Mục #3 đã bị xoá." })
    expect(admin.constraintDraft(99)).toEqual({ ok: false, message: "Không có mục #99." })
    const both = countChars("Không dùng margin, kể cả T+0") + countChars("Tối đa 20% danh mục cho một mã")
    expect(admin.activeConstraintChars("constraint")).toEqual({ ok: true, value: both })
    expect(admin.activeConstraintChars("constraint", 1)).toEqual({
      ok: true,
      value: countChars("Tối đa 20% danh mục cho một mã"),
    })
    expect(admin.sectors()).toMatchObject({ ok: true, value: [{ display: "Thép" }, { display: "Ngân hàng" }] })
  })

  test("lookupSubject: alias in use, a retired alias of another subject, nothing", () => {
    const { admin, hpg, renamed } = setup()
    const hit = admin.lookupSubject("  hpg ")
    expect(hit.ok && hit.value.found?.id).toBe(hpg)
    expect(hit.ok && hit.value.thesis?.version).toBe(3)
    const old = admin.lookupSubject("abc")
    expect(old).toMatchObject({ ok: true, value: { retired: { subjectId: renamed, display: "XYZ" } } })
    expect(old.ok && old.value.retired?.retiredAt).toBeString()
    expect(admin.lookupSubject("FPT")).toEqual({ ok: true, value: {} })
  })

  test("a deleted thesis is reported with its last version, so a rewrite says so", () => {
    const { admin, other, hpg } = setup()
    other.writer.deleteThesis(hpg, 3)
    const hit = admin.lookupSubject("HPG")
    expect(hit.ok && hit.value.thesis).toBeUndefined()
    expect(hit.ok && hit.value.deletedUpTo).toBe(3)
  })

  test("lesson draft names the subjects it applies to", () => {
    const { admin, banks } = setup()
    expect(admin.lessonDraft(7)).toMatchObject({
      ok: true,
      value: { id: 7, version: 1, title: "Định giá ngân hàng", appliesTo: [{ id: banks, display: "Ngân hàng" }] },
    })
    expect(admin.lessonDraft(1)).toEqual({ ok: false, message: "Bài học #1 đã bị xoá." })
  })

  test("a read that fails says why instead of returning an empty form", () => {
    const other = nb.store()
    seedExample(other)
    const reader = {
      ...other.reader,
      subjectByAlias: () => {
        throw new MemoryStoreError("corrupt", "Dữ liệu trong kho memory bị hỏng: thử")
      },
    }
    const admin = createNotebookAdmin({
      path: other.path,
      reader: () => reader,
      writer: () => other.writer,
      problem: () => undefined,
      closed: () => false,
    })
    expect(admin.lookupSubject("HPG")).toEqual({ ok: false, message: "Dữ liệu trong kho memory bị hỏng: thử" })
  })
})

describe("saveConstraint", () => {
  test("a constraint bumps the constraint set, a style does not", () => {
    const { admin, other } = setup()
    expect(admin.saveConstraint({ kind: "constraint", text: "Không bán khống" })).toEqual({
      ok: true,
      message: "Đã lưu ràng buộc #5 (bản 1). Có hiệu lực từ lượt hỏi kế tiếp.",
      saved: { id: 5, version: 1 },
    })
    expect(other.reader.constraintSet()).toBe(6)
    expect(other.reader.constraint(5)).toMatchObject({ kind: "constraint", text: "Không bán khống", source: "manual" })
    expect(admin.saveConstraint({ kind: "style", text: "Có nguồn ở cuối" })).toMatchObject({
      ok: true,
      message: "Đã lưu cách trình bày #6 (bản 1). Có hiệu lực từ lượt hỏi kế tiếp.",
    })
    expect(other.reader.constraintSet()).toBe(6)
  })

  test("no section chosen is refused before the store", () => {
    const { admin, other } = setup()
    expect(admin.saveConstraint({ text: "Không bán khống" })).toMatchObject({ ok: false, reason: "invalid" })
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })

  test("an edit sends the version the form read", () => {
    const { admin, other } = setup()
    expect(admin.saveConstraint({ kind: "constraint", text: "Không margin" }, { id: 1, expected: 2 })).toMatchObject({
      ok: true,
      message: "Đã lưu ràng buộc #1 (bản 3). Có hiệu lực từ lượt hỏi kế tiếp.",
    })
    expect(other.reader.constraint(1)).toMatchObject({ version: 3, text: "Không margin" })
  })

  test("edited elsewhere: nothing written, the current version comes back as a draft", () => {
    const { admin, other } = setup()
    other.writer.reviseConstraint(1, 2, { text: "Không margin bao giờ" })
    expect(admin.saveConstraint({ kind: "constraint", text: `Của tôi ${MARK}` }, { id: 1, expected: 2 })).toEqual({
      ok: false,
      reason: "conflict",
      message: "Mục này vừa được sửa ở nơi khác (đang là bản 3).",
      current: { id: 1, version: 3, kind: "constraint", text: "Không margin bao giờ" },
    })
    expect(other.reader.constraint(1)).toMatchObject({ version: 3 })
  })

  test("deleted elsewhere", () => {
    const { admin, other } = setup()
    other.writer.deleteConstraint(1, 2)
    expect(admin.saveConstraint({ kind: "constraint", text: "X" }, { id: 1, expected: 2 })).toEqual({
      ok: false,
      reason: "deleted",
      message: "Mục này đã bị xoá ở nơi khác.",
    })
  })

  test("each input error keeps its reason and never quotes what was typed", () => {
    const { admin, other } = setup()
    const cases = [
      { text: `${MARK} ${"x".repeat(200)}`, reason: "limit", field: "ràng buộc" },
      { text: `dùng key ${KEY} ${MARK}`, reason: "secret", field: "ràng buộc" },
      { text: "   ", reason: "invalid", field: "ràng buộc" },
    ] as const
    for (const c of cases) {
      const r = admin.saveConstraint({ kind: "constraint", text: c.text })
      expect(r).toMatchObject({ ok: false, reason: c.reason, field: c.field })
      expect(r.message).not.toContain(MARK)
      expect(r.message).not.toContain(KEY)
    }
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })

  test("busy: another window holds the write lock", () => {
    const other = nb.store()
    seedExample(other)
    const admin = notebookAdmin(nb.notebook({ busyTimeoutMs: 50 }))!
    const raw = nb.raw()
    raw.run("BEGIN IMMEDIATE")
    try {
      const started = Date.now()
      expect(admin.saveConstraint({ kind: "constraint", text: "Không bán khống" })).toEqual({
        ok: false,
        reason: "busy",
        message: "Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại.",
      })
      expect(Date.now() - started).toBeLessThan(2_000)
    } finally {
      raw.run("ROLLBACK")
    }
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })

  test("a closed notebook writes nothing and says so", () => {
    const other = nb.store()
    seedExample(other)
    const notebook = nb.notebook()
    const admin = notebookAdmin(notebook)!
    notebook.close()
    expect(admin.saveConstraint({ kind: "constraint", text: "X" })).toEqual({
      ok: false,
      reason: "failed",
      message: "Sổ ghi nhớ đã tắt; chưa lưu.",
    })
    expect(admin.lookupSubject("HPG")).toEqual({ ok: false, message: "Sổ ghi nhớ đã tắt." })
    expect(other.reader.constraints("constraint")).toHaveLength(2)
  })
})

describe("saveThesis", () => {
  test("an edit makes the next version", () => {
    const { admin, other, hpg } = setup()
    const r = admin.saveThesis({ id: hpg }, 3, {
      text: "Hưởng lợi từ đầu tư công",
      conditions: ["Sai nếu biên gộp dưới 10% hai quý liền", "Sai nếu tồn kho tăng quá 25%"],
      reviewBy: "31/12/2026",
    })
    expect(r).toEqual({ ok: true, message: "Đã lưu luận điểm HPG bản 4.", saved: { id: hpg, version: 4 } })
    expect(other.reader.thesis(hpg)).toMatchObject({ version: 4, reviewBy: "2026-12-31" })
    expect(other.reader.thesisVersion(hpg, 3)).toMatchObject({ text: "Hưởng lợi từ đầu tư công" })
  })

  test("a review date that is not a day is refused by name", () => {
    const { admin, hpg } = setup()
    expect(admin.saveThesis({ id: hpg }, 3, { ...thesis(), reviewBy: "cuối năm" })).toEqual({
      ok: false,
      reason: "invalid",
      field: "hạn xem lại",
      message: "«hạn xem lại» phải là ngày dạng DD/MM/YYYY.",
    })
  })

  test("a new ticker with a new sector and another alias: one subject, displayed by its code", () => {
    const { admin, other } = setup()
    const r = admin.saveThesis(
      newTicker("fpt", { sector: { newName: "Công nghệ" }, otherAliases: ["FPT Corp"] }),
      null,
      thesis(),
    )
    expect(r).toMatchObject({ ok: true, message: "Đã lưu luận điểm FPT bản 1.", saved: { version: 1 } })
    const [fpt] = withAlias(other, "FPT")
    expect(fpt).toMatchObject({ kind: "ticker", display: "FPT", currentVersion: 1 })
    expect(fpt!.aliases.map((a) => a.alias).sort()).toEqual(["FPT", "FPT Corp"])
    const sector = other.reader.subject(fpt!.sectorId!)
    expect(sector).toMatchObject({ kind: "sector", display: "Công nghệ" })
  })

  test("a thesis rewritten after a delete continues the count", () => {
    const { admin, other, hpg } = setup()
    other.writer.deleteThesis(hpg, 3)
    expect(admin.saveThesis({ id: hpg }, null, thesis())).toMatchObject({
      ok: true,
      message: "Đã lưu luận điểm HPG bản 4.",
    })
  })

  test("a retired alias of another subject makes a new subject; that subject is untouched", () => {
    const { admin, other, renamed } = setup()
    const before = other.reader.subject(renamed)
    const r = admin.saveThesis(newTicker("ABC"), null, thesis())
    expect(r).toMatchObject({ ok: true, message: "Đã lưu luận điểm ABC bản 1." })
    const [abc] = withAlias(other, "ABC")
    expect(abc!.id).not.toBe(renamed)
    expect(abc!.currentVersion).toBe(1)
    expect(other.reader.subject(renamed)).toEqual(before!)
  })

  test("an alias in use by another subject is refused before anything is created", () => {
    const { admin, other } = setup()
    const count = other.reader.subjects().length
    const r = admin.saveThesis(newTicker("FPT", { otherAliases: ["HPG"] }), null, thesis(MARK))
    expect(r).toMatchObject({ ok: false, reason: "alias_taken", field: "bí danh" })
    expect(r.message).toContain("Bí danh «HPG» đang thuộc chủ đề")
    expect(r.message).not.toContain(MARK)
    expect(other.reader.subjects()).toHaveLength(count)
  })

  test("content is checked before a subject is created", () => {
    const { admin, other } = setup()
    const count = other.reader.subjects().length
    expect(admin.saveThesis(newTicker("FPT"), null, thesis("x".repeat(351)))).toMatchObject({
      ok: false,
      reason: "limit",
    })
    expect(admin.saveThesis(newTicker("FPT"), null, { text: "T", conditions: ["  "] })).toMatchObject({
      ok: false,
      reason: "invalid",
    })
    expect(other.reader.subjects()).toHaveLength(count)
  })

  test("fails after the subjects were created: partial names them; confirming again creates no second one", () => {
    const { other } = setup()
    const failing = failingAdmin(other, "saveThesis")
    const r = failing.saveThesis(newTicker("FPT", { sector: { newName: "Công nghệ" } }), null, thesis())
    expect(r.ok).toBe(false)
    if (r.ok || r.reason === "conflict") throw new Error("expected a partial failure")
    expect(r.reason).toBe("busy")
    expect(r.partial!.message).toBe(
      "Đã tạo chủ đề Công nghệ, FPT; luận điểm chưa lưu: Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại.",
    )
    const [fpt] = withAlias(other, "FPT")
    const [tech] = withAlias(other, "Công nghệ")
    expect(r.partial!.created).toEqual([
      { role: "sector", id: tech!.id, display: "Công nghệ" },
      { role: "subject", id: fpt!.id, display: "FPT", aliases: ["FPT"] },
    ])
    expect(fpt!.sectorId).toBe(tech!.id)

    const admin = notebookAdmin(nb.notebook())!
    expect(admin.saveThesis({ id: fpt!.id }, null, thesis())).toMatchObject({
      ok: true,
      message: "Đã lưu luận điểm FPT bản 1.",
    })
    expect(withAlias(other, "FPT")).toHaveLength(1)
    expect(withAlias(other, "Công nghệ")).toHaveLength(1)
  })

  test("conflict carries the current thesis as a draft; deleted elsewhere is 'deleted'", () => {
    const { admin, other, hpg } = setup()
    other.writer.saveThesis(hpg, 3, { text: "Hưởng lợi từ đầu tư công và giá thép phục hồi", conditions: [] })
    expect(admin.saveThesis({ id: hpg }, 3, thesis())).toEqual({
      ok: false,
      reason: "conflict",
      message: "Mục này vừa được sửa ở nơi khác (đang là bản 4).",
      current: {
        version: 4,
        text: "Hưởng lợi từ đầu tư công và giá thép phục hồi",
        detail: undefined,
        conditions: [],
        reviewBy: undefined,
      },
    })
    other.writer.deleteThesis(hpg, 4)
    expect(admin.saveThesis({ id: hpg }, 4, thesis())).toMatchObject({ ok: false, reason: "deleted" })
  })
})

describe("setThesisState", () => {
  test("changes the state, not the version", () => {
    const { admin, other, hpg } = setup()
    expect(admin.setThesisState(hpg, 3, "refuted")).toEqual({
      ok: true,
      message: "Đã đổi trạng thái luận điểm HPG thành «đã bị bác bỏ».",
      saved: { id: hpg, version: 3 },
    })
    expect(other.reader.subject(hpg)).toMatchObject({ thesisState: "refuted", currentVersion: 3 })
    expect(admin.setThesisState(hpg, 2, "closed")).toMatchObject({ ok: false, reason: "conflict" })
  })
})

describe("saveLesson", () => {
  test("a new lesson, applying to a new sector created on the way", () => {
    const { admin, other, banks } = setup()
    const r = admin.saveLesson({
      title: "Định giá chứng khoán",
      summary: "Dùng P/B",
      appliesTo: [
        { id: banks, display: "Ngân hàng" },
        { newName: "Chứng khoán", kind: "sector" },
      ],
      tags: ["định giá"],
    })
    expect(r).toEqual({ ok: true, message: "Đã lưu bài học #8 (bản 1).", saved: { id: 8, version: 1 } })
    const [sec] = withAlias(other, "Chứng khoán")
    expect(sec).toMatchObject({ kind: "sector" })
    expect(other.reader.lesson(8)).toMatchObject({ appliesTo: [banks, sec!.id], source: "manual" })
  })

  test("an edit of #7 nobody else touched makes version 2", () => {
    const { admin, other, banks } = setup()
    const r = admin.saveLesson(
      { title: "Định giá ngân hàng", summary: "P/B", appliesTo: [{ id: banks, display: "Ngân hàng" }], tags: [] },
      { id: 7, expected: 1 },
    )
    expect(r).toMatchObject({ ok: true, message: "Đã lưu bài học #7 (bản 2)." })
    expect(other.reader.lesson(7)).toMatchObject({ version: 2, summary: "P/B" })
  })

  test("partial with a new 'applies to' subject; confirming again with its id creates no second one", () => {
    const { other } = setup()
    const draft = { title: "Bài mới", summary: "Tóm tắt", tags: [] }
    const r = failingAdmin(other, "addLesson").saveLesson({
      ...draft,
      appliesTo: [{ newName: "Chứng khoán", kind: "sector" }],
    })
    if (r.ok || r.reason === "conflict") throw new Error("expected a partial failure")
    const [sec] = withAlias(other, "Chứng khoán")
    expect(r.partial).toEqual({
      message: "Đã tạo chủ đề Chứng khoán; bài học chưa lưu: Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại.",
      created: [{ role: "applies_to", index: 0, id: sec!.id, display: "Chứng khoán" }],
    })
    const admin = notebookAdmin(nb.notebook())!
    expect(admin.saveLesson({ ...draft, appliesTo: [{ id: sec!.id, display: "Chứng khoán" }] })).toMatchObject({
      ok: true,
    })
    expect(withAlias(other, "Chứng khoán")).toHaveLength(1)
  })
})

describe("saveDecision", () => {
  test("rests on the version the form showed, even when a newer one exists", () => {
    const { admin, other, hpg } = setup()
    other.writer.saveThesis(hpg, 3, { text: "Bản 4", conditions: [] })
    const r = admin.saveDecision({ id: hpg }, { action: "Mua HPG", reason: "Biên gộp hồi phục", basis: { version: 3 } })
    expect(r).toEqual({
      ok: true,
      message: "Đã ghi quyết định D2 (căn cứ: luận điểm HPG bản 3).",
      saved: { id: 2 },
    })
    expect(other.reader.decision(2)).toMatchObject({ basis: { version: 3 }, constraintSet: 5, source: "manual" })
  })

  test("no thesis behind it", () => {
    const { admin, other, vcb } = setup()
    expect(admin.saveDecision({ id: vcb }, { action: "Mua VCB", reason: "Lý do", basis: "none" })).toMatchObject({
      ok: true,
      message: "Đã ghi quyết định D2 (căn cứ: không có luận điểm).",
    })
    expect(other.reader.decision(2)).toMatchObject({ basis: "none" })
  })

  test("a ticker not in the notebook is created, without a thesis", () => {
    const { admin, other } = setup()
    expect(
      admin.saveDecision(newTicker("mwg"), { action: "Mua MWG", reason: "Lý do", confidence: "medium", basis: "none" }),
    ).toMatchObject({ ok: true })
    const [mwg] = withAlias(other, "MWG")
    expect(mwg).toMatchObject({ display: "MWG", kind: "ticker" })
    expect(mwg!.currentVersion).toBeUndefined()
  })

  test("the version shown was deleted: nothing written", () => {
    const { admin, other, hpg } = setup()
    other.writer.deleteThesis(hpg, 3)
    expect(admin.saveDecision({ id: hpg }, { action: "Mua", reason: MARK, basis: { version: 3 } })).toEqual({
      ok: false,
      reason: "deleted",
      message: "Luận điểm HPG bản 3 vừa bị xoá. Ghi quyết định không gắn luận điểm, hoặc huỷ.",
    })
    expect(other.reader.decisions()).toHaveLength(1)
  })

  test("partial for a new ticker; confirming again with its id creates no second one", () => {
    const { other } = setup()
    const draft = { action: "Mua MWG", reason: "Lý do", basis: "none" } as const
    const r = failingAdmin(other, "addDecision").saveDecision(newTicker("MWG"), draft)
    if (r.ok || r.reason === "conflict") throw new Error("expected a partial failure")
    const [mwg] = withAlias(other, "MWG")
    expect(r.partial!.created).toEqual([{ role: "subject", id: mwg!.id, display: "MWG", aliases: ["MWG"] }])
    expect(r.partial!.message).toStartWith("Đã tạo chủ đề MWG; quyết định chưa ghi: ")
    const admin = notebookAdmin(nb.notebook())!
    expect(admin.saveDecision({ id: mwg!.id }, draft)).toMatchObject({ ok: true })
    expect(withAlias(other, "MWG")).toHaveLength(1)
  })
})

describe("export to Markdown", () => {
  // 15:04:05 on 03/11/2026 in Vietnam.
  const AT = new Date("2026-11-03T08:04:05.000Z")

  test("four groups, each entry with id or code, version, absolute date, source; no deleted entry; no decision", () => {
    const { admin } = setup()
    const md = renderNotebookMarkdown(admin.entries(), { decisions: false, at: AT })
    expect(md).toStartWith("# Sổ ghi nhớ\n")
    expect(md).toContain("Xuất lúc 15:04 ngày 03/11/2026 (giờ Việt Nam).")
    expect(md).toContain("File xuất là bản sao; xoá trong sổ không xoá file này.")
    for (const part of [
      "## Ràng buộc",
      "### #1 · bản 2",
      "Không dùng margin, kể cả T+0",
      "Bản 2 · lưu 20/10/2026 · nguồn: tự ghi",
      "## Cách trình bày",
      "### #2 · bản 1",
      "## Luận điểm",
      "### HPG · bản 3",
      "(1) Sai nếu biên gộp dưới 10% hai quý liền",
      "(2) Sai nếu tồn kho tăng quá 30%",
      "## Bài học",
      "### #7 · bản 1",
      "Định giá ngân hàng",
    ]) {
      expect(md).toContain(part)
    }
    expect(md).not.toContain("Bài tạm")
    expect(md).not.toContain("## Quyết định")
    expect(md).not.toContain(DECISION_MARKER)
    expect(md).not.toContain("Mua HPG")
    expect(md).not.toContain("\r")
  })

  test("with decisions asked for: the decision log and what each rested on", () => {
    const { admin } = setup()
    const md = renderNotebookMarkdown(admin.entries(), { decisions: true, at: AT })
    expect(md).toContain("## Quyết định")
    expect(md).toContain("### D1")
    expect(md).toContain(DECISION_MARKER)
    expect(md).toContain("Dựa trên luận điểm bản 3")
  })

  test("file name: the day, then the time, then none (never over an existing file)", () => {
    expect(exportFileName(AT, () => false)).toBe("so-ghi-nho-03-11-2026.md")
    expect(exportFileName(AT, (n) => n === "so-ghi-nho-03-11-2026.md")).toBe("so-ghi-nho-03-11-2026-150405.md")
    expect(exportFileName(AT, () => true)).toBeUndefined()
  })

  test("exportMarkdown writes next to the store, in exports/; a second file never replaces the first", async () => {
    const { admin } = setup()
    const first = await admin.exportMarkdown({ decisions: false })
    if (!first.ok) throw new Error(first.message)
    expect(path.dirname(first.file)).toBe(path.join(nb.dir(), "exports"))
    expect(readFileSync(first.file, "utf8")).not.toContain(DECISION_MARKER)
    const second = await admin.exportMarkdown({ decisions: true })
    if (!second.ok) throw new Error(second.message)
    expect(second.file).not.toBe(first.file)
    expect(readFileSync(second.file, "utf8")).toContain(DECISION_MARKER)
    expect(readFileSync(first.file, "utf8")).not.toContain(DECISION_MARKER)
  })

  test("a folder that cannot be written: an error, never 'exported'", async () => {
    const { admin } = setup()
    writeFileSync(path.join(nb.dir(), "exports"), "a file where the folder should be")
    const r = await admin.exportMarkdown({ decisions: false })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toStartWith("Không xuất được sổ ghi nhớ: ")
  })
})

describe("subjects made along the way", () => {
  test("the main code fails to be added after the subject exists: confirming again adds it, no second subject", () => {
    const { other } = setup()
    const r = failingAdmin(other, "addAlias").saveThesis(newTicker("FPT", { otherAliases: ["FPT Corp"] }), null, thesis())
    if (r.ok || r.reason === "conflict") throw new Error("expected a partial failure")
    const made = r.partial!.created.find((c) => c.role === "subject")!
    expect(made).toMatchObject({ display: "FPT Corp", aliases: ["FPT Corp", "FPT"] })
    expect(other.reader.subjectByAlias("FPT")).toBeUndefined()
    const admin = notebookAdmin(nb.notebook())!
    expect(admin.saveThesis({ id: made.id, aliases: made.aliases }, null, thesis())).toMatchObject({
      ok: true,
      message: "Đã lưu luận điểm FPT bản 1.",
    })
    expect(other.reader.subjectByAlias("FPT")).toMatchObject({ id: made.id, display: "FPT" })
    expect(other.reader.subjects().filter((s) => s.aliases.some((a) => a.alias === "FPT Corp"))).toHaveLength(1)
  })

  test("a lesson naming one new subject twice creates it once", () => {
    const { admin, other } = setup()
    const r = admin.saveLesson({
      title: "Bài mới",
      summary: "Tóm tắt",
      appliesTo: [
        { newName: "Chứng khoán", kind: "sector" },
        { newName: "chứng khoán", kind: "sector" },
      ],
      tags: [],
    })
    expect(r).toMatchObject({ ok: true })
    expect(withAlias(other, "Chứng khoán")).toHaveLength(1)
  })

  test("a lesson on a market subject is refused before any new subject is created", () => {
    const { admin, other } = setup()
    const market = other.writer.createSubject({ kind: "market", alias: "VNINDEX" }).id
    const count = other.reader.subjects().length
    const r = admin.saveLesson({
      title: "Bài mới",
      summary: "Tóm tắt",
      appliesTo: [
        { newName: "Chứng khoán", kind: "sector" },
        { id: market, display: "VNINDEX" },
      ],
      tags: [],
    })
    expect(r).toMatchObject({ ok: false, reason: "invalid" })
    expect(r.ok || r.reason === "conflict" ? undefined : r.partial).toBeUndefined()
    expect(other.reader.subjects()).toHaveLength(count)
  })
})
