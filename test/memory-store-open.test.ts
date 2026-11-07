import { Database } from "bun:sqlite"
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { MemoryStoreError, openError, storeError } from "../src/core/memory/store/errors"
import { createStoreContext } from "../src/core/memory/store/open"
import { APPLICATION_ID, MIGRATIONS, SCHEMA_VERSION, type Migration } from "../src/core/memory/store/schema"
import { useTempStores } from "./helpers/memory-store"

const t = useTempStores()

const pragma = (db: Database, name: string) => (db.query(`PRAGMA ${name}`).get() as Record<string, number>)[name]

function caught(fn: () => unknown): MemoryStoreError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(MemoryStoreError)
    return error as MemoryStoreError
  }
  throw new Error("expected a MemoryStoreError")
}

/** The real migrations, counting how many steps ran. */
function counted() {
  const runs = { n: 0 }
  const migrations: Migration[] = MIGRATIONS.map((step) => (db) => {
    runs.n++
    step(db)
  })
  return { runs, migrations }
}

test("an empty folder gets a version-1 store; opening it again runs no migration", () => {
  expect(SCHEMA_VERSION).toBe(1)
  const first = counted()
  t.open({ migrations: first.migrations }).close()
  expect(first.runs.n).toBe(1)
  const raw = t.raw()
  expect(pragma(raw, "user_version")).toBe(1)
  expect(pragma(raw, "application_id")).toBe(APPLICATION_ID)
  raw.close(true)
  const again = counted()
  t.open({ migrations: again.migrations })
  expect(again.runs.n).toBe(0)
})

test("a store from a newer app is refused, left byte for byte, and the connection is closed", () => {
  const raw = new Database(t.file(), { strict: true })
  raw.run("CREATE TABLE future (x)")
  raw.run(`PRAGMA application_id = ${APPLICATION_ID}`)
  raw.run("PRAGMA user_version = 2")
  raw.close(true)
  const before = readFileSync(t.file())
  const error = caught(() => t.open())
  expect(error.kind).toBe("newer_schema")
  expect(error.message).toContain("lược đồ bản 2")
  expect(error.message).toContain("hiểu tới bản 1")
  expect(error.message).toContain("giữ nguyên")
  expect(Buffer.compare(before, readFileSync(t.file()))).toBe(0)
  // Nothing holds the file: Windows would refuse this while a connection is open.
  rmSync(t.file())
  expect(existsSync(t.file())).toBe(false)
})

test("a text file is refused as not a store, kept, and released", () => {
  writeFileSync(t.file(), "không phải SQLite", "utf8")
  const before = readFileSync(t.file())
  const error = caught(() => t.open())
  expect(error.kind).toBe("not_a_store")
  expect(error.message).toContain(t.file())
  expect(Buffer.compare(before, readFileSync(t.file()))).toBe(0)
  rmSync(t.file())
})

test("another program's SQLite file is refused, not migrated", () => {
  const raw = new Database(t.file(), { strict: true })
  raw.run("CREATE TABLE notes (body TEXT)")
  raw.close(true)
  const before = readFileSync(t.file())
  expect(caught(() => t.open()).kind).toBe("not_a_store")
  expect(Buffer.compare(before, readFileSync(t.file()))).toBe(0)
})

test("a failing migration step rolls back: the version stays, and its tables are gone", () => {
  t.open().close()
  const failing: Migration = (db) => {
    db.run("CREATE TABLE half_done (x)")
    throw new Error("boom")
  }
  const error = caught(() => t.open({ migrations: [...MIGRATIONS, failing] }))
  expect(error.kind).toBe("open_failed")
  expect(error.message).toContain("boom")
  const raw = t.raw()
  expect(pragma(raw, "user_version")).toBe(1)
  expect(raw.query("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeNull()
  expect(existsSync(t.file())).toBe(true)
})

test("a failed open never deletes the store file, even one it created; the next open builds the schema", () => {
  // Two windows starting at once: this one may have created the file, and the other may already be
  // using it. Deleting on failure would delete the other window's store (R61).
  const failing: Migration = () => {
    throw new Error("boom")
  }
  expect(caught(() => t.open({ migrations: [failing] })).kind).toBe("open_failed")
  expect(existsSync(t.file())).toBe(true)
  const store = t.open()
  store.writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  expect(store.reader.constraints("constraint")).toHaveLength(1)
})

test("the store another window has open survives this window's failed open", () => {
  const other = t.open()
  other.writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  const failing: Migration = () => {
    throw new Error("boom")
  }
  expect(caught(() => t.open({ migrations: [...MIGRATIONS, failing] })).kind).toBe("open_failed")
  expect(existsSync(t.file())).toBe(true)
  expect(other.reader.constraints("constraint")).toHaveLength(1)
  other.writer.addConstraint({ kind: "constraint", text: "Tối đa 20% một mã" })
  expect(other.reader.constraints("constraint")).toHaveLength(2)
})

test("every read runs inside one read transaction, so it sees a single snapshot", () => {
  const raw = t.raw()
  const { ctx } = createStoreContext(raw, () => new Date())
  expect(ctx.read(() => raw.inTransaction)).toBe(true)
  expect(raw.inTransaction).toBe(false)
})

test("SQLite corruption and busy errors keep their meaning", () => {
  expect(storeError(Object.assign(new Error("disk image is malformed"), { code: "SQLITE_CORRUPT" })).kind).toBe("corrupt")
  expect(storeError(new SyntaxError("Unexpected token")).kind).toBe("corrupt")
  expect(openError(Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }), t.file()).kind).toBe("busy")
})

test("deleted text is overwritten in the file, not left in free space", () => {
  // Long enough to sit on overflow pages: deleting frees those pages, and only secure_delete zeroes them.
  const marker = "Chi tiết riêng tư không được sót lại trong file kho. "
  const detail = marker.repeat(70).trim()
  const store = t.open()
  const id = store.writer.createSubject({ kind: "ticker", alias: "HPG" }).id
  store.writer.saveThesis(id, null, { text: "Bản 1", detail, conditions: [] })
  store.close()
  const again = t.open()
  again.writer.deleteThesis(id, 1)
  again.close()
  const bytes = readFileSync(t.file())
  expect(bytes.includes(Buffer.from(marker, "utf8"))).toBe(false)
})

test("data written by an earlier run is there after reopening", () => {
  t.open().close()
  const raw = new Database(t.file(), { strict: true })
  raw.run("INSERT INTO constraints (kind, scope, current_version) VALUES ('constraint', 'all_accounts', 1)")
  raw.run(
    `INSERT INTO constraint_versions (constraint_id, version, text, source, created_at)
     VALUES (1, 1, 'Không dùng margin', 'manual', '2026-11-01T08:00:00.000Z')`,
  )
  raw.close(true)
  const again = counted()
  t.open({ migrations: again.migrations })
  expect(again.runs.n).toBe(0)
  const check = t.raw()
  expect(check.query("SELECT text FROM constraint_versions").get()).toEqual({ text: "Không dùng margin" })
})

test("a column a later build added does not stop this build from opening the store", () => {
  t.open().close()
  const raw = new Database(t.file(), { strict: true })
  raw.run("ALTER TABLE constraints ADD COLUMN note_from_future TEXT")
  raw.close(true)
  expect(() => t.open()).not.toThrow()
})

test("close() can be called twice", () => {
  const store = t.open()
  store.close()
  expect(() => store.close()).not.toThrow()
})

test.skipIf(process.platform === "win32")("a new store file is private to its owner", () => {
  t.open()
  expect(statSync(t.file()).mode & 0o777).toBe(0o600)
})

test("a delete leaves the old text neither in the store file nor in its WAL, while the store stays open", () => {
  const marker = "Chuoi-rieng-tu-trong-WAL"
  const store = t.open()
  store.writer.addConstraint({ kind: "constraint", text: marker })
  store.writer.deleteConstraint(1, 1)
  const inFile = (f: string) => existsSync(f) && readFileSync(f).includes(Buffer.from(marker, "utf8"))
  expect(inFile(t.file())).toBe(false)
  expect(inFile(`${t.file()}-wal`)).toBe(false)
  // The store keeps working after the checkpoint.
  store.writer.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  expect(store.reader.constraints("constraint")).toHaveLength(1)
})
