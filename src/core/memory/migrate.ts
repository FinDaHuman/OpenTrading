import type { Database } from "bun:sqlite"
import type { Clock } from "./deps"
import { isSqliteBusy } from "./repo-errors"
import { foldVietnamese } from "./schema"

/**
 * Memory keeps its own version table. PRAGMA user_version belongs to whoever owns the shared database file,
 * which is the core, so memory never reads or writes it.
 */
const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS memory_schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`

/** Test-only hook to prove a failed step rolls the whole migration back. */
export type FaultInjector = (step: string) => void

interface Migration {
  version: number
  /** foreign_keys cannot change inside a transaction, so the runner turns them off around it. */
  foreignKeysOff?: boolean
  up(db: Database, fault: FaultInjector): void
}

const KIND_CHECK = `kind IN ('profile', 'lesson', 'note')`
const STATUS_CHECK = `status IN ('proposed', 'active', 'disabled', 'archived', 'rejected', 'purged')`
const VISIBILITY_CHECK = `visibility IN ('model', 'restricted')`
const ORIGIN_CHECK = `origin IN ('profile_form', 'remember_command', 'note_command', 'review_ui',
                                'feedback', 'validator', 'tool_error')`

/** Indexes and triggers of `memory`. A rebuild drops them with the old table, so each one is recreated by name. */
const MEMORY_INDEXES = ["CREATE INDEX memory_select ON memory (status, kind, scope, visibility)"]

const MIGRATIONS: Migration[] = [
  {
    // V0: one table, explicit global profiles only.
    version: 1,
    up(db) {
      db.run(`CREATE TABLE memory (
        id             TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        kind           TEXT NOT NULL CHECK (${KIND_CHECK}),
        scope          TEXT NOT NULL,
        body           TEXT,
        status         TEXT NOT NULL CHECK (${STATUS_CHECK}),
        visibility     TEXT NOT NULL CHECK (${VISIBILITY_CHECK}),
        created_by     TEXT NOT NULL CHECK (created_by IN ('user', 'system')),
        origin         TEXT NOT NULL CHECK (${ORIGIN_CHECK}),
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        CHECK (
          (status IN ('rejected', 'purged') AND body IS NULL) OR
          (status IN ('proposed', 'active', 'disabled', 'archived') AND body IS NOT NULL)
        )
      )`)
      for (const sql of MEMORY_INDEXES) db.run(sql)
    },
  },
  {
    /*
     * V3: rebuild `memory` without its body column and move bodies into immutable versions, add usage stats and
     * the folded full-text index. The body CHECK cannot be dropped with ALTER TABLE, hence the rebuild.
     * Every step runs in this one transaction; a failure anywhere leaves the V0 table untouched.
     */
    version: 2,
    foreignKeysOff: true,
    up(db, fault) {
      db.run(`CREATE TABLE memory_new (
        id              TEXT PRIMARY KEY,
        schema_version  INTEGER NOT NULL,
        kind            TEXT NOT NULL CHECK (${KIND_CHECK}),
        scope           TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (${STATUS_CHECK}),
        visibility      TEXT NOT NULL CHECK (${VISIBILITY_CHECK}),
        created_by      TEXT NOT NULL CHECK (created_by IN ('user', 'system')),
        origin          TEXT NOT NULL CHECK (${ORIGIN_CHECK}),
        current_version INTEGER NOT NULL CHECK (current_version >= 1),
        fingerprint     TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      )`)
      db.run(`CREATE TABLE memory_version (
        memory_id          TEXT NOT NULL REFERENCES memory (id) ON DELETE CASCADE,
        version            INTEGER NOT NULL,
        title              TEXT,
        body               TEXT,
        as_of              TEXT NOT NULL,
        expires_at         TEXT,
        source_events_json TEXT NOT NULL DEFAULT '[]',
        created_at         TEXT NOT NULL,
        PRIMARY KEY (memory_id, version)
      )`)
      fault("tables")
      // Bodies first, while the old table still exists. V0 had no as_of; its UTC creation date stands in.
      db.run(`INSERT INTO memory_version (memory_id, version, title, body, as_of, expires_at, source_events_json,
                                          created_at)
              SELECT id, 1, NULL, body, substr(created_at, 1, 10), NULL, '[]', created_at FROM memory`)
      db.run(`INSERT INTO memory_new (id, schema_version, kind, scope, status, visibility, created_by, origin,
                                      current_version, fingerprint, created_at, updated_at)
              SELECT id, schema_version, kind, scope, status, visibility, created_by, origin, 1, NULL,
                     created_at, updated_at FROM memory`)
      const n = (sql: string) => db.query<{ n: number }, []>(sql).get()!.n
      const old = n("SELECT count(*) AS n FROM memory")
      if (old !== n("SELECT count(*) AS n FROM memory_new") || old !== n("SELECT count(*) AS n FROM memory_version"))
        throw new Error("memory rebuild row counts differ")
      fault("copied")
      db.run("DROP TABLE memory")
      db.run("ALTER TABLE memory_new RENAME TO memory")
      fault("renamed")
      for (const sql of MEMORY_INDEXES) db.run(sql)
      db.run(`CREATE TABLE memory_usage (
        memory_id  TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn       INTEGER NOT NULL,
        verdict    TEXT NOT NULL CHECK (verdict IN ('applied', 'helpful', 'harmful')),
        at         TEXT NOT NULL
      )`)
      db.run("CREATE INDEX memory_usage_by_memory ON memory_usage (memory_id, at)")
      db.run(`CREATE VIRTUAL TABLE memory_fts USING fts5(
        title_folded, body_folded, memory_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
      )`)
      const live = db
        .query<{ id: string; body: string }, []>(
          `SELECT m.id, v.body FROM memory m JOIN memory_version v ON v.memory_id = m.id AND v.version = 1
           WHERE v.body IS NOT NULL`,
        )
        .all()
      for (const row of live)
        db.run("INSERT INTO memory_fts (title_folded, body_folded, memory_id) VALUES ('', ?, ?)", [
          foldVietnamese(row.body),
          row.id,
        ])
      fault("indexed")
      if (db.query("PRAGMA foreign_key_check").all().length > 0) throw new Error("memory rebuild broke a foreign key")
    },
  },
]

export const LATEST_MEMORY_SCHEMA = MIGRATIONS.at(-1)!.version

export class MigrationBusyError extends Error {
  readonly code = "migration_busy"
  constructor(options?: { cause?: unknown }) {
    super("memory migration could not get the database lock in time", options)
  }
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000

const busyTimeout = (db: Database) => db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout ?? 0
const foreignKeys = (db: Database) =>
  db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys ?? 0

/**
 * Apply missing memory migrations, each in its own BEGIN IMMEDIATE transaction together with its version row.
 * Safe to call on every start and from several processes: the version is re-read inside the lock, so a migration
 * another process already applied is skipped. If the connection has no busy_timeout, a bounded one is set for the
 * duration and the original value restored; running out of time raises MigrationBusyError, never a silent skip.
 * `upTo` stops at a given version (tests use it to build an older database).
 */
export function migrateMemory(
  db: Database,
  clock: Clock,
  opts: { busyTimeoutMs?: number; upTo?: number; fault?: FaultInjector } = {},
): number[] {
  const original = busyTimeout(db)
  const waitMs = Math.max(1, Math.floor(opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS))
  if (original === 0) db.run(`PRAGMA busy_timeout = ${waitMs}`)
  const fault = opts.fault ?? (() => {})
  const applied: number[] = []
  try {
    for (const m of MIGRATIONS) {
      if (opts.upTo !== undefined && m.version > opts.upTo) break
      const fkBefore = m.foreignKeysOff ? foreignKeys(db) : 0
      if (m.foreignKeysOff && fkBefore) db.run("PRAGMA foreign_keys = OFF")
      try {
        const ran = db
          .transaction(() => {
            db.run(MIGRATIONS_TABLE)
            const current =
              db.query<{ v: number | null }, []>("SELECT max(version) AS v FROM memory_schema_migrations").get()?.v ?? 0
            if (current >= m.version) return false
            m.up(db, fault)
            db.run("INSERT INTO memory_schema_migrations (version, applied_at) VALUES (?, ?)", [
              m.version,
              clock.now().toISOString(),
            ])
            return true
          })
          .immediate()
        if (ran) applied.push(m.version)
      } finally {
        if (m.foreignKeysOff && fkBefore) db.run("PRAGMA foreign_keys = ON")
      }
    }
    return applied
  } catch (error) {
    if (isSqliteBusy(error)) throw new MigrationBusyError({ cause: error })
    throw error
  } finally {
    if (original === 0) db.run("PRAGMA busy_timeout = 0")
  }
}
