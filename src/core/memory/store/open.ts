import { Database } from "bun:sqlite"
import { closeSync, mkdirSync, openSync } from "node:fs"
import path from "node:path"
import { constraintReads, constraintWrites } from "./constraints"
import { decisionReads, decisionWrites } from "./decisions"
import { MemoryStoreError, openError, storeError } from "./errors"
import { memoryGate } from "./gate"
import { lessonReads, lessonWrites } from "./lessons"
import { APPLICATION_ID, MIGRATIONS, type Migration } from "./schema"
import { subjectReads, subjectWrites } from "./subjects"
import { thesisReads, thesisWrites } from "./theses"

/**
 * Opens memory.db from an explicit path; nothing here ever resolves the data directory, so a
 * test can only ever touch its temp folder. The API is synchronous (bun:sqlite is); the one
 * wait it can do, for another process's write lock, is capped by `busyTimeoutMs`.
 */

export interface MemoryStoreOptions {
  now?: () => Date
  /** How long a write waits for another window's write before failing as "busy". Must stay under the UI's 2 s waits. */
  busyTimeoutMs?: number
  /** Test seam: the migration steps to run instead of the real ones. */
  migrations?: readonly Migration[]
}

/** What the per-kind modules get: the connection, the clock, and the one way to write. */
export interface StoreContext {
  readonly db: Database
  /** One timestamp per operation, so a version's valid_to equals the next one's valid_from exactly. */
  now(): string
  /** Runs `fn` in BEGIN IMMEDIATE: the version check and the write cannot be split by another process. */
  write<T>(fn: () => T): T
  /** Runs `fn` and maps SQLite errors the same way writes do. */
  read<T>(fn: () => T): T
  /**
   * After a committed delete: move the WAL into the store file and truncate it, so the deleted text
   * does not linger in memory.db-wal. Best effort; see the implementation.
   */
  flushDeleted(): void
}

export type MemoryReader = Readonly<
  ReturnType<typeof constraintReads> &
    ReturnType<typeof subjectReads> &
    ReturnType<typeof thesisReads> &
    ReturnType<typeof lessonReads> &
    ReturnType<typeof decisionReads>
>
export type MemoryWriter = Readonly<
  ReturnType<typeof constraintWrites> &
    ReturnType<typeof subjectWrites> &
    ReturnType<typeof thesisWrites> &
    ReturnType<typeof lessonWrites> &
    ReturnType<typeof decisionWrites>
>
export type MemoryGate = Readonly<ReturnType<typeof memoryGate>>

export interface MemoryStore {
  readonly path: string
  /** Every kind, decisions and deleted entries included: for the user's own /memory screen only. */
  readonly reader: MemoryReader
  readonly writer: MemoryWriter
  /** The policy-checked read path; the only part of the store model-facing code is given. */
  readonly gate: MemoryGate
  /** True when the store changed (here or in another window) since the previous call. */
  changed(): boolean
  close(): void
}

const DEFAULT_BUSY_TIMEOUT_MS = 1000

const pragma = (db: Database, name: string) => (db.query(`PRAGMA ${name}`).get() as Record<string, number>)[name]!

/**
 * A new store file is created owner-only (same rule as auth.json) where the OS has such modes;
 * SQLite gives -wal/-shm the same mode. Another window may create it first: EEXIST is fine.
 */
function createPrivateFile(file: string) {
  if (process.platform === "win32") return
  try {
    closeSync(openSync(file, "wx", 0o600))
  } catch (error) {
    if ((error as { code?: unknown }).code !== "EEXIST") throw error
  }
}

const newerSchema = (file: string, version: number, known: number) =>
  new MemoryStoreError(
    "newer_schema",
    `Kho memory do phiên bản OpenTrading mới hơn tạo ` +
      `(lược đồ bản ${version}, bản này hiểu tới bản ${known}). ` +
      `Kho được giữ nguyên: ${file}`,
  )

function prepare(db: Database, file: string, migrations: readonly Migration[]) {
  // Read before writing anything: a newer or foreign file must be left exactly as it is.
  const tables = (db.query("SELECT count(*) AS n FROM sqlite_master").get() as { n: number }).n
  if (tables > 0 && pragma(db, "application_id") !== APPLICATION_ID) {
    throw new MemoryStoreError(
      "not_a_store",
      `File ${file} không phải kho memory của OpenTrading. File được giữ nguyên.`,
    )
  }
  const version = pragma(db, "user_version")
  if (version > migrations.length) throw newerSchema(file, version, migrations.length)
  // Per-connection settings: they take no lock.
  db.run("PRAGMA foreign_keys = ON")
  // Deleting sets content to NULL; this also zeroes the old bytes in the store file (and flushDeleted
  // empties the WAL). That shrinks what is left on disk; it is not physical deletion: backups and what
  // was sent to a provider are out of reach, so the UI never promises it.
  db.run("PRAGMA secure_delete = ON")
  // Up to date: opened without taking the write lock, so another window's long write cannot block it.
  if (version === migrations.length) return
  // A file system without WAL support keeps the old journal mode; the store stays correct, only less concurrent.
  db.run("PRAGMA journal_mode = WAL")
  // One step per transaction, re-reading the version inside it: another window may have migrated
  // meanwhile, possibly with a newer build than this one.
  for (;;) {
    const done = db
      .transaction(() => {
        const at = pragma(db, "user_version")
        if (at > migrations.length) throw newerSchema(file, at, migrations.length)
        if (at === migrations.length) return true
        migrations[at]!(db)
        db.run(`PRAGMA user_version = ${at + 1}`)
        db.run(`PRAGMA application_id = ${APPLICATION_ID}`)
        return false
      })
      .immediate()
    if (done) return
  }
}

/**
 * The context the per-kind modules run in. Exported for tests only; the store builds its own.
 * `takeWrote` reports (and resets) whether this connection committed a write since the last call.
 */
export function createStoreContext(db: Database, clock: () => Date, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS) {
  let wrote = false
  const totalChanges = () => (db.query("SELECT total_changes() AS n").get() as { n: number }).n
  const ctx: StoreContext = {
    db,
    now: () => clock().toISOString(),
    write<T>(fn: () => T): T {
      try {
        const before = totalChanges()
        const result = db.transaction(fn).immediate()
        // Only a write that changed rows is a change: setting a state it already has is not.
        if (totalChanges() !== before) wrote = true
        return result
      } catch (error) {
        throw storeError(error)
      }
    },
    read<T>(fn: () => T): T {
      try {
        // One snapshot per read: a read made of several SELECTs never sees half of another window's delete.
        return db.transaction(fn).deferred()
      } catch (error) {
        throw storeError(error)
      }
    },
    flushDeleted() {
      // The delete has committed, so nothing here may fail it. Without waiting (busy_timeout 0): another
      // window reading the store makes the checkpoint partial or busy, and then SQLite's own checkpoints
      // finish the job later. Deleting is rare and user-initiated, so the extra disk work does not matter.
      try {
        db.run("PRAGMA busy_timeout = 0")
        db.query("PRAGMA wal_checkpoint(TRUNCATE)").get()
      } catch {
        // Partial or busy checkpoint: nothing to report, see above.
      } finally {
        db.run(`PRAGMA busy_timeout = ${busyTimeoutMs}`)
      }
    },
  }
  return {
    ctx,
    takeWrote() {
      const was = wrote
      wrote = false
      return was
    },
  }
}

/** A usable busy timeout: a finite, non-negative whole number of ms. SQLite reads NaN as 0 ("never wait"). */
function busyTimeout(ms: number | undefined) {
  return ms !== undefined && Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : DEFAULT_BUSY_TIMEOUT_MS
}

export function openMemoryStore(file: string, opts: MemoryStoreOptions = {}): MemoryStore {
  const migrations = opts.migrations ?? MIGRATIONS
  const clock = opts.now ?? (() => new Date())
  const busyMs = busyTimeout(opts.busyTimeoutMs)

  // A failed open never deletes the file, even one it just created: another window may have opened it
  // meanwhile. A schema is created in one transaction, so a left-over file is empty, and the next open
  // builds it.
  let db: Database | undefined
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    createPrivateFile(file)
    db = new Database(file, { create: true, readwrite: true, strict: true })
    db.run(`PRAGMA busy_timeout = ${busyMs}`)
    prepare(db, file, migrations)
  } catch (error) {
    // close(true) releases the file now; the default close waits for every statement to be collected,
    // and until then Windows keeps the file locked.
    db?.close(true)
    throw openError(error, file)
  }
  const conn = db
  const { ctx, takeWrote } = createStoreContext(conn, clock, busyMs)

  let seen = pragma(conn, "data_version")
  let closed = false

  return Object.freeze({
    path: file,
    reader: Object.freeze({
      ...constraintReads(ctx),
      ...subjectReads(ctx),
      ...thesisReads(ctx),
      ...lessonReads(ctx),
      ...decisionReads(ctx),
    }),
    writer: Object.freeze({
      ...constraintWrites(ctx),
      ...subjectWrites(ctx),
      ...thesisWrites(ctx),
      ...lessonWrites(ctx),
      ...decisionWrites(ctx),
    }),
    gate: Object.freeze(memoryGate(ctx)),
    changed() {
      // data_version moves only for other connections' commits, so this connection's own writes are tracked apart.
      const now = pragma(conn, "data_version")
      const wrote = takeWrote()
      const changed = wrote || now !== seen
      seen = now
      return changed
    },
    close() {
      if (closed) return
      closed = true
      conn.close(true)
    },
  })
}
