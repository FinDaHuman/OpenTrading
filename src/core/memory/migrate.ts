import type { Database } from "bun:sqlite"
import type { Clock } from "./deps"
import { isSqliteBusy } from "./repo"

/**
 * Memory keeps its own version table. PRAGMA user_version belongs to whoever owns the shared database file,
 * which is the core, so memory never reads or writes it.
 */
const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS memory_schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`

interface Migration {
  version: number
  up(db: Database): void
}

/*
 * The CHECKs use the final PA3 enums so V1–V2 can widen the V0 subset without rebuilding the table.
 * V3 still rebuilds it: the body CHECK and the origin CHECK cannot be dropped with ALTER TABLE, and the body moves
 * to memory_version then.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      db.run(`CREATE TABLE memory (
        id             TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        kind           TEXT NOT NULL CHECK (kind IN ('profile', 'lesson', 'note')),
        scope          TEXT NOT NULL,
        body           TEXT,
        status         TEXT NOT NULL CHECK (
                         status IN ('proposed', 'active', 'disabled', 'archived', 'rejected', 'purged')
                       ),
        visibility     TEXT NOT NULL CHECK (visibility IN ('model', 'restricted')),
        created_by     TEXT NOT NULL CHECK (created_by IN ('user', 'system')),
        origin         TEXT NOT NULL CHECK (
                         origin IN ('profile_form', 'remember_command', 'note_command', 'review_ui',
                                    'feedback', 'validator', 'tool_error')
                       ),
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        CHECK (
          (status IN ('rejected', 'purged') AND body IS NULL) OR
          (status IN ('proposed', 'active', 'disabled', 'archived') AND body IS NOT NULL)
        )
      )`)
      db.run("CREATE INDEX memory_select ON memory (status, kind, scope, visibility)")
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

/**
 * Apply missing memory migrations, each in its own BEGIN IMMEDIATE transaction together with its version row.
 * Safe to call on every start and from several processes: the version is re-read inside the lock, so a migration
 * another process already applied is skipped. If the connection has no busy_timeout, a bounded one is set for the
 * duration and the original value restored; running out of time raises MigrationBusyError, never a silent skip.
 */
export function migrateMemory(db: Database, clock: Clock, opts: { busyTimeoutMs?: number } = {}): number[] {
  const original = busyTimeout(db)
  if (original === 0) db.run(`PRAGMA busy_timeout = ${Math.max(1, Math.floor(opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS))}`)
  const applied: number[] = []
  try {
    for (const m of MIGRATIONS) {
      const ran = db
        .transaction(() => {
          db.run(MIGRATIONS_TABLE)
          const current =
            db.query<{ v: number | null }, []>("SELECT max(version) AS v FROM memory_schema_migrations").get()?.v ?? 0
          if (current >= m.version) return false
          m.up(db)
          db.run("INSERT INTO memory_schema_migrations (version, applied_at) VALUES (?, ?)", [
            m.version,
            clock.now().toISOString(),
          ])
          return true
        })
        .immediate()
      if (ran) applied.push(m.version)
    }
    return applied
  } catch (error) {
    if (isSqliteBusy(error)) throw new MigrationBusyError({ cause: error })
    throw error
  } finally {
    if (original === 0) db.run("PRAGMA busy_timeout = 0")
  }
}
