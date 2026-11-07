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

test("a new constraint gets id 1, version 1, the default scope, a manual source and the save time", () => {
  const { reader, writer } = t.open()
  expect(writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })).toEqual({ id: 1, version: 1 })
  expect(reader.constraints("constraint")).toEqual([
    {
      id: 1,
      kind: "constraint",
      version: 1,
      text: "Không dùng margin",
      scope: "all_accounts",
      source: "manual",
      createdAt: FIXED_TIME.toISOString(),
    },
  ])
})

test("revising from the current version adds version 2; version 1 still reads as written", () => {
  const { reader, writer } = t.open()
  writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  expect(writer.reviseConstraint(1, 1, { text: "Không dùng margin, kể cả T+0" })).toEqual({ id: 1, version: 2 })
  expect(reader.constraintVersion(1, 1)).toMatchObject({ version: 1, text: "Không dùng margin" })
  expect(reader.constraint(1)).toMatchObject({ version: 2, text: "Không dùng margin, kể cả T+0" })
})

test("a second window saving from a stale version gets a conflict carrying the current version", () => {
  const { reader, writer } = t.open()
  writer.addConstraint({ kind: "constraint", text: "Bản 1" })
  writer.reviseConstraint(1, 1, { text: "Bản 2" })
  writer.reviseConstraint(1, 2, { text: "Bản 3 của cửa sổ A" })
  const error = caught(() => writer.reviseConstraint(1, 2, { text: "Bản của cửa sổ B" }))
  expect(error.kind).toBe("conflict")
  expect(error.current).toMatchObject({ version: 3, text: "Bản 3 của cửa sổ A" })
  expect(reader.constraint(1)).toMatchObject({ version: 3, text: "Bản 3 của cửa sổ A" })
  expect(reader.constraintVersion(1, 4)).toBeUndefined()
})

test("going over the 1,500-character total is refused and nothing is saved or cut", () => {
  const { reader, writer } = t.open()
  for (let i = 0; i < 7; i++) writer.addConstraint({ kind: "constraint", text: "x".repeat(200) })
  writer.addConstraint({ kind: "constraint", text: "y".repeat(50) })
  // 1,450 now; 80 more would be 1,530.
  const error = caught(() => writer.addConstraint({ kind: "constraint", text: "z".repeat(80) }))
  expect(error.kind).toBe("limit")
  expect(error.message).toContain("1450")
  expect(error.message).toContain("1500")
  expect(reader.constraints("constraint")).toHaveLength(8)
  // Exactly up to the total is fine.
  expect(() => writer.addConstraint({ kind: "constraint", text: "z".repeat(50) })).not.toThrow()
  // Revising counts the new text instead of the old one.
  expect(caught(() => writer.reviseConstraint(8, 1, { text: "y".repeat(51) })).kind).toBe("limit")
})

test("one constraint over 200 characters is refused", () => {
  const { writer } = t.open()
  expect(caught(() => writer.addConstraint({ kind: "constraint", text: "x".repeat(201) })).kind).toBe("limit")
  expect(writer.addConstraint({ kind: "constraint", text: "x".repeat(200) })).toEqual({ id: 1, version: 1 })
})

test("the constraint-set version moves on every constraint change and never on style changes", () => {
  const { reader, writer } = t.open()
  expect(reader.constraintSet()).toBe(0)
  writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  writer.reviseConstraint(1, 1, { text: "Không dùng margin, kể cả T+0" })
  writer.addConstraint({ kind: "constraint", text: "Tối đa 20% danh mục cho một mã" })
  writer.deleteConstraint(2, 1)
  expect(reader.constraintSet()).toBe(4)
  writer.addConstraint({ kind: "style", text: "Trả lời ngắn, có bảng" })
  writer.reviseConstraint(3, 1, { text: "Trả lời ngắn" })
  writer.deleteConstraint(3, 2)
  expect(reader.constraintSet()).toBe(4)
})

test("presentation style has its own 1,000-character total and its own list", () => {
  const { reader, writer } = t.open()
  writer.addConstraint({ kind: "style", text: "a".repeat(600) })
  expect(caught(() => writer.addConstraint({ kind: "style", text: "b".repeat(401) })).kind).toBe("limit")
  writer.addConstraint({ kind: "style", text: "b".repeat(400) })
  writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  expect(reader.constraints("style").map((c) => c.id)).toEqual([1, 2])
  expect(reader.constraints("constraint").map((c) => c.id)).toEqual([3])
})

test("ids are never reused: delete #3, the next one is #4", () => {
  const { writer } = t.open()
  for (const text of ["A", "B", "C"]) writer.addConstraint({ kind: "constraint", text })
  writer.deleteConstraint(3, 1)
  expect(writer.addConstraint({ kind: "constraint", text: "D" }).id).toBe(4)
})

test("a deleted constraint keeps its id and versions but no content anywhere", () => {
  const clock = testClock()
  const { reader, writer } = t.open({ now: clock.now })
  writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  writer.reviseConstraint(1, 1, { text: "Không dùng margin, kể cả T+0" })
  clock.advance(60_000)
  writer.deleteConstraint(1, 2)
  expect(reader.constraint(1)).toEqual({ id: 1, deleted: true, deletedAt: "2026-11-01T08:01:00.000Z" })
  expect(reader.constraintVersion(1, 1)).toEqual({ version: 1, deleted: true })
  expect(reader.constraintVersion(1, 2)).toEqual({ version: 2, deleted: true })
  expect(reader.constraints("constraint")).toEqual([])
  expect(JSON.stringify(t.raw().query("SELECT * FROM constraint_versions").all())).not.toContain("margin")
  expect(caught(() => writer.reviseConstraint(1, 2, { text: "Hồi sinh" })).kind).toBe("deleted")
  expect(caught(() => writer.deleteConstraint(1, 2)).kind).toBe("deleted")
})

test("deleting from a stale version is a conflict, and an unknown id is not found", () => {
  const { writer } = t.open()
  writer.addConstraint({ kind: "constraint", text: "Bản 1" })
  writer.reviseConstraint(1, 1, { text: "Bản 2" })
  expect(caught(() => writer.deleteConstraint(1, 1)).kind).toBe("conflict")
  expect(caught(() => writer.reviseConstraint(9, 1, { text: "?" })).kind).toBe("not_found")
})

test("revising keeps the value of a column a later build added to the row", () => {
  t.open().close()
  const raw = t.raw()
  raw.run("ALTER TABLE constraints ADD COLUMN note_from_future TEXT")
  raw.close(true)
  const { writer } = t.open()
  writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  const set = t.raw()
  set.run("UPDATE constraints SET note_from_future = 'giữ tôi' WHERE id = 1")
  set.close(true)
  writer.reviseConstraint(1, 1, { text: "Không dùng margin, kể cả T+0" })
  const check = t.raw()
  expect(check.query("SELECT note_from_future AS v FROM constraints WHERE id = 1").get()).toEqual({ v: "giữ tôi" })
})
