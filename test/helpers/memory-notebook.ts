import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach } from "bun:test"
import { openNotebook, type NotebookOptions } from "../../src/core/memory/notebook/lifecycle"
import type { NotebookMemory } from "../../src/core/memory/notebook/provider"
import { openMemoryStore, type MemoryStore, type MemoryStoreOptions } from "../../src/core/memory/store/open"
import { testClock } from "./memory-store"

/** 20/10/2026 in Vietnam: the day the example's theses were saved. */
export const SAVED_AT = new Date("2026-10-20T03:00:00.000Z")

/**
 * A temp data folder per test. The notebook provider and any other connection (a "second window" that
 * edits the store) are all closed in afterEach before the folder goes: Windows keeps an open SQLite file locked.
 */
export function useNotebookDir() {
  let dir = ""
  const closers: (() => void)[] = []
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ot-notebook-"))
  })
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) close()
    await rm(dir, { recursive: true, force: true })
  })
  const file = () => path.join(dir, "memory.db")
  return {
    dir: () => dir,
    file,
    /** Another window's connection, for seeding and editing behind the provider's back. */
    store(opts: MemoryStoreOptions = {}): MemoryStore {
      const store = openMemoryStore(file(), { now: testClock(SAVED_AT).now, ...opts })
      closers.push(() => store.close())
      return store
    },
    notebook(opts: NotebookOptions = {}): NotebookMemory {
      const notebook = openNotebook(file(), opts)
      closers.push(() => notebook.close())
      return notebook
    },
    raw(): Database {
      const db = new Database(file(), { strict: true })
      closers.push(() => db.close(true))
      return db
    },
    /** Something else the test opened that must be closed before the folder goes. */
    track(close: () => void) {
      closers.push(close)
    },
  }
}

export const DECISION_MARKER = "MARKER-quyet-dinh-7f3a"

/**
 * The spec's shared example (§2): constraints #1 (version 2) and #4, style #2; sector Thép (thesis
 * version 2); HPG (aliases HPG, Hòa Phát; sector Thép; thesis version 3); HSG (refuted); VCB (no thesis);
 * lessons #3 and #7; decision D1 whose reason carries a unique marker.
 */
export function seedExample(store: MemoryStore) {
  const w = store.writer
  w.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  w.reviseConstraint(1, 1, { text: "Không dùng margin, kể cả T+0" })
  w.addConstraint({ kind: "style", text: "Trả lời ngắn, có bảng" })
  w.addConstraint({ kind: "constraint", text: "Tạm" })
  w.deleteConstraint(3, 1)
  w.addConstraint({ kind: "constraint", text: "Tối đa 20% danh mục cho một mã" })

  const steel = w.createSubject({ kind: "sector", alias: "Thép" }).id
  w.saveThesis(steel, null, { text: "Chu kỳ thép hồi phục", conditions: [] })
  w.saveThesis(steel, 1, { text: "Chu kỳ thép hồi phục năm 2026", conditions: ["Sai nếu giá thép giảm 20%"] })
  // The display name is the alias added last: "HPG", as in the spec's example.
  const hpg = w.createSubject({ kind: "ticker", alias: "Hòa Phát", sectorId: steel }).id
  w.addAlias(hpg, "HPG")
  w.saveThesis(hpg, null, { text: "Bản 1", conditions: [] })
  w.saveThesis(hpg, 1, { text: "Bản 2", conditions: [] })
  w.saveThesis(hpg, 2, HPG_V3)
  const hsg = w.createSubject({ kind: "ticker", alias: "HSG", sectorId: steel }).id
  w.saveThesis(hsg, null, { text: "Xuất khẩu tôn hồi phục", conditions: [] })
  w.setThesisState(hsg, 1, "refuted")
  const vcb = w.createSubject({ kind: "ticker", alias: "VCB" }).id
  const banks = w.createSubject({ kind: "sector", alias: "Ngân hàng" }).id

  for (let i = 1; i <= 7; i++) {
    if (i === 3) w.addLesson({ title: "Quản trị rủi ro khi giải ngân", summary: "Giải ngân từng phần, không dồn một lần" })
    else if (i === 7) w.addLesson(LESSON_7(banks))
    else w.addLesson({ title: `Bài tạm ${i}`, summary: "Tạm" })
  }
  for (const id of [1, 2, 4, 5, 6]) w.deleteLesson(id, 1)

  w.addDecision({ subjectId: hpg, thesisVersion: 3, action: "Mua HPG", reason: `Biên gộp hồi phục ${DECISION_MARKER}` })
  return { steel, hpg, hsg, vcb, banks }
}

/** Spec 003's subject #9: a ticker whose code changed from ABC to XYZ (ABC retired, so free to reuse). No thesis. */
export function seedRenamed(store: MemoryStore) {
  const w = store.writer
  const id = w.createSubject({ kind: "ticker", alias: "ABC" }).id
  w.addAlias(id, "XYZ")
  w.retireAlias(id, "ABC")
  return id
}

export const HPG_V3 = {
  text: "Hưởng lợi từ đầu tư công",
  detail: "Đầu tư công giải ngân mạnh năm 2026",
  conditions: ["Sai nếu biên gộp dưới 10% hai quý liền", "Sai nếu tồn kho tăng quá 30%"],
  reviewBy: "2026-12-31",
}

export const LESSON_7 = (banks: number) => ({
  title: "Định giá ngân hàng",
  summary: "Dùng P/B và ROE, không dùng P/E",
  appliesTo: [banks],
  exceptions: "Ngân hàng đang tái cơ cấu",
  detail: "So P/B với trung bình ngành",
  tags: ["định giá"],
})

export const HPG_BLOCK_V3 = [
  "[Memory · luận điểm · HPG · bản 3 · ghi 20/10/2026 · người dùng tự ghi]",
  "Trạng thái: đang theo dõi",
  "Luận điểm: Hưởng lợi từ đầu tư công",
  "Sai nếu: (1) biên gộp dưới 10% hai quý liền; (2) tồn kho tăng quá 30%",
  "Hạn xem lại: 31/12/2026",
  "Liên quan: luận điểm ngành Thép (bản 2), đọc bằng memory_read",
].join("\n")
