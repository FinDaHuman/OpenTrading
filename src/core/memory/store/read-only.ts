import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { MemoryStoreError, openError } from "./errors"
import { memoryGate } from "./gate"
import { createStoreContext, type MemoryGate } from "./open"
import { readPresence, readTombstones, type PresenceRef, type PresenceVersion } from "./presence"
import { APPLICATION_ID, SCHEMA_VERSION } from "./schema"

/**
 * memory.db opened only to read, for the constraints that apply whatever /config chose. Unlike
 * openMemoryStore it never creates the file or its folder, never migrates and never writes, so a store
 * from a newer build, a foreign file or a damaged one is left exactly as it is.
 *
 * A future migration that changes the constraint tables must update this reader: it accepts every
 * schema version from 1 to SCHEMA_VERSION as is.
 */

export type ReadOnlyStore =
  | { state: "missing" }
  /** A file with no schema yet (a first open that stopped before building it). */
  | { state: "empty" }
  | {
      state: "open"
      gate: MemoryGate
      /** For the redaction check only (presence.ts); not the policy-checked path. */
      presence(refs: readonly PresenceRef[]): PresenceVersion[]
      /** For the redaction check only: the refs whose deletion the store recorded (presence.ts). */
      tombstones(refs: readonly PresenceRef[]): PresenceRef[]
      close(): void
    }

/** Test seam (spyOn): the look for the file before SQLite opens it. */
export const readOnlyDisk = {
  exists: (file: string) => existsSync(file),
}

const pragma = (db: Database, name: string) => (db.query(`PRAGMA ${name}`).get() as Record<string, number>)[name]!

const DEFAULT_BUSY_TIMEOUT_MS = 100

/** Throws MemoryStoreError (newer_schema, not_a_store, corrupt, busy, open_failed). */
export function openStoreReadOnly(file: string, opts: { busyTimeoutMs?: number } = {}): ReadOnlyStore {
  if (!readOnlyDisk.exists(file)) return { state: "missing" }
  let db: Database | undefined
  try {
    // readwrite + create:false: Bun 1.4.2 rejects { create: false } alone ("bad parameter or other API
    // misuse") even for a file that exists. Read-only mode is not used: a WAL store then needs an existing
    // -shm file and fails spuriously. Nothing below writes, and query_only makes SQLite refuse it anyway.
    db = new Database(file, { readwrite: true, create: false, strict: true })
    db.run(`PRAGMA busy_timeout = ${opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`)
    db.run("PRAGMA query_only = ON")
    const tables = (db.query("SELECT count(*) AS n FROM sqlite_master").get() as { n: number }).n
    if (tables === 0) {
      db.close(true)
      return { state: "empty" }
    }
    if (pragma(db, "application_id") !== APPLICATION_ID) {
      throw new MemoryStoreError(
        "not_a_store",
        `File ${file} không phải kho memory của OpenTrading. File được giữ nguyên.`,
      )
    }
    const version = pragma(db, "user_version")
    if (version > SCHEMA_VERSION) {
      throw new MemoryStoreError(
        "newer_schema",
        `Kho memory do phiên bản OpenTrading mới hơn tạo ` +
          `(lược đồ bản ${version}, bản này hiểu tới bản ${SCHEMA_VERSION}). Kho được giữ nguyên: ${file}`,
      )
    }
    // Version 0 has no constraint table to read; only a migration (never run here) would add it.
    if (version === 0) {
      db.close(true)
      return { state: "empty" }
    }
  } catch (error) {
    // close(true) releases the file now; Windows keeps it locked until every statement is collected otherwise.
    db?.close(true)
    // The file went between the look and the open (moved away by the user or another window): nothing to read.
    if ((error as { code?: unknown }).code === "SQLITE_CANTOPEN" && !readOnlyDisk.exists(file)) {
      return { state: "missing" }
    }
    throw openError(error, file)
  }
  const conn = db
  const { ctx } = createStoreContext(conn, () => new Date(), opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS)
  let closed = false
  return Object.freeze({
    state: "open" as const,
    gate: Object.freeze(memoryGate(ctx)),
    presence: (refs: readonly PresenceRef[]) => ctx.read(() => readPresence(conn, refs)),
    tombstones: (refs: readonly PresenceRef[]) => ctx.read(() => readTombstones(conn, refs)),
    close() {
      if (closed) return
      closed = true
      conn.close(true)
    },
  })
}
