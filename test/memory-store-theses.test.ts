import { expect, test } from "bun:test"
import { MemoryStoreError } from "../src/core/memory/store/errors"
import { FIXED_TIME, testClock, useTempStores } from "./helpers/memory-store"

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

const C1 = "Sai nếu biên gộp dưới 10% hai quý liền"
const C2 = "Sai nếu tồn kho tăng quá 30%"

function hpg(store = t.open()) {
  const steel = store.writer.createSubject({ kind: "sector", alias: "Thép" }).id
  const id = store.writer.createSubject({ kind: "ticker", alias: "HPG", sectorId: steel }).id
  return { store, steel, id }
}

test("a ticker in the steel sector gets an internal id and a first thesis with ordered conditions", () => {
  const { store, steel, id } = hpg()
  const saved = store.writer.saveThesis(id, null, {
    text: "Hưởng lợi từ đầu tư công",
    conditions: [C1, C2],
    reviewBy: "2026-12-31",
  })
  expect(saved).toEqual({ id, version: 1 })
  expect(store.reader.subject(id)).toMatchObject({
    id,
    kind: "ticker",
    display: "HPG",
    sectorId: steel,
    uppercaseOnly: false,
    lastVersion: 1,
    currentVersion: 1,
    thesisState: "watching",
    thesisStateAt: FIXED_TIME.toISOString(),
  })
  expect(store.reader.thesis(id)).toEqual({
    subjectId: id,
    version: 1,
    text: "Hưởng lợi từ đầu tư công",
    conditions: [C1, C2],
    reviewBy: "2026-12-31",
    validFrom: FIXED_TIME.toISOString(),
    source: "manual",
  })
  // "Not there yet" is a version mark too: a second first-save is a conflict.
  expect(caught(() => store.writer.saveThesis(id, null, { text: "Khác", conditions: [] })).kind).toBe("conflict")
})

test("a new version closes the previous one at exactly the moment it starts", () => {
  const clock = testClock()
  const { store, id } = hpg(t.open({ now: clock.now }))
  store.writer.saveThesis(id, null, { text: "Bản 1", conditions: [] })
  clock.advance(1000)
  store.writer.saveThesis(id, 1, { text: "Bản 2", conditions: [] })
  clock.advance(1000)
  store.writer.saveThesis(id, 2, { text: "Bản 3", conditions: [C1] })
  clock.advance(1000)
  expect(store.writer.saveThesis(id, 3, { text: "Bản 4", conditions: [C1, C2] })).toEqual({ id, version: 4 })
  const v3 = store.reader.thesisVersion(id, 3)
  const v4 = store.reader.thesisVersion(id, 4)
  expect(v3).toMatchObject({ text: "Bản 3", conditions: [C1] })
  expect(v3 && "validTo" in v3 && v3.validTo).toBe("2026-11-01T08:00:03.000Z")
  expect(v4).toMatchObject({ validFrom: "2026-11-01T08:00:03.000Z" })
  expect(v4).not.toHaveProperty("validTo")
  expect(caught(() => store.writer.saveThesis(id, 3, { text: "Từ bản cũ", conditions: [] }))).toMatchObject({
    kind: "conflict",
    current: { version: 4, text: "Bản 4" },
  })
})

test("a renamed ticker is a new alias on the same subject, with alias history", () => {
  const clock = testClock()
  const { store, id } = hpg(t.open({ now: clock.now }))
  clock.advance(86_400_000)
  store.writer.addAlias(id, "HPG2")
  expect(store.reader.subjectByAlias("hpg")?.id).toBe(id)
  expect(store.reader.subjectByAlias("HPG2")?.id).toBe(id)
  const subject = store.reader.subject(id)!
  expect(subject.display).toBe("HPG2")
  expect(subject.aliases).toEqual([
    { alias: "HPG", addedAt: "2026-11-01T08:00:00.000Z" },
    { alias: "HPG2", addedAt: "2026-11-02T08:00:00.000Z" },
  ])
  expect(store.reader.subjects()).toHaveLength(2)
  clock.advance(1000)
  store.writer.retireAlias(id, "HPG")
  expect(store.reader.subjectByAlias("HPG")).toBeUndefined()
  expect(store.reader.subject(id)!.aliases[0]).toEqual({
    alias: "HPG",
    addedAt: "2026-11-01T08:00:00.000Z",
    retiredAt: "2026-11-02T08:00:01.000Z",
  })
  // The last alias in use cannot go.
  expect(caught(() => store.writer.retireAlias(id, "HPG2")).kind).toBe("invalid")
})

test("an alias in use by another subject is refused, and free again once that subject retires it", () => {
  const { store, id } = hpg()
  const hsg = store.writer.createSubject({ kind: "ticker", alias: "HSG" }).id
  const error = caught(() => store.writer.addAlias(id, "hsg"))
  expect(error.kind).toBe("alias_taken")
  expect(error.message).toContain(`#${hsg}`)
  expect(caught(() => store.writer.createSubject({ kind: "ticker", alias: "HSG" })).kind).toBe("alias_taken")
  store.writer.addAlias(hsg, "HSG-OLD")
  store.writer.retireAlias(hsg, "HSG")
  expect(() => store.writer.addAlias(id, "HSG")).not.toThrow()
})

test("a deleted thesis keeps its version count: the rewrite is version 4, version 2 reads as deleted", () => {
  const { store, id } = hpg()
  store.writer.saveThesis(id, null, { text: "Bản 1", conditions: [C1] })
  store.writer.saveThesis(id, 1, { text: "Bản 2", conditions: [C1] })
  store.writer.saveThesis(id, 2, { text: "Bản 3", conditions: [C1] })
  store.writer.deleteThesis(id, 3)
  expect(store.reader.subject(id)).toMatchObject({ lastVersion: 3, thesisState: "none" })
  expect(store.reader.subject(id)!.currentVersion).toBeUndefined()
  expect(store.reader.thesis(id)).toBeUndefined()
  expect(store.writer.saveThesis(id, null, { text: "Luận điểm mới", conditions: [] })).toEqual({ id, version: 4 })
  expect(store.reader.thesisVersion(id, 2)).toEqual({ version: 2, deleted: true })
  expect(store.reader.thesisVersion(id, 4)).toMatchObject({ text: "Luận điểm mới" })
  expect(store.reader.subject(id)!.thesisState).toBe("watching")
  expect(JSON.stringify(t.raw().query("SELECT * FROM thesis_versions WHERE version < 4").all())).not.toContain("Bản")
})

test("changing the thesis state needs the current version and makes no new version", () => {
  const clock = testClock()
  const { store, id } = hpg(t.open({ now: clock.now }))
  store.writer.saveThesis(id, null, { text: "Bản 1", conditions: [] })
  clock.advance(5000)
  store.writer.setThesisState(id, 1, "refuted")
  expect(store.reader.subject(id)).toMatchObject({
    thesisState: "refuted",
    thesisStateAt: "2026-11-01T08:00:05.000Z",
    lastVersion: 1,
  })
  expect(caught(() => store.writer.setThesisState(id, 2, "closed")).kind).toBe("conflict")
  // A new version puts it back under watch.
  store.writer.saveThesis(id, 1, { text: "Bản 2", conditions: [] })
  expect(store.reader.subject(id)!.thesisState).toBe("watching")
})

test("setting the state it already has keeps the state date; 'none' is refused at run time", () => {
  const clock = testClock()
  const { store, id } = hpg(t.open({ now: clock.now }))
  store.writer.saveThesis(id, null, { text: "Bản 1", conditions: [] })
  clock.advance(5000)
  store.writer.setThesisState(id, 1, "watching")
  expect(store.reader.subject(id)!.thesisStateAt).toBe("2026-11-01T08:00:00.000Z")
  // @ts-expect-error "none" means no thesis; a live thesis cannot be set to it
  expect(caught(() => store.writer.setThesisState(id, 1, "none")).kind).toBe("invalid")
  expect(store.reader.subject(id)!.thesisState).toBe("watching")
})

test("a damaged condition list reads as a corrupt store, never as no conditions", () => {
  const { store, id } = hpg()
  store.writer.saveThesis(id, null, { text: "Bản 1", conditions: [C1] })
  const raw = t.raw()
  raw.run("UPDATE thesis_versions SET conditions = '{hỏng' WHERE subject_id = ?", [id])
  raw.close(true)
  expect(caught(() => store.reader.thesis(id)).kind).toBe("corrupt")
  const raw2 = t.raw()
  raw2.run("UPDATE thesis_versions SET conditions = '[1, 2]' WHERE subject_id = ?", [id])
  raw2.close(true)
  expect(caught(() => store.reader.thesis(id)).kind).toBe("corrupt")
})

test("over-long or over-many fields are refused, naming the field; the previous version stays", () => {
  const { store, id } = hpg()
  store.writer.saveThesis(id, null, { text: "Bản 1", conditions: [] })
  const nine = Array.from({ length: 9 }, (_, i) => `Điều kiện ${i + 1}`)
  expect(caught(() => store.writer.saveThesis(id, 1, { text: "Bản 2", conditions: nine })).kind).toBe("limit")
  expect(caught(() => store.writer.saveThesis(id, 1, { text: "x".repeat(351), conditions: [] })).kind).toBe("limit")
  const long = caught(() => store.writer.saveThesis(id, 1, { text: "Bản 2", conditions: [C1, "y".repeat(161)] }))
  expect(long.kind).toBe("limit")
  expect(long.message).toContain("2")
  const badDate = caught(() => store.writer.saveThesis(id, 1, { text: "Bản 2", conditions: [], reviewBy: "31/12/2026" }))
  expect(badDate.kind).toBe("invalid")
  expect(store.reader.thesis(id)).toMatchObject({ version: 1, text: "Bản 1" })
  const atLimit = store.writer.saveThesis(id, 1, { text: "x".repeat(350), conditions: Array(8).fill("y".repeat(160)) })
  expect(atLimit.version).toBe(2)
})

test("a ticker's sector must be a sector subject, and unknown subjects are not found", () => {
  const { store, id } = hpg()
  expect(caught(() => store.writer.createSubject({ kind: "ticker", alias: "NKG", sectorId: id })).kind).toBe("invalid")
  const noSector = caught(() => store.writer.createSubject({ kind: "ticker", alias: "NKG", sectorId: 99 }))
  expect(noSector.kind).toBe("not_found")
  expect(caught(() => store.writer.saveThesis(99, null, { text: "?", conditions: [] })).kind).toBe("not_found")
  expect(caught(() => store.writer.createSubject({ kind: "ticker", alias: "  " })).kind).toBe("invalid")
})

test("subject ids only go up", () => {
  const { store } = hpg()
  expect(store.writer.createSubject({ kind: "market", alias: "VNINDEX", uppercaseOnly: true }).id).toBe(3)
  expect(store.reader.subject(3)).toMatchObject({ kind: "market", uppercaseOnly: true, display: "VNINDEX" })
})

test("an error never echoes text that has not been checked: retiring a key-shaped alias", () => {
  const { store, id } = hpg()
  const fakeKey = ["sk", "ant", "api03", "x".repeat(30)].join("-")
  const error = caught(() => store.writer.retireAlias(id, fakeKey))
  expect(error.kind).toBe("not_found")
  expect(error.message).not.toContain(fakeKey)
  expect(error.message).not.toContain("xxxx")
})

test("changed() stays quiet after a write that changed no row", () => {
  const { store, id } = hpg()
  store.writer.saveThesis(id, null, { text: "Bản 1", conditions: [] })
  expect(store.changed()).toBe(true)
  store.writer.setThesisState(id, 1, "watching")
  expect(store.changed()).toBe(false)
  store.writer.setThesisState(id, 1, "refuted")
  expect(store.changed()).toBe(true)
})
