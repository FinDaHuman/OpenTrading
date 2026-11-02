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

const BANK = {
  title: "Định giá ngân hàng",
  summary: "Dùng P/B và ROE, không dùng P/E",
  exceptions: "Ngân hàng đang tái cơ cấu",
  tags: ["định giá"],
}

function withBanks() {
  const store = t.open()
  const banks = store.writer.createSubject({ kind: "sector", alias: "Ngân hàng" }).id
  return { store, banks }
}

test("a lesson for the banking sector gets #1 version 1 with its exceptions and tags", () => {
  const { store, banks } = withBanks()
  expect(store.writer.addLesson({ ...BANK, appliesTo: [banks] })).toEqual({ id: 1, version: 1 })
  expect(store.reader.lesson(1)).toEqual({
    id: 1,
    version: 1,
    ...BANK,
    appliesTo: [banks],
    source: "manual",
    createdAt: FIXED_TIME.toISOString(),
  })
  expect(store.reader.lessons().map((l) => l.title)).toEqual(["Định giá ngân hàng"])
})

test("revising adds version 2 and version 1 still reads as written", () => {
  const { store, banks } = withBanks()
  store.writer.addLesson({ ...BANK, appliesTo: [banks] })
  const saved = store.writer.reviseLesson(1, 1, { ...BANK, summary: "Dùng P/B, ROE và tỷ lệ nợ xấu" })
  expect(saved).toEqual({ id: 1, version: 2 })
  expect(store.reader.lessonVersion(1, 1)).toMatchObject({
    summary: "Dùng P/B và ROE, không dùng P/E",
    appliesTo: [banks],
  })
  expect(store.reader.lesson(1)).toMatchObject({ version: 2, summary: "Dùng P/B, ROE và tỷ lệ nợ xấu", appliesTo: [] })
  expect(caught(() => store.writer.reviseLesson(1, 1, BANK)).kind).toBe("conflict")
})

test("limits: a 121-character title, 11 tags, an unknown subject are refused", () => {
  const { store } = withBanks()
  expect(caught(() => store.writer.addLesson({ ...BANK, title: "x".repeat(121) })).message).toContain("120")
  const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`)
  expect(caught(() => store.writer.addLesson({ ...BANK, tags })).kind).toBe("limit")
  expect(caught(() => store.writer.addLesson({ ...BANK, appliesTo: [99] })).kind).toBe("not_found")
  expect(store.writer.addLesson({ ...BANK, title: "x".repeat(120) }).id).toBe(1)
})

test("a lesson cannot apply to a market subject", () => {
  const { store } = withBanks()
  const index = store.writer.createSubject({ kind: "market", alias: "VNINDEX" }).id
  expect(caught(() => store.writer.addLesson({ ...BANK, appliesTo: [index] })).kind).toBe("invalid")
})

test("ids are never reused, and a deleted lesson has no content left", () => {
  const { store, banks } = withBanks()
  for (const title of ["A", "B", "C"]) store.writer.addLesson({ ...BANK, title, appliesTo: [banks] })
  store.writer.reviseLesson(3, 1, { ...BANK, title: "C2" })
  store.writer.deleteLesson(3, 2)
  expect(store.writer.addLesson({ ...BANK, title: "D" }).id).toBe(4)
  expect(store.reader.lesson(3)).toMatchObject({ id: 3, deleted: true })
  expect(store.reader.lessonVersion(3, 1)).toEqual({ version: 1, deleted: true })
  expect(store.reader.lessons().map((l) => l.id)).toEqual([1, 2, 4])
  const left = t.raw().query("SELECT * FROM lesson_versions WHERE lesson_id = 3").all()
  expect(JSON.stringify(left)).not.toContain("P/B")
  expect(t.raw().query("SELECT count(*) AS n FROM lesson_applies WHERE lesson_id = 3").get()).toEqual({ n: 0 })
  expect(caught(() => store.writer.deleteLesson(3, 2)).kind).toBe("deleted")
})

test("'applies to' drops repeats in order and holds at most 20 subjects", () => {
  const store = t.open()
  const ids = Array.from({ length: 21 }, (_, i) => store.writer.createSubject({ kind: "ticker", alias: `M${i}` }).id)
  store.writer.addLesson({ ...BANK, appliesTo: [ids[2]!, ids[0]!, ids[2]!, ids[1]!, ids[0]!] })
  expect(store.reader.lesson(1)).toMatchObject({ appliesTo: [ids[2], ids[0], ids[1]] })
  expect(store.writer.addLesson({ ...BANK, appliesTo: ids.slice(0, 20) }).id).toBe(2)
  const error = caught(() => store.writer.addLesson({ ...BANK, appliesTo: ids }))
  expect(error.kind).toBe("limit")
  expect(error.message).toContain("20")
  // Repeats are dropped before counting.
  expect(store.writer.addLesson({ ...BANK, appliesTo: [...ids.slice(0, 20), ids[0]!] }).id).toBe(3)
})
