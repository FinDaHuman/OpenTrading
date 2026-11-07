import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach } from "bun:test"
import { openMemoryStore, type MemoryStore, type MemoryStoreOptions } from "../../src/core/memory/store/open"

export const FIXED_TIME = new Date("2026-11-01T08:00:00.000Z")

/** A clock the test moves by hand, so valid_from / valid_to and created_at are exact. */
export function testClock(start = FIXED_TIME) {
  let t = start.getTime()
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms
    },
  }
}

/**
 * A temp folder per test, and every store or raw connection opened through it closed in
 * afterEach BEFORE the folder is removed: on Windows an open SQLite connection keeps the file locked.
 */
export function useTempStores() {
  let dir = ""
  const stores: MemoryStore[] = []
  const raws: Database[] = []
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ot-mem-"))
  })
  afterEach(async () => {
    for (const s of stores.splice(0)) s.close()
    for (const d of raws.splice(0)) d.close(true)
    await rm(dir, { recursive: true, force: true })
  })
  const file = (name = "memory.db") => path.join(dir, name)
  return {
    dir: () => dir,
    file,
    open(opts: MemoryStoreOptions = {}, name?: string) {
      const store = openMemoryStore(file(name), { now: testClock().now, ...opts })
      stores.push(store)
      return store
    },
    /** A plain connection for arranging or inspecting the file behind the store's back. */
    raw(name?: string) {
      const db = new Database(file(name), { strict: true })
      raws.push(db)
      return db
    },
  }
}
