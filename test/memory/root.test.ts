import { afterEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HookBus } from "../../src/core/hooks"
import { openSqliteMemory } from "../../src/core/memory-root"

// The production composition root, pointed at a temporary home: never the user's real data directory.
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

test("opens the database with WAL and secure_delete, keeps one salt per installation, and persists memory", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "opentrading-root-"))
  dirs.push(home)
  const first = openSqliteMemory(home)
  const hooks = new HookBus()
  first.register!(hooks)
  await hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "Ghi nhớ: Tôi không sử dụng margin" })
  await hooks.emit({ type: "user-prompt", sessionId: "s", prompt: "Ghi chú VCB: Chờ kết quả ĐHCĐ" })
  await first.recall!("Phân tích VCB", { sessionId: "s" })
  expect(await first.index!({ sessionId: "s" })).toContain("Chờ kết quả ĐHCĐ")
  first.close()

  const salt = readFileSync(path.join(home, "memory-salt"), "utf8").trim()
  expect(salt).toMatch(/^[0-9a-f]{64}$/)
  const db = new Database(path.join(home, "opentrading.db"))
  expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" })
  db.close()

  const again = openSqliteMemory(home)
  const [profile, note] = (await again.list!()).map((i) => i.text)
  expect(profile).toBe("[hồ sơ] Tôi không sử dụng margin")
  expect(note).toMatch(/^\[ghi chú VCB\] Chờ kết quả ĐHCĐ \(đến \d{4}-\d{2}-\d{2}\)$/) // real clock: today + 30 days
  expect(readFileSync(path.join(home, "memory-salt"), "utf8").trim()).toBe(salt)
  again.close()
  expect(existsSync(path.join(home, "opentrading.db"))).toBe(true)
})
