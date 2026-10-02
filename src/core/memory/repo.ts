import type { Database } from "bun:sqlite"
import { guard } from "./repo-errors"
import { foldVietnamese, type Kind, MemoryItem, type SourceEvent, type Status, type Visibility } from "./schema"

export { isSqliteBusy, StorageError } from "./repo-errors"

/** A memory row joined with its current version. */
export interface MemoryRow {
  id: string
  schema_version: number
  kind: string
  scope: string
  status: string
  visibility: string
  created_by: string
  origin: string
  current_version: number
  fingerprint: string | null
  created_at: string
  updated_at: string
  title: string | null
  body: string | null
  as_of: string
  expires_at: string | null
  source_events_json: string
}

/** A stored row read back as an item, or the reason it is not one. Invalid rows are reported, never dropped. */
export type RowResult = { ok: true; item: MemoryItem } | { ok: false; id: string }

export function rowToItem(row: MemoryRow): RowResult {
  let sourceEvents: unknown
  try {
    sourceEvents = JSON.parse(row.source_events_json)
  } catch {
    return { ok: false, id: row.id }
  }
  const parsed = MemoryItem.safeParse({
    schemaVersion: row.schema_version,
    id: row.id,
    version: row.current_version,
    kind: row.kind,
    scope: row.scope,
    title: row.title,
    body: row.body,
    status: row.status,
    visibility: row.visibility,
    createdBy: row.created_by,
    origin: row.origin,
    asOf: row.as_of,
    expiresAt: row.expires_at,
    sourceEvents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  return parsed.success ? { ok: true, item: parsed.data } : { ok: false, id: row.id }
}

/** Compare-and-set on status: only moves a row that is still in one of the expected states. */
const statusUpdate = (from: readonly string[]) =>
  `UPDATE memory SET status = ?, updated_at = ? WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`

const SELECT = `SELECT m.*, v.title, v.body, v.as_of, v.expires_at, v.source_events_json
  FROM memory m JOIN memory_version v ON v.memory_id = m.id AND v.version = m.current_version`

export interface RowFilter {
  statuses?: readonly Status[]
  kinds?: readonly Kind[]
  scopes?: readonly string[]
  visibilities?: readonly Visibility[]
  ids?: readonly string[]
  /** Only items still valid on this Vietnam calendar date (expires_at inclusive). */
  validOn?: string
}

export interface NewVersion {
  title: string | null
  body: string
  asOf: string
  expiresAt: string | null
  sourceEvents: SourceEvent[]
}

/**
 * Storage for memory. Internal to the memory module: callers outside it go through the service.
 * The Database is injected; this class never opens a file itself. Every write that touches more than one table
 * runs in a transaction so the index and the versions never disagree.
 */
export class MemoryRepo {
  constructor(private readonly db: Database) {}

  insert(item: MemoryItem, fingerprint: string | null): void {
    const v = MemoryItem.parse(item)
    guard(() =>
      this.db.transaction(() => {
        this.db.run(
          `INSERT INTO memory (id, schema_version, kind, scope, status, visibility, created_by, origin,
                               current_version, fingerprint, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            v.id,
            v.schemaVersion,
            v.kind,
            v.scope,
            v.status,
            v.visibility,
            v.createdBy,
            v.origin,
            v.version,
            fingerprint,
            v.createdAt,
            v.updatedAt,
          ],
        )
        this.db.run(
          `INSERT INTO memory_version (memory_id, version, title, body, as_of, expires_at, source_events_json,
                                       created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [v.id, v.version, v.title, v.body, v.asOf, v.expiresAt, JSON.stringify(v.sourceEvents), v.createdAt],
        )
        if (v.body !== null) this.indexText(v.id, v.title, v.body)
      })(),
    )
  }

  get(id: string): MemoryRow | null {
    return guard(() => this.db.query<MemoryRow, [string]>(`${SELECT} WHERE m.id = ?`).get(id))
  }

  /** Rows matching every given condition, ordered by id so callers start from a stable order. */
  query(filter: RowFilter = {}): MemoryRow[] {
    const where: string[] = []
    const params: (string | number)[] = []
    const inList = (column: string, values: readonly string[] | undefined) => {
      if (values === undefined) return
      if (values.length === 0) where.push("0")
      else {
        where.push(`${column} IN (${values.map(() => "?").join(", ")})`)
        params.push(...values)
      }
    }
    inList("m.status", filter.statuses)
    inList("m.kind", filter.kinds)
    inList("m.scope", filter.scopes)
    inList("m.visibility", filter.visibilities)
    inList("m.id", filter.ids)
    if (filter.validOn !== undefined) {
      where.push("(v.expires_at IS NULL OR ? <= v.expires_at)")
      params.push(filter.validOn)
    }
    const sql = `${SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY m.id`
    return guard(() => this.db.query<MemoryRow, (string | number)[]>(sql).all(...params))
  }

  /** Edits never overwrite: they add version n+1 and point the row at it. */
  addVersion(id: string, next: NewVersion, now: string, fingerprint: string | null): number {
    return guard(() =>
      this.db.transaction(() => {
        const row = this.db
          .query<{ current_version: number }, [string]>("SELECT current_version FROM memory WHERE id = ?")
          .get(id)
        if (!row) return 0
        const version = row.current_version + 1
        this.db.run(
          `INSERT INTO memory_version (memory_id, version, title, body, as_of, expires_at, source_events_json,
                                       created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, version, next.title, next.body, next.asOf, next.expiresAt, JSON.stringify(next.sourceEvents), now],
        )
        this.db.run("UPDATE memory SET current_version = ?, fingerprint = ?, updated_at = ? WHERE id = ?", [
          version,
          fingerprint,
          now,
          id,
        ])
        this.db.run("DELETE FROM memory_fts WHERE memory_id = ?", [id])
        this.indexText(id, next.title, next.body)
        return version
      })(),
    )
  }

  /** Move from one of `from` to `to`. False when the row is missing or in another state. */
  setStatus(id: string, from: readonly Status[], to: Status, now: string): boolean {
    return guard(() => this.db.run(statusUpdate(from), [to, now, id, ...from]).changes === 1)
  }

  /**
   * Erase the content of every version and drop the item from search, keeping id, kind, scope and fingerprint.
   * Used for rejected proposals and for purge. The FTS index is optimized so deleted tokens leave its segments.
   */
  eraseContent(id: string, from: readonly Status[], to: "rejected" | "purged", now: string): boolean {
    return guard(() =>
      this.db.transaction(() => {
        if (this.db.run(statusUpdate(from), [to, now, id, ...from]).changes !== 1) return false
        this.db.run("UPDATE memory_version SET title = NULL, body = NULL WHERE memory_id = ?", [id])
        this.db.run("DELETE FROM memory_fts WHERE memory_id = ?", [id])
        this.db.run("INSERT INTO memory_fts (memory_fts) VALUES ('optimize')")
        return true
      })(),
    )
  }

  /** Best effort to push erased pages out of the WAL file. A no-op for in-memory databases. */
  checkpoint(): void {
    guard(() => this.db.run("PRAGMA wal_checkpoint(TRUNCATE)"))
  }

  versions(id: string): { version: number; title: string | null; body: string | null }[] {
    return guard(() =>
      this.db
        .query<{ version: number; title: string | null; body: string | null }, [string]>(
          "SELECT version, title, body FROM memory_version WHERE memory_id = ? ORDER BY version",
        )
        .all(id),
    )
  }

  findByFingerprint(fingerprint: string): { id: string; status: string }[] {
    return guard(() =>
      this.db
        .query<{ id: string; status: string }, [string]>("SELECT id, status FROM memory WHERE fingerprint = ?")
        .all(fingerprint),
    )
  }

  /** Proposals the system created since the given ISO timestamp (for the daily cap). */
  countSystemProposalsSince(sinceIso: string): number {
    return guard(
      () =>
        this.db
          .query<{ n: number }, [string]>(
            "SELECT count(*) AS n FROM memory WHERE created_by = 'system' AND created_at >= ?",
          )
          .get(sinceIso)!.n,
    )
  }

  /** Full-text lookup over folded title and body. Returns memory ids with a short snippet, best match first. */
  search(foldedQuery: string, limit: number): { memory_id: string; snippet: string }[] {
    return guard(() =>
      this.db
        .query<{ memory_id: string; snippet: string }, [string, number]>(
          `SELECT memory_id, snippet(memory_fts, 1, '[', ']', '…', 12) AS snippet
           FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(foldedQuery, limit),
    )
  }

  recordUsage(rows: { memoryId: string; sessionId: string; turn: number; verdict: string }[], at: string): void {
    if (rows.length === 0) return
    guard(() =>
      this.db.transaction(() => {
        for (const r of rows)
          this.db.run("INSERT INTO memory_usage (memory_id, session_id, turn, verdict, at) VALUES (?, ?, ?, ?, ?)", [
            r.memoryId,
            r.sessionId,
            r.turn,
            r.verdict,
            at,
          ])
      })(),
    )
  }

  /** The last `window` applications of a memory, each with whether that turn was rated harmful or helpful. */
  recentApplications(memoryId: string, window: number): { harmful: boolean; helpful: boolean }[] {
    return guard(() =>
      this.db
        .query<{ harmful: number; helpful: number }, [string, number]>(
          `SELECT
             EXISTS (SELECT 1 FROM memory_usage h WHERE h.memory_id = a.memory_id AND h.session_id = a.session_id
                     AND h.turn = a.turn AND h.verdict = 'harmful') AS harmful,
             EXISTS (SELECT 1 FROM memory_usage h WHERE h.memory_id = a.memory_id AND h.session_id = a.session_id
                     AND h.turn = a.turn AND h.verdict = 'helpful') AS helpful
           FROM memory_usage a WHERE a.memory_id = ? AND a.verdict = 'applied'
           ORDER BY a.at DESC, a.rowid DESC LIMIT ?`,
        )
        .all(memoryId, window)
        .map((r) => ({ harmful: r.harmful === 1, helpful: r.helpful === 1 })),
    )
  }

  usageCounts(memoryId: string): { applied: number; helpful: number; harmful: number } {
    const rows = guard(() =>
      this.db
        .query<{ verdict: string; n: number }, [string]>(
          "SELECT verdict, count(*) AS n FROM memory_usage WHERE memory_id = ? GROUP BY verdict",
        )
        .all(memoryId),
    )
    const get = (v: string) => rows.find((r) => r.verdict === v)?.n ?? 0
    return { applied: get("applied"), helpful: get("helpful"), harmful: get("harmful") }
  }

  count(): number {
    return guard(() => this.db.query<{ n: number }, []>("SELECT count(*) AS n FROM memory").get()!.n)
  }

  private indexText(id: string, title: string | null, body: string) {
    this.db.run("INSERT INTO memory_fts (title_folded, body_folded, memory_id) VALUES (?, ?, ?)", [
      foldVietnamese(title ?? ""),
      foldVietnamese(body),
      id,
    ])
  }
}
