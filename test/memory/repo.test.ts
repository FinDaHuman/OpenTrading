import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Clock } from "../../src/core/memory/deps"
import { LATEST_MEMORY_SCHEMA, MigrationBusyError, migrateMemory } from "../../src/core/memory/migrate"
import { MemoryRepo, rowToItem, StorageError } from "../../src/core/memory/repo"
import type { MemoryItemV0 } from "../../src/core/memory/schema"

const clock: Clock = { now: () => new Date("2026-09-30T01:00:00.000Z") }
const NOW = "2026-09-30T01:00:00.000Z"

const item = (id: string, body: string): MemoryItemV0 => ({
  schemaVersion: 1,
  id,
  kind: "profile",
  scope: "global",
  body,
  status: "active",
  visibility: "model",
  createdBy: "user",
  origin: "remember_command",
  createdAt: NOW,
  updatedAt: NOW,
})

function memoryDb() {
  const db = new Database(":memory:")
  migrateMemory(db, clock)
  return db
}

// File databases: every open connection is closed before the directory is removed, or Windows reports EBUSY.
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})
async function tempFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentrading-memory-"))
  const opened: Database[] = []
  cleanups.push(async () => {
    for (const db of opened) db.close()
    await rm(dir, { recursive: true, force: true })
  })
  const open = () => {
    const db = new Database(path.join(dir, "memory.db"))
    opened.push(db)
    return db
  }
  return { open }
}

describe("migrateMemory", () => {
  test("creates the schema once; a second run applies nothing", () => {
    const db = new Database(":memory:")
    expect(migrateMemory(db, clock)).toEqual([1])
    expect(migrateMemory(db, clock)).toEqual([])
    const rows = db.query("SELECT version, applied_at FROM memory_schema_migrations").all()
    expect(rows).toEqual([{ version: 1, applied_at: NOW }])
    expect(LATEST_MEMORY_SCHEMA).toBe(1)
    db.close()
  })

  test("never touches PRAGMA user_version", () => {
    const db = new Database(":memory:")
    db.run("PRAGMA user_version = 42")
    migrateMemory(db, clock)
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 42 })
    db.close()
  })

  test("creates the selection index", () => {
    const db = memoryDb()
    const idx = db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'memory_select'").get()
    expect(idx).toEqual({ name: "memory_select" })
    db.close()
  })

  test("restores the connection's busy_timeout, whether it was unset or set by the core", () => {
    const unset = new Database(":memory:")
    migrateMemory(unset, clock)
    expect(unset.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 0 })
    unset.close()

    const preset = new Database(":memory:")
    preset.run("PRAGMA busy_timeout = 1234")
    migrateMemory(preset, clock)
    expect(preset.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 1234 })
    preset.close()
  })

  test("lock contention: times out with migration_busy, then succeeds once released, with no duplicate row", async () => {
    const { open } = await tempFile()
    const holder = open()
    const other = open()
    holder.exec("PRAGMA journal_mode = WAL")
    holder.run("BEGIN IMMEDIATE")

    const started = Date.now()
    let error: unknown
    try {
      migrateMemory(other, clock, { busyTimeoutMs: 50 })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(MigrationBusyError)
    expect((error as MigrationBusyError).code).toBe("migration_busy")
    expect(Date.now() - started).toBeLessThan(3000) // bounded wait, not the 5 s default and never forever
    expect(other.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 0 })

    holder.run("COMMIT")
    expect(migrateMemory(other, clock)).toEqual([1])
    expect(migrateMemory(holder, clock)).toEqual([]) // the other process already applied it
    expect(holder.query("SELECT count(*) AS n FROM memory_schema_migrations").get()).toEqual({ n: 1 })
  })
})

describe("table CHECKs", () => {
  const insert = (db: Database, status: string, body: string | null, kind = "profile") =>
    db.run(
      `INSERT INTO memory VALUES ('x', 1, ?, 'global', ?, ?, 'model', 'user', 'remember_command', ?, ?)`,
      [kind, body, status, NOW, NOW],
    )

  test("purged rows must have no body and active rows must have one", () => {
    const db = memoryDb()
    expect(() => insert(db, "purged", "còn nội dung")).toThrow()
    expect(() => insert(db, "active", null)).toThrow()
    expect(() => insert(db, "unknown", "x")).toThrow()
    expect(() => insert(db, "active", "x", "belief")).toThrow()
    insert(db, "purged", null)
    db.close()
  })

  test("the table accepts final PA3 enums that the V0 repository still refuses", () => {
    const db = memoryDb()
    insert(db, "active", "bài học", "lesson")
    const repo = new MemoryRepo(db)
    expect(() => repo.insert({ ...item("y", "b"), kind: "lesson" } as never)).toThrow()
    expect(rowToItem(repo.get("x")!)).toEqual({ ok: false, id: "x" })
    expect(repo.listActiveProfiles()).toEqual([])
    db.close()
  })
})

describe("MemoryRepo", () => {
  test("insert, read back and list active profiles ordered by id", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    repo.insert(item("b", "Báo cáo cần có kịch bản rủi ro"))
    repo.insert(item("a", "Tôi không sử dụng margin"))
    expect(repo.listActiveProfiles().map((r) => r.id)).toEqual(["a", "b"])
    expect(rowToItem(repo.get("a")!)).toEqual({ ok: true, item: item("a", "Tôi không sử dụng margin") })
    expect(repo.get("missing")).toBeNull()
    expect(repo.count()).toBe(2)
    db.close()
  })

  test("rejects items outside the V0 subset before touching the database", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    for (const bad of [
      { ...item("1", "x"), scope: "ticker:HPG" },
      { ...item("2", "x"), visibility: "restricted" },
      { ...item("3", "x"), createdBy: "system" },
      { ...item("4", "x"), origin: "feedback" },
    ])
      expect(() => repo.insert(bad as never)).toThrow()
    expect(repo.count()).toBe(0)
    db.close()
  })

  test("duplicate id surfaces as storage_failed, not as success", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    const secretish = "NỘI-DUNG-RIÊNG-TƯ-KHÔNG-ĐƯỢC-LỘ"
    repo.insert(item("a", "x"))
    expect(() => repo.insert(item("a", secretish))).toThrow(StorageError)
    try {
      repo.insert(item("a", secretish))
    } catch (e) {
      expect((e as StorageError).code).toBe("storage_failed")
      expect((e as Error).message).not.toContain(secretish)
    }
    db.close()
  })

  test("purge nulls the body, drops the row from selection, and reports not_found on repeat", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    repo.insert(item("a", "Tôi không sử dụng margin"))
    repo.insert(item("b", "Báo cáo cần có kịch bản rủi ro"))
    expect(repo.purge("a", "2026-09-30T02:00:00.000Z")).toBe("purged")
    const row = repo.get("a")!
    expect(row.body).toBeNull()
    expect(row.status).toBe("purged")
    expect(row.updated_at).toBe("2026-09-30T02:00:00.000Z")
    expect(repo.listActiveProfiles().map((r) => r.id)).toEqual(["b"])
    expect(repo.purge("a", NOW)).toBe("not_found")
    expect(repo.purge("missing", NOW)).toBe("not_found")
    db.close()
  })

  test("persistence: a file database closed and reopened keeps memory and purge state", async () => {
    const { open } = await tempFile()
    const first = open()
    migrateMemory(first, clock)
    const repo = new MemoryRepo(first)
    repo.insert(item("a", "Tôi không sử dụng margin"))
    repo.insert(item("b", "Báo cáo cần có kịch bản rủi ro"))
    repo.purge("a", NOW)
    first.close()

    const again = open()
    expect(migrateMemory(again, clock)).toEqual([])
    const reopened = new MemoryRepo(again)
    expect(reopened.listActiveProfiles().map((r) => r.body)).toEqual(["Báo cáo cần có kịch bản rủi ro"])
    expect(reopened.get("a")!.body).toBeNull()
  })

  test("a write blocked by another writer reports storage_busy", async () => {
    const { open } = await tempFile()
    const holder = open()
    migrateMemory(holder, clock)
    const other = open()
    other.run("PRAGMA busy_timeout = 20")
    holder.run("BEGIN IMMEDIATE")
    try {
      new MemoryRepo(other).insert(item("a", "x"))
      throw new Error("expected storage_busy")
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError)
      expect((e as StorageError).code).toBe("storage_busy")
    } finally {
      holder.run("ROLLBACK")
    }
  })
})
