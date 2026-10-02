import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Clock } from "../../src/core/memory/deps"
import { LATEST_MEMORY_SCHEMA, MigrationBusyError, migrateMemory } from "../../src/core/memory/migrate"
import { MemoryRepo, rowToItem, StorageError } from "../../src/core/memory/repo"
import type { MemoryItem } from "../../src/core/memory/schema"

const clock: Clock = { now: () => new Date("2026-09-30T01:00:00.000Z") }
const NOW = "2026-09-30T01:00:00.000Z"

const item = (id: string, body: string, patch: Partial<MemoryItem> = {}): MemoryItem => ({
  schemaVersion: 1,
  id,
  version: 1,
  kind: "profile",
  scope: "global",
  title: null,
  body,
  status: "active",
  visibility: "model",
  createdBy: "user",
  origin: "remember_command",
  asOf: "2026-09-30",
  expiresAt: null,
  sourceEvents: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
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
  return {
    open: () => {
      const db = new Database(path.join(dir, "memory.db"))
      opened.push(db)
      return db
    },
  }
}

const v0Insert = (db: Database, id: string, status: string, body: string | null) =>
  db.run(`INSERT INTO memory VALUES (?, 1, 'profile', 'global', ?, ?, 'model', 'user', 'remember_command', ?, ?)`, [
    id,
    body,
    status,
    NOW,
    NOW,
  ])

describe("migrateMemory", () => {
  test("applies every migration once; a second run applies nothing", () => {
    const db = new Database(":memory:")
    expect(migrateMemory(db, clock)).toEqual([1, 2])
    expect(migrateMemory(db, clock)).toEqual([])
    expect(db.query("SELECT version, applied_at FROM memory_schema_migrations ORDER BY version").all()).toEqual([
      { version: 1, applied_at: NOW },
      { version: 2, applied_at: NOW },
    ])
    expect(LATEST_MEMORY_SCHEMA).toBe(2)
    db.close()
  })

  test("never touches PRAGMA user_version and restores busy_timeout", () => {
    const db = new Database(":memory:")
    db.run("PRAGMA user_version = 42")
    db.run("PRAGMA busy_timeout = 1234")
    migrateMemory(db, clock)
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 42 })
    expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 1234 })
    db.close()
    const unset = new Database(":memory:")
    migrateMemory(unset, clock)
    expect(unset.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 0 })
    unset.close()
  })

  test("V0 → V3 rebuild keeps every body byte for byte in version 1 and keeps purge state", () => {
    const db = new Database(":memory:")
    migrateMemory(db, clock, { upTo: 1 })
    v0Insert(db, "a", "active", "Tôi không sử dụng margin")
    v0Insert(db, "b", "purged", null)
    expect(migrateMemory(db, clock)).toEqual([2])
    const repo = new MemoryRepo(db)
    expect(repo.versions("a")).toEqual([{ version: 1, title: null, body: "Tôi không sử dụng margin" }])
    expect(repo.versions("b")).toEqual([{ version: 1, title: null, body: null }])
    expect(rowToItem(repo.get("a")!)).toMatchObject({ ok: true, item: { version: 1, asOf: "2026-09-30" } })
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'memory_select'").get()).toEqual({
      name: "memory_select",
    })
    expect(repo.search('"margin"', 5).map((h) => h.memory_id)).toEqual(["a"])
    db.close()
  })

  test.each(["tables", "copied", "renamed", "indexed"])("a failure at step %s rolls the whole rebuild back", (step) => {
    const db = new Database(":memory:")
    migrateMemory(db, clock, { upTo: 1 })
    v0Insert(db, "a", "active", "Tôi không sử dụng margin")
    expect(() =>
      migrateMemory(db, clock, {
        fault: (at) => {
          if (at === step) throw new Error("fault")
        },
      }),
    ).toThrow("fault")
    expect(db.query("SELECT max(version) AS v FROM memory_schema_migrations").get()).toEqual({ v: 1 })
    expect(db.query("SELECT body FROM memory WHERE id = 'a'").get()).toEqual({ body: "Tôi không sử dụng margin" })
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name IN ('memory_version', 'memory_new', 'memory_fts')").all(),
    ).toEqual([])
    expect(migrateMemory(db, clock)).toEqual([2]) // and the next start completes it
    db.close()
  })

  test("lock contention: migration_busy on timeout, success once released, no duplicate rows", async () => {
    const { open } = await tempFile()
    const holder = open()
    const other = open()
    holder.exec("PRAGMA journal_mode = WAL")
    holder.run("BEGIN IMMEDIATE")
    const started = Date.now()
    expect(() => migrateMemory(other, clock, { busyTimeoutMs: 50 })).toThrow(MigrationBusyError)
    expect(Date.now() - started).toBeLessThan(3000)
    expect(other.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 0 })
    holder.run("COMMIT")
    expect(migrateMemory(other, clock)).toEqual([1, 2])
    expect(migrateMemory(holder, clock)).toEqual([])
    expect(holder.query("SELECT count(*) AS n FROM memory_schema_migrations").get()).toEqual({ n: 2 })
  })
})

describe("MemoryRepo", () => {
  test("insert writes the row, version 1 and the folded search index together", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    repo.insert(item("a", "Báo cáo ngân hàng cần tỷ lệ bao phủ nợ xấu"), "fp-a")
    expect(rowToItem(repo.get("a")!)).toEqual({
      ok: true,
      item: item("a", "Báo cáo ngân hàng cần tỷ lệ bao phủ nợ xấu"),
    })
    expect(repo.search('"bao" "phu" "no" "xau"', 5).map((h) => h.memory_id)).toEqual(["a"])
    expect(repo.findByFingerprint("fp-a")).toEqual([{ id: "a", status: "active" }])
    db.close()
  })

  test("query filters by status, kind, scope, visibility and validity date (inclusive)", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    repo.insert(item("p", "hồ sơ"), null)
    const note = { kind: "note", scope: "ticker:VCB", origin: "note_command", expiresAt: "2026-09-30" } as const
    repo.insert(item("n", "ghi chú", note), null)
    expect(repo.query({ validOn: "2026-09-30" }).map((r) => r.id)).toEqual(["n", "p"])
    expect(repo.query({ validOn: "2026-10-01" }).map((r) => r.id)).toEqual(["p"])
    expect(repo.query({ kinds: ["note"] }).map((r) => r.id)).toEqual(["n"])
    expect(repo.query({ scopes: ["ticker:VCB"] }).map((r) => r.id)).toEqual(["n"])
    expect(repo.query({ statuses: [] })).toEqual([])
    db.close()
  })

  test("edits add versions; search follows the current version", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    repo.insert(item("a", "thích ngân hàng"), null)
    const v = repo.addVersion(
      "a",
      { title: null, body: "thích thép", asOf: "2026-10-01", expiresAt: null, sourceEvents: [] },
      NOW,
      "fp2",
    )
    expect(v).toBe(2)
    expect(repo.versions("a").map((x) => x.body)).toEqual(["thích ngân hàng", "thích thép"])
    expect(repo.get("a")!.body).toBe("thích thép")
    expect(repo.search('"ngan" "hang"', 5)).toEqual([])
    expect(repo.search('"thep"', 5).map((h) => h.memory_id)).toEqual(["a"])
    db.close()
  })

  test("eraseContent nulls every version and removes the item from search; repeating is refused", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    repo.insert(item("a", "bí mật riêng tư"), "fp")
    repo.addVersion(
      "a",
      { title: "t", body: "bí mật bản hai", asOf: "2026-09-30", expiresAt: null, sourceEvents: [] },
      NOW,
      "fp",
    )
    expect(repo.eraseContent("a", ["active"], "purged", NOW)).toBe(true)
    expect(repo.versions("a")).toEqual([
      { version: 1, title: null, body: null },
      { version: 2, title: null, body: null },
    ])
    expect(repo.search('"bi" "mat"', 5)).toEqual([])
    expect(repo.findByFingerprint("fp")).toEqual([{ id: "a", status: "purged" }])
    expect(repo.eraseContent("a", ["active"], "purged", NOW)).toBe(false)
    db.close()
  })

  test("usage: applications with their ratings, newest first", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    repo.insert(item("l", "bài học", { kind: "lesson", createdBy: "system", origin: "feedback" }), null)
    for (let t = 1; t <= 3; t++)
      repo.recordUsage([{ memoryId: "l", sessionId: "s", turn: t, verdict: "applied" }], `2026-09-30T0${t}:00:00.000Z`)
    repo.recordUsage([{ memoryId: "l", sessionId: "s", turn: 3, verdict: "harmful" }], NOW)
    repo.recordUsage([{ memoryId: "l", sessionId: "s", turn: 1, verdict: "helpful" }], NOW)
    expect(repo.recentApplications("l", 5)).toEqual([
      { harmful: true, helpful: false },
      { harmful: false, helpful: false },
      { harmful: false, helpful: true },
    ])
    expect(repo.usageCounts("l")).toEqual({ applied: 3, helpful: 1, harmful: 1 })
    db.close()
  })

  test("rejects invalid items before touching the database; storage errors never echo the body", () => {
    const db = memoryDb()
    const repo = new MemoryRepo(db)
    expect(() => repo.insert({ ...item("x", "b"), kind: "lesson" } as never, null)).toThrow()
    expect(repo.count()).toBe(0)
    const secretish = "NỘI-DUNG-RIÊNG-TƯ-KHÔNG-ĐƯỢC-LỘ"
    repo.insert(item("a", "x"), null)
    try {
      repo.insert(item("a", secretish), null)
      throw new Error("expected a storage error")
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError)
      expect((e as StorageError).code).toBe("storage_failed")
      expect((e as Error).message).not.toContain(secretish)
    }
    db.close()
  })

  test("a write blocked by another writer reports storage_busy; reopened file keeps data", async () => {
    const { open } = await tempFile()
    const holder = open()
    migrateMemory(holder, clock)
    new MemoryRepo(holder).insert(item("a", "Tôi không sử dụng margin"), null)
    const other = open()
    other.run("PRAGMA busy_timeout = 20")
    holder.run("BEGIN IMMEDIATE")
    try {
      new MemoryRepo(other).insert(item("b", "x"), null)
      throw new Error("expected storage_busy")
    } catch (e) {
      expect((e as StorageError).code).toBe("storage_busy")
    } finally {
      holder.run("ROLLBACK")
    }
    holder.close()
    const again = open()
    expect(new MemoryRepo(again).get("a")!.body).toBe("Tôi không sử dụng margin")
  })
})
