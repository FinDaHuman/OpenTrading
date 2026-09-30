import type { Database } from "bun:sqlite"
import { MemoryItemV0 } from "./schema"

/** SQLite reports lock contention as SQLITE_BUSY (5) or SQLITE_LOCKED (6). */
export function isSqliteBusy(error: unknown): boolean {
  const e = error as { code?: unknown; errno?: unknown }
  return e?.code === "SQLITE_BUSY" || e?.code === "SQLITE_LOCKED" || e?.errno === 5 || e?.errno === 6
}

/** The one place SQLite errors become memory errors. Messages carry no memory body. */
export class StorageError extends Error {
  constructor(
    readonly code: "storage_busy" | "storage_failed",
    options?: { cause?: unknown },
  ) {
    super(code === "storage_busy" ? "memory database is locked" : "memory database operation failed", options)
  }
}

const guard = <T>(fn: () => T): T => {
  try {
    return fn()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError(isSqliteBusy(error) ? "storage_busy" : "storage_failed", { cause: error })
  }
}

export interface MemoryRow {
  id: string
  schema_version: number
  kind: string
  scope: string
  body: string | null
  status: string
  visibility: string
  created_by: string
  origin: string
  created_at: string
  updated_at: string
}

/** A stored row read back as a V0 item, or the reason it is not one. Invalid rows are reported, never dropped. */
export type RowResult = { ok: true; item: MemoryItemV0 } | { ok: false; id: string }

export function rowToItem(row: MemoryRow): RowResult {
  const parsed = MemoryItemV0.safeParse({
    schemaVersion: row.schema_version,
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    body: row.body,
    status: row.status,
    visibility: row.visibility,
    createdBy: row.created_by,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  return parsed.success ? { ok: true, item: parsed.data } : { ok: false, id: row.id }
}

/**
 * Storage for V0 profiles. Internal to the memory module: callers outside it go through the service.
 * The Database is injected; this class never opens a file itself.
 */
export class MemoryRepo {
  constructor(private readonly db: Database) {}

  /** Validates against the V0 subset before writing instead of relying on the table CHECKs alone. */
  insert(item: MemoryItemV0): void {
    const v = MemoryItemV0.parse(item)
    guard(() =>
      this.db.run(
        `INSERT INTO memory (id, schema_version, kind, scope, body, status, visibility, created_by, origin,
                             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.id, v.schemaVersion, v.kind, v.scope, v.body, v.status, v.visibility, v.createdBy, v.origin, v.createdAt,
          v.updatedAt],
      ),
    )
  }

  get(id: string): MemoryRow | null {
    return guard(() => this.db.query<MemoryRow, [string]>("SELECT * FROM memory WHERE id = ?").get(id))
  }

  /** Rows eligible for T1 in V0. Ordered by id here; the renderer sorts again so row order never matters. */
  listActiveProfiles(): MemoryRow[] {
    return guard(() =>
      this.db
        .query<MemoryRow, []>(
          `SELECT * FROM memory
           WHERE status = 'active' AND kind = 'profile' AND scope = 'global' AND visibility = 'model'
           ORDER BY id`,
        )
        .all(),
    )
  }

  /**
   * Application-level purge: the body becomes NULL and the row stops being selectable.
   * This does not erase bytes from disk (no secure_delete or WAL checkpoint in V0).
   */
  purge(id: string, now: string): "purged" | "not_found" {
    const changes = guard(
      () =>
        this.db.run("UPDATE memory SET body = NULL, status = 'purged', updated_at = ? WHERE id = ? AND status = 'active'", [
          now,
          id,
        ]).changes,
    )
    return changes === 1 ? "purged" : "not_found"
  }

  count(): number {
    return guard(() => this.db.query<{ n: number }, []>("SELECT count(*) AS n FROM memory").get()!.n)
  }
}
