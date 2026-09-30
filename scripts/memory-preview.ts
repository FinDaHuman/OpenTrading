/**
 * Technical demo for the memory core. Never opens the real DATA_DIR and never calls a model.
 * Usage: bun scripts/memory-preview.ts [g1|g2]
 * Later gates add their own scenario; earlier scenarios keep running unchanged.
 */
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { classifyContent } from "../src/core/memory/content"
import { parseMemoryConfig } from "../src/core/memory/config"
import type { Clock } from "../src/core/memory/deps"
import { MigrationBusyError, migrateMemory } from "../src/core/memory/migrate"
// Until the G4 factory exists, the storage demo drives the internal repository directly on a temp database.
import { MemoryRepo, rowToItem } from "../src/core/memory/repo"
import { type MemoryItemV0, prepareBody } from "../src/core/memory/schema"

const SAMPLES = [
  "  Tôi không sử dụng margin\r\n",
  "Báo cáo cho tôi cần có kịch bản rủi ro",
  "luôn đưa ra 3 kịch bản",
  "không vượt 20% danh mục cho một mã",
  "không mua cổ phiếu có P/E trên 20",
  "giá vốn 25.000 đ",
  "cắt lỗ 10k",
  "HPG sẽ tăng 20% trong quý 4",
  "tôi đang giữ 1000 cp HPG",
  "key " + ["gsk", "DEMOONLYnotARealKey1234"].join("_"),
  "a\u0000b",
  "   ",
  "ệ".repeat(1400),
]

function g1() {
  const config = parseMemoryConfig({})
  console.log(`# G1 — contract: chuẩn hoá, giới hạn byte, phân loại nội dung`)
  console.log(`config: ${JSON.stringify(config)}\n`)
  for (const raw of SAMPLES) {
    const shown = JSON.stringify(raw.length > 40 ? raw.slice(0, 37) + "…" : raw)
    const prepared = prepareBody(raw, config.maxItemBytes)
    if (!prepared.ok) {
      console.log(`${shown}\n  → ${prepared.code} ${JSON.stringify(prepared.reasons)}`)
      continue
    }
    const verdict = classifyContent(prepared.body)
    const reasons = verdict.verdict === "accepted" ? "" : ` ${JSON.stringify(verdict.reasons)}`
    console.log(`${shown}\n  → ${verdict.verdict}${reasons}`)
  }
}

const fixedClock: Clock = { now: () => new Date("2026-09-30T01:00:00.000Z") }

const seed = (id: string, body: string): MemoryItemV0 => ({
  schemaVersion: 1,
  id,
  kind: "profile",
  scope: "global",
  body,
  status: "active",
  visibility: "model",
  createdBy: "user",
  origin: "remember_command",
  createdAt: "2026-09-30T01:00:00.000Z",
  updatedAt: "2026-09-30T01:00:00.000Z",
})

/** Fixture ids stand in for UUIDv7 so the output is identical on every run. */
const A = "0190a000-0000-7000-8000-00000000000a"
const Bid = "0190a000-0000-7000-8000-00000000000b"

function g2() {
  console.log("# G2 — storage: migration, reopen, purge, tranh chấp khoá")
  const dir = mkdtempSync(path.join(os.tmpdir(), "opentrading-preview-"))
  const file = path.join(dir, "memory.db")
  const open: Database[] = []
  const connect = () => {
    const db = new Database(file)
    open.push(db)
    return db
  }
  try {
    const first = connect()
    first.exec("PRAGMA journal_mode = WAL")
    console.log("DB tạm: <tmp>/opentrading-preview-*/memory.db (xoá khi kết thúc)")
    console.log(`migrate lần 1 → áp dụng ${JSON.stringify(migrateMemory(first, fixedClock))}`)
    console.log(`migrate lần 2 → áp dụng ${JSON.stringify(migrateMemory(first, fixedClock))} (idempotent)`)
    console.log(`PRAGMA user_version = ${JSON.stringify(first.query("PRAGMA user_version").get())} (không đụng tới)`)

    const repo = new MemoryRepo(first)
    repo.insert(seed(Bid, "Báo cáo cho tôi cần có kịch bản rủi ro"))
    repo.insert(seed(A, "Tôi không sử dụng margin"))
    first.close()
    open.pop()
    console.log("\nseed A, B rồi đóng DB")

    const again = connect()
    const reopened = new MemoryRepo(again)
    const list = () => reopened.listActiveProfiles().map((r) => ({ id: r.id.slice(-1), body: r.body }))
    console.log(`mở lại → active: ${JSON.stringify(list())}`)
    console.log(`purge A → ${reopened.purge(A, "2026-09-30T02:00:00.000Z")}`)
    const purged = reopened.get(A)!
    console.log(`row A: status=${purged.status}, body=${JSON.stringify(purged.body)}, còn là item V0? ${rowToItem(purged).ok}`)
    console.log(`active: ${JSON.stringify(list())}`)
    console.log(`purge A lần nữa → ${reopened.purge(A, "2026-09-30T02:00:00.000Z")}`)

    console.log("\ntranh chấp khoá: connection khác giữ BEGIN IMMEDIATE")
    const holder = connect()
    const other = connect()
    holder.run("BEGIN IMMEDIATE")
    try {
      migrateMemory(other, fixedClock, { busyTimeoutMs: 100 })
      console.log("  migrate → (không mong đợi) thành công")
    } catch (e) {
      console.log(`  migrate → ${e instanceof MigrationBusyError ? e.code : String(e)} sau ~100 ms`)
    }
    holder.run("COMMIT")
    console.log(`  nhả khoá → migrate ${JSON.stringify(migrateMemory(other, fixedClock))}, số dòng version: ${
      JSON.stringify(other.query("SELECT count(*) AS n FROM memory_schema_migrations").get())}`)
    console.log("\nGiới hạn: purge ở mức ứng dụng; byte cũ có thể còn trong file DB/WAL (secure_delete, checkpoint ở V3).")
  } finally {
    for (const db of open) db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

const scenarios: Record<string, () => void> = { g1, g2 }
const name = (process.argv[2] ?? "g1").toLowerCase()
const run = scenarios[name]
if (!run) {
  console.error(`Không có kịch bản "${name}". Có: ${Object.keys(scenarios).join(", ")}`)
  process.exit(1)
}
run()
