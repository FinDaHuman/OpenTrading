import type { Database } from "bun:sqlite"
import { classifyContent } from "./content"
import { parseMemoryConfig, type MemoryConfig } from "./config"
import { type Clock, type IdFactory, systemClock, uuidV7Ids } from "./deps"
import { MigrationBusyError, migrateMemory } from "./migrate"
import type {
  ContextBudget,
  ContextContribution,
  MemoryPort,
  MemoryWarning,
  PurgeResult,
  RememberResult,
  TurnContextV0,
  UserMemoryCommands,
} from "./port"
import { fitsAlone } from "./render"
import { MemoryRepo, rowToItem, StorageError } from "./repo"
import { type MemoryItemV0, prepareBody, SCHEMA_VERSION } from "./schema"
import { effectiveMaxBytes, selectT1 } from "./select"

export interface MemoryServiceDeps {
  /** Raw `memory` section of the config file; parsed here. Invalid values throw at creation. */
  config?: unknown
  clock?: Clock
  ids?: IdFactory
}

export interface MemoryService {
  port: MemoryPort
  commands: UserMemoryCommands
}

const empty = (warnings: MemoryWarning[] = []): ContextContribution => ({
  stableBlocks: [],
  injection: null,
  entities: null,
  used: { memories: [], rules: [] },
  warnings,
})

// User-facing (shown on the TUI), so Vietnamese. Never includes a memory body.
const warn = {
  dbUnavailable: (): MemoryWarning => ({
    code: "db_unavailable",
    message: "Không đọc được memory; lượt này chạy không có memory.",
  }),
  selectionFailed: (): MemoryWarning => ({
    code: "selection_failed",
    message: "Lỗi khi chọn memory; lượt này chạy không có memory.",
  }),
  invalidRecord: (n: number): MemoryWarning => ({
    code: "invalid_record",
    message: `${n} bản ghi memory không hợp lệ đã bị bỏ qua.`,
  }),
  overflow: (n: number, max: number): MemoryWarning => ({
    code: "t1_overflow",
    message: `${n} memory không được nạp vì vượt giới hạn ${max} byte. Hãy gộp hoặc xoá bớt.`,
  }),
}

const storageCode = (error: unknown): "storage_busy" | "storage_failed" =>
  error instanceof MigrationBusyError || (error instanceof StorageError && error.code === "storage_busy")
    ? "storage_busy"
    : "storage_failed"

/**
 * Composition point for memory V0. Returns the read port and the write capability as two separate objects:
 * holding `commands` is the permission to write, so production code hands it only to the TUI adapter.
 * The Database is always passed in explicitly; this never opens or locates a database file itself.
 */
export function createMemoryService(db: Database, deps: MemoryServiceDeps = {}): MemoryService {
  const config: MemoryConfig = parseMemoryConfig(deps.config)
  const clock = deps.clock ?? systemClock
  const ids = deps.ids ?? uuidV7Ids
  const repo = new MemoryRepo(db)

  // Migrate lazily so a disabled memory never touches the database, and a failed attempt is retried next time.
  let ready = false
  const ensureReady = () => {
    if (ready) return
    migrateMemory(db, clock)
    ready = true
  }

  const port: MemoryPort = {
    async beforeTurn(_ctx: TurnContextV0, budget?: ContextBudget) {
      if (!config.enabled) return empty()

      let items: MemoryItemV0[]
      let invalid = 0
      try {
        ensureReady()
        items = []
        for (const row of repo.listActiveProfiles()) {
          const r = rowToItem(row)
          if (r.ok) items.push(r.item)
          else invalid++
        }
      } catch {
        return empty([warn.dbUnavailable()])
      }

      try {
        const max = effectiveMaxBytes(config, budget)
        const t1 = selectT1(items, max)
        const warnings: MemoryWarning[] = []
        if (invalid > 0) warnings.push(warn.invalidRecord(invalid))
        if (t1.overflow > 0) warnings.push(warn.overflow(t1.overflow, max))
        return {
          stableBlocks: t1.block === null ? [] : [t1.block],
          injection: null,
          entities: null,
          used: { memories: t1.used, rules: [] },
          warnings,
        }
      } catch {
        return empty([warn.selectionFailed()])
      }
    },
  }

  const commands: UserMemoryCommands = {
    async remember(input, opts): Promise<RememberResult> {
      const prepared = prepareBody((input as { body?: unknown } | null | undefined)?.body, config.maxItemBytes)
      if (!prepared.ok) return prepared

      const verdict = classifyContent(prepared.body)
      if (verdict.verdict === "rejected") return { ok: false, code: "content_rejected", reasons: verdict.reasons }
      // Nothing is written until the user confirms; confirmation never overrides a rejection.
      if (verdict.verdict === "ambiguous" && opts?.confirmAmbiguous !== true)
        return { ok: false, code: "needs_confirmation", reasons: verdict.reasons }

      const now = clock.now().toISOString()
      const item: MemoryItemV0 = {
        schemaVersion: SCHEMA_VERSION,
        id: ids.next(),
        kind: "profile",
        scope: "global",
        body: prepared.body,
        status: "active",
        visibility: "model",
        createdBy: "user",
        origin: "remember_command",
        createdAt: now,
        updatedAt: now,
      }
      if (!fitsAlone(item, config.t1MaxBytes)) return { ok: false, code: "t1_unfit", reasons: ["t1_max_bytes"] }

      try {
        ensureReady()
        repo.insert(item)
      } catch (error) {
        return { ok: false, code: storageCode(error), reasons: [] }
      }
      return { ok: true, item }
    },

    /** Storage failures reject rather than returning an empty list that would look like "no memory". */
    async list() {
      try {
        ensureReady()
        return repo.listActiveProfiles().flatMap((row) => {
          const r = rowToItem(row)
          return r.ok ? [r.item] : []
        })
      } catch (error) {
        throw error instanceof StorageError ? error : new StorageError(storageCode(error), { cause: error })
      }
    },

    async purge(id): Promise<PurgeResult> {
      if (typeof id !== "string" || id.length === 0) return { ok: false, code: "not_found" }
      try {
        ensureReady()
        return repo.purge(id, clock.now().toISOString()) === "purged" ? { ok: true } : { ok: false, code: "not_found" }
      } catch (error) {
        return { ok: false, code: storageCode(error) }
      }
    },
  }

  return { port, commands }
}
