import { expect, test } from "bun:test"
import { MemoryStoreError } from "../src/core/memory/store/errors"
import { FIXED_TIME, useTempStores } from "./helpers/memory-store"

const t = useTempStores()

function caught(fn: () => unknown): MemoryStoreError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(MemoryStoreError)
    return error as MemoryStoreError
  }
  throw new Error("expected a MemoryStoreError")
}

/** HPG at thesis version 2 and five constraint changes behind it. */
function arranged() {
  const store = t.open()
  const { writer } = store
  const hpg = writer.createSubject({ kind: "ticker", alias: "HPG" }).id
  writer.saveThesis(hpg, null, { text: "Bản 1", conditions: [] })
  writer.saveThesis(hpg, 1, { text: "Bản 2", conditions: ["Sai nếu biên gộp dưới 10%"] })
  for (let i = 0; i < 5; i++) writer.addConstraint({ kind: "constraint", text: `Ràng buộc ${i}` })
  return { store, hpg }
}

test("a decision records the thesis version the user saw and the constraint set at the time", () => {
  const { store, hpg } = arranged()
  expect(store.reader.constraintSet()).toBe(5)
  const saved = store.writer.addDecision({
    subjectId: hpg,
    thesisVersion: 2,
    action: "Mua HPG",
    reason: "Biên gộp hồi phục",
    confidence: "medium",
  })
  expect(saved).toEqual({ id: 1 })
  expect(store.reader.decision(1)).toEqual({
    id: 1,
    subjectId: hpg,
    basis: { version: 2 },
    constraintSet: 5,
    action: "Mua HPG",
    reason: "Biên gộp hồi phục",
    confidence: "medium",
    source: "manual",
    createdAt: FIXED_TIME.toISOString(),
  })
})

test("the basis stays the version the form showed, even when a newer one was saved meanwhile", () => {
  const { store, hpg } = arranged()
  store.writer.saveThesis(hpg, 2, { text: "Bản 3 từ cửa sổ khác", conditions: [] })
  store.writer.addDecision({ subjectId: hpg, thesisVersion: 2, action: "Mua HPG", reason: "Theo bản 2" })
  expect(store.reader.decision(1)).toMatchObject({ basis: { version: 2 } })
})

test("a basis that does not exist, is deleted, or belongs to another subject is refused and nothing is saved", () => {
  const { store, hpg } = arranged()
  const vnm = store.writer.createSubject({ kind: "ticker", alias: "VNM" }).id
  const buy = (subjectId: number, thesisVersion: number) => () =>
    store.writer.addDecision({ subjectId, thesisVersion, action: "Mua", reason: "?" })
  expect(caught(buy(hpg, 9)).kind).toBe("not_found")
  expect(caught(buy(vnm, 2)).kind).toBe("not_found")
  store.writer.deleteThesis(hpg, 2)
  expect(caught(buy(hpg, 2)).kind).toBe("deleted")
  expect(store.reader.decisions()).toEqual([])
})

test("the writer has no way to edit a decision", () => {
  const { store } = arranged()
  // @ts-expect-error decisions are append-only: there is no revise
  expect(store.writer.reviseDecision).toBeUndefined()
  expect(Object.keys(store.writer).filter((k) => /decision/i.test(k)).sort()).toEqual(["addDecision", "deleteDecision"])
})

test("a write that fails half way leaves no decision and does not move the constraint set", () => {
  const { store, hpg } = arranged()
  const raw = t.raw()
  raw.run("CREATE TRIGGER fail_decisions BEFORE INSERT ON decisions BEGIN SELECT RAISE(ABORT, 'giả lập lỗi đĩa'); END")
  raw.close(true)
  const error = caught(() =>
    store.writer.addDecision({ subjectId: hpg, thesisVersion: 2, action: "Mua HPG", reason: "?" }),
  )
  expect(error.kind).toBe("write_failed")
  expect(store.reader.decisions()).toEqual([])
  expect(store.reader.constraintSet()).toBe(5)
})

test("deleting the thesis leaves the decision, its basis marked deleted, with no thesis text copied in", () => {
  const { store, hpg } = arranged()
  store.writer.addDecision({ subjectId: hpg, thesisVersion: 2, action: "Mua HPG", reason: "Biên gộp hồi phục" })
  store.writer.deleteThesis(hpg, 2)
  expect(store.reader.decision(1)).toMatchObject({ action: "Mua HPG", basis: { version: 2, deleted: true } })
  expect(JSON.stringify(t.raw().query("SELECT * FROM decisions").all())).not.toContain("Bản 2")
})

test("a decision without a thesis is saved with no basis; an unknown subject is refused", () => {
  const { store } = arranged()
  const vnm = store.writer.createSubject({ kind: "ticker", alias: "VNM" }).id
  expect(store.writer.addDecision({ subjectId: vnm, action: "Bán VNM", reason: "Cơ cấu danh mục" })).toEqual({ id: 1 })
  expect(store.reader.decision(1)).toMatchObject({ subjectId: vnm, basis: "none", constraintSet: 5 })
  const unknown = caught(() => store.writer.addDecision({ subjectId: 999, action: "Mua MWG", reason: "?" }))
  expect(unknown.kind).toBe("not_found")
  expect(store.reader.decisions()).toHaveLength(1)
})

test("optional fields are checked: dates, confidence, lengths", () => {
  const { store, hpg } = arranged()
  const base = { subjectId: hpg, action: "Mua HPG", reason: "Lý do" }
  expect(caught(() => store.writer.addDecision({ ...base, reviewOn: "2026-02-30" })).kind).toBe("invalid")
  // @ts-expect-error only low / medium / high
  expect(caught(() => store.writer.addDecision({ ...base, confidence: "very" })).kind).toBe("invalid")
  expect(caught(() => store.writer.addDecision({ ...base, action: "x".repeat(121) })).kind).toBe("limit")
  expect(caught(() => store.writer.addDecision({ ...base, reason: "x".repeat(2001) })).kind).toBe("limit")
  store.writer.addDecision({ ...base, expectation: "Lãi 20%", reviewOn: "2027-03-31", changeMind: "Điều kiện 1 sai" })
  expect(store.reader.decision(1)).toMatchObject({
    expectation: "Lãi 20%",
    reviewOn: "2027-03-31",
    changeMind: "Điều kiện 1 sai",
  })
})

test("a deleted decision keeps its id and nothing else; ids go on from there", () => {
  const { store, hpg } = arranged()
  for (const action of ["A", "B", "C"]) store.writer.addDecision({ subjectId: hpg, action, reason: "Lý do riêng tư" })
  store.writer.deleteDecision(3)
  expect(store.reader.decision(3)).toMatchObject({ id: 3, deleted: true })
  expect(store.writer.addDecision({ subjectId: hpg, action: "D", reason: "?" }).id).toBe(4)
  expect(caught(() => store.writer.deleteDecision(3)).kind).toBe("deleted")
  expect(caught(() => store.writer.deleteDecision(99)).kind).toBe("not_found")
  expect(JSON.stringify(t.raw().query("SELECT * FROM decisions WHERE id = 3").all())).not.toContain("riêng tư")
})
