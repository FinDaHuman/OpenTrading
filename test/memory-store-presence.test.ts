import { rm } from "node:fs/promises"
import { describe, expect, test } from "bun:test"
import { readPresence } from "../src/core/memory/store/presence"
import { openStoreReadOnly } from "../src/core/memory/store/read-only"
import { useTempStores } from "./helpers/memory-store"

const t = useTempStores()
const MARKER = "MARKER-quyet-dinh-presence-51c2"

/**
 * HPG (theses 1–3) whose code was renamed HPX; ABC reused: an old subject that gave the alias up and a new
 * one using it, each with thesis version 1; VCB whose thesis was deleted; lesson 1 (live, two versions),
 * lesson 2 (deleted); a decision whose reason carries a marker.
 */
function seed() {
  const store = t.open()
  const w = store.writer
  const hpg = w.createSubject({ kind: "ticker", alias: "HPG" }).id
  w.saveThesis(hpg, null, { text: "Bản 1", conditions: [] })
  w.saveThesis(hpg, 1, { text: "Bản 2", conditions: ["giá thép giảm"] })
  w.saveThesis(hpg, 2, { text: "Bản 3 & <tag>", conditions: ["a", "b"], reviewBy: "2026-12-31", detail: "Chi tiết 3" })
  w.addAlias(hpg, "HPX")
  w.retireAlias(hpg, "HPG")
  const oldAbc = w.createSubject({ kind: "ticker", alias: "ABC" }).id
  w.saveThesis(oldAbc, null, { text: "ABC cũ", conditions: [] })
  w.addAlias(oldAbc, "ABD")
  w.retireAlias(oldAbc, "ABC")
  const newAbc = w.createSubject({ kind: "ticker", alias: "ABC" }).id
  w.saveThesis(newAbc, null, { text: "ABC mới", conditions: [] })
  const vcb = w.createSubject({ kind: "ticker", alias: "VCB" }).id
  w.saveThesis(vcb, null, { text: "VCB đã xoá", conditions: [] })
  w.deleteThesis(vcb, 1)
  const l1 = w.addLesson({ title: "Cắt lỗ", summary: "Cắt lỗ sớm", exceptions: "Khi hoảng loạn", tags: ["kỷ luật"] }).id
  w.reviseLesson(l1, 1, { title: "Cắt lỗ", summary: "Cắt lỗ sớm hơn", tags: [] })
  const l2 = w.addLesson({ title: "Xoá", summary: "Sẽ xoá" }).id
  w.deleteLesson(l2, 1)
  w.addDecision({ subjectId: hpg, thesisVersion: 3, action: "Mua", reason: MARKER })
  store.close()
  return { hpg, oldAbc, newAbc, l1, l2 }
}

describe("readPresence", () => {
  test("live versions by lesson number and version; deleted, missing versions and decisions never come out", () => {
    const ids = seed()
    const store = openStoreReadOnly(t.file())
    if (store.state !== "open") throw new Error(store.state)
    try {
      const found = store.presence([
        { kind: "lesson", id: ids.l1, version: 1 },
        { kind: "lesson", id: ids.l1, version: 2 },
        { kind: "lesson", id: ids.l1, version: 3 },
        { kind: "lesson", id: ids.l2, version: 1 },
        { kind: "lesson", id: 99, version: 1 },
      ])
      expect(found).toEqual([
        {
          kind: "lesson",
          id: ids.l1,
          version: 1,
          title: "Cắt lỗ",
          summary: "Cắt lỗ sớm",
          exceptions: "Khi hoảng loạn",
          tags: ["kỷ luật"],
        },
        { kind: "lesson", id: ids.l1, version: 2, title: "Cắt lỗ", summary: "Cắt lỗ sớm hơn", tags: [] },
      ])
      expect(JSON.stringify(found)).not.toContain(MARKER)
    } finally {
      store.close()
    }
  })

  test("theses by the name in the label: retired aliases match, a reused name gives every subject", () => {
    const ids = seed()
    const store = openStoreReadOnly(t.file())
    if (store.state !== "open") throw new Error(store.state)
    try {
      const found = store.presence([
        { kind: "thesis", name: "HPG", version: 3 },
        { kind: "thesis", name: "HPX", version: 2 },
        { kind: "thesis", name: "ABC", version: 1 },
        { kind: "thesis", name: "VCB", version: 1 },
        { kind: "thesis", name: "HPG", version: 9 },
        { kind: "thesis", name: "KHÔNG-CÓ", version: 1 },
      ])
      expect(found).toEqual([
        {
          kind: "thesis",
          name: "HPG",
          subjectId: ids.hpg,
          version: 3,
          text: "Bản 3 & <tag>",
          conditions: ["a", "b"],
          reviewBy: "2026-12-31",
          detail: "Chi tiết 3",
        },
        { kind: "thesis", name: "HPX", subjectId: ids.hpg, version: 2, text: "Bản 2", conditions: ["giá thép giảm"] },
        { kind: "thesis", name: "ABC", subjectId: ids.oldAbc, version: 1, text: "ABC cũ", conditions: [] },
        { kind: "thesis", name: "ABC", subjectId: ids.newAbc, version: 1, text: "ABC mới", conditions: [] },
      ])
      expect(JSON.stringify(found)).not.toContain(MARKER)
    } finally {
      store.close()
    }
  })

  test("a name is matched as the label prints it (escaped)", () => {
    const store = t.open()
    const id = store.writer.createSubject({ kind: "sector", alias: "Dầu & khí" }).id
    store.writer.saveThesis(id, null, { text: "Dầu", conditions: [] })
    store.close()
    const ro = openStoreReadOnly(t.file())
    if (ro.state !== "open") throw new Error(ro.state)
    try {
      expect(ro.presence([{ kind: "thesis", name: "Dầu &amp; khí", version: 1 }]).map((p) => p.version)).toEqual([1])
      expect(ro.presence([{ kind: "thesis", name: "Dầu & khí", version: 1 }])).toEqual([])
    } finally {
      ro.close()
    }
  })

  test("the pure reader on a plain connection; the read-only store's connection is closed after", async () => {
    const ids = seed()
    const db = t.raw()
    expect(readPresence(db, [{ kind: "lesson", id: ids.l1, version: 2 }]).map((p) => p.version)).toEqual([2])
    db.close(true)
    const store = openStoreReadOnly(t.file())
    if (store.state !== "open") throw new Error(store.state)
    store.presence([{ kind: "thesis", name: "HPG", version: 3 }])
    store.close()
    // Windows refuses to remove a file an open connection holds.
    await rm(t.file(), { force: false })
  })
})
