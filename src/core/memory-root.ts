import { Database } from "bun:sqlite"
import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { loadInstruments, TickerIndex } from "./market/tickers"
import { createMemoryProvider, createMemoryService } from "./memory"
import type { MemoryProvider } from "./memory/types"
import { loadRules } from "./rules/load"

/**
 * Production composition root for the SQLite memory: the only place that opens the real database and creates the
 * write capability bound to it. The harness picks it with `memory.provider = "sqlite"`.
 *
 * Connection policy (owned here, not by the memory module): WAL for concurrent readers, secure_delete so purged
 * content is overwritten on disk, and a bounded busy_timeout.
 */
export function openSqliteMemory(home: string, opts: { config?: unknown } = {}): MemoryProvider & { close(): void } {
  mkdirSync(home, { recursive: true })
  const db = new Database(path.join(home, "opentrading.db"), { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA secure_delete = ON")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA foreign_keys = ON")

  const service = createMemoryService(db, {
    config: opts.config,
    salt: installSalt(home),
    tickers: new TickerIndex(loadInstruments()),
    rules: () => loadRules({ user: path.join(home, "rules") }),
  })
  const provider = createMemoryProvider(service, { config: opts.config })
  return Object.assign(provider, { close: () => db.close() })
}

/** Per-installation fingerprint salt, kept outside the database so a leaked database cannot be dictionary-checked. */
function installSalt(home: string): string {
  const file = path.join(home, "memory-salt")
  if (existsSync(file)) {
    const salt = readFileSync(file, "utf8").trim()
    if (/^[0-9a-f]{64}$/.test(salt)) return salt
  }
  const salt = randomBytes(32).toString("hex")
  writeFileSync(file, `${salt}\n`, "utf8")
  if (process.platform !== "win32") chmodSync(file, 0o600)
  return salt
}
