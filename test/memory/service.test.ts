import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { type Clock, createMemoryService, type IdFactory } from "../../src/core/memory"
import { BLOCK_CLOSE } from "../../src/core/memory/render"
import { utf8Bytes } from "../../src/core/memory/schema"

// Test composition root: a temp database plus fixed clock and ids. Never DATA_DIR.
const clock: Clock = { now: () => new Date("2026-09-30T01:00:00.000Z") }
function counterIds(): IdFactory {
  let n = 0
  return { next: () => `0190a000-0000-7000-8000-${String(++n).padStart(12, "0")}` }
}
const opened: Database[] = []
afterEach(() => {
  while (opened.length) {
    const db = opened.pop()!
    try {
      db.close()
    } catch {}
  }
})
function setup(config: unknown = {}) {
  const db = new Database(":memory:")
  opened.push(db)
  return { db, ...createMemoryService(db, { config, clock, ids: counterIds() }) }
}
const count = (db: Database) => db.query<{ n: number }, []>("SELECT count(*) AS n FROM memory").get()!.n
const ctx = { userText: "Phân tích VCB" }

describe("remember", () => {
  test("stores an accepted profile as active, user-created, via remember_command", async () => {
    const { commands } = setup()
    const r = await commands.remember({ body: "  Tôi không sử dụng margin\r\n" })
    expect(r).toEqual({
      ok: true,
      item: {
        schemaVersion: 1,
        id: "0190a000-0000-7000-8000-000000000001",
        kind: "profile",
        scope: "global",
        body: "Tôi không sử dụng margin",
        status: "active",
        visibility: "model",
        createdBy: "user",
        origin: "remember_command",
        createdAt: "2026-09-30T01:00:00.000Z",
        updatedAt: "2026-09-30T01:00:00.000Z",
      },
    })
    expect((await commands.list()).map((i) => i.body)).toEqual(["Tôi không sử dụng margin"])
  })

  test("rejected content is never stored, even with confirmAmbiguous", async () => {
    const { db, commands } = setup()
    await commands.remember({ body: "Tôi không sử dụng margin" })
    for (const body of ["giá vốn 25.000 đ", "tôi đang giữ 1000 cp HPG", "key gsk_" + "A1b2C3d4E5f6G7h8I9j0"]) {
      const r = await commands.remember({ body }, { confirmAmbiguous: true })
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.code).toBe("content_rejected")
      expect(JSON.stringify(r)).not.toContain(body)
    }
    expect(count(db)).toBe(1)
  })

  test("ambiguous content needs confirmation and leaves the database unchanged until confirmed", async () => {
    const { db, commands } = setup()
    await commands.remember({ body: "Tôi không sử dụng margin" })
    const body = "không vượt 20% danh mục cho một mã"
    expect(await commands.remember({ body })).toEqual({
      ok: false,
      code: "needs_confirmation",
      reasons: ["number_present"],
    })
    expect(await commands.remember({ body }, { confirmAmbiguous: false })).toMatchObject({ code: "needs_confirmation" })
    expect(count(db)).toBe(1)
    const confirmed = await commands.remember({ body }, { confirmAmbiguous: true })
    expect(confirmed.ok && confirmed.item.body).toBe(body)
    expect(count(db)).toBe(2)
  })

  test("ambiguous content without confirmation never touches the database", async () => {
    const { db, commands } = setup()
    db.close() // any database access would now fail
    expect(await commands.remember({ body: "luôn đưa ra 3 kịch bản" })).toMatchObject({ code: "needs_confirmation" })
  })

  test("invalid input and oversized bodies are refused with their own codes", async () => {
    const { commands } = setup()
    expect(await commands.remember({ body: "   " })).toEqual({ ok: false, code: "invalid_input", reasons: ["empty"] })
    expect(await commands.remember({ body: 42 } as never)).toMatchObject({ code: "invalid_input" })
    expect(await commands.remember(undefined as never)).toMatchObject({ code: "invalid_input" })
    expect(await commands.remember({ body: "a\u0000b" })).toMatchObject({ code: "invalid_input" })
    expect(await commands.remember({ body: "a".repeat(4097) })).toMatchObject({ code: "too_large" })
  })

  test("an item that can never fit T1 after escaping is refused as t1_unfit", async () => {
    const { db, commands } = setup()
    await commands.remember({ body: "Tôi không sử dụng margin" })
    // 1,000 quote marks: 1,000 bytes stored, ~6,000 once escaped; confirmed only so the fit check is reached
    const r = await commands.remember({ body: `Tránh các từ "${`"`.repeat(996)}"` }, { confirmAmbiguous: true })
    expect(r).toEqual({ ok: false, code: "t1_unfit", reasons: ["t1_max_bytes"] })
    expect(count(db)).toBe(1)
  })

  test("a storage failure is reported, never as success", async () => {
    const { db, commands } = setup()
    db.close()
    expect(await commands.remember({ body: "Tôi không sử dụng margin" })).toEqual({
      ok: false,
      code: "storage_failed",
      reasons: [],
    })
    expect(await commands.purge("x")).toEqual({ ok: false, code: "storage_failed" })
    expect(commands.list()).rejects.toMatchObject({ code: "storage_failed" })
  })
})

describe("purge", () => {
  test("removes the item from list and from the next turn; repeating reports not_found", async () => {
    const { port, commands } = setup()
    const a = await commands.remember({ body: "Tôi không sử dụng margin" })
    await commands.remember({ body: "Báo cáo cho tôi cần có kịch bản rủi ro" })
    const id = a.ok ? a.item.id : ""
    expect((await port.beforeTurn(ctx)).used.memories).toContain(id)

    expect(await commands.purge(id)).toEqual({ ok: true })
    expect((await commands.list()).map((i) => i.id)).not.toContain(id)
    const next = await port.beforeTurn(ctx)
    expect(next.used.memories).not.toContain(id)
    expect(next.stableBlocks.join("")).not.toContain("margin")

    expect(await commands.purge(id)).toEqual({ ok: false, code: "not_found" })
    expect(await commands.purge("missing")).toEqual({ ok: false, code: "not_found" })
    expect(await commands.purge("")).toEqual({ ok: false, code: "not_found" })
  })
})

describe("beforeTurn", () => {
  test("renders active profiles into one stable block with the V0 contract shape", async () => {
    const { port, commands } = setup()
    await commands.remember({ body: "Tôi không sử dụng margin" })
    await commands.remember({ body: "Báo cáo cho tôi cần có kịch bản rủi ro" })
    const c = await port.beforeTurn(ctx)
    expect(c.stableBlocks).toHaveLength(1)
    expect(c.stableBlocks[0]).toContain("<content>Tôi không sử dụng margin</content>")
    expect(c.injection).toBeNull()
    expect(c.entities).toBeNull()
    expect(c.used).toEqual({
      memories: ["0190a000-0000-7000-8000-000000000001", "0190a000-0000-7000-8000-000000000002"],
      rules: [],
    })
    expect(c.warnings).toEqual([])
  })

  test("no memory means no block and no warning", async () => {
    const { port } = setup()
    expect(await port.beforeTurn(ctx)).toEqual({
      stableBlocks: [],
      injection: null,
      entities: null,
      used: { memories: [], rules: [] },
      warnings: [],
    })
  })

  test("output does not depend on userText in V0", async () => {
    const { port, commands } = setup()
    await commands.remember({ body: "Tôi không sử dụng margin" })
    expect(await port.beforeTurn({ userText: "Phân tích HPG" })).toEqual(await port.beforeTurn({ userText: "" }))
  })

  test("the budget lowers the cap; overflow keeps items whole and warns", async () => {
    const { port, commands } = setup()
    for (let i = 0; i < 3; i++) await commands.remember({ body: `Sở thích trình bày thứ ${"ba".repeat(i + 1)}` })
    const full = await port.beforeTurn(ctx)
    expect(full.used.memories).toHaveLength(3)
    const limit = utf8Bytes(full.stableBlocks[0]!) - 1
    const tight = await port.beforeTurn(ctx, { maxBytes: limit })
    expect(tight.used.memories).toHaveLength(2)
    expect(utf8Bytes(tight.stableBlocks[0]!)).toBeLessThanOrEqual(limit)
    expect(tight.stableBlocks[0]!.endsWith(BLOCK_CLOSE)).toBe(true)
    expect(tight.warnings.map((w) => w.code)).toEqual(["t1_overflow"])

    const none = await port.beforeTurn(ctx, { maxBytes: 5 })
    expect(none.stableBlocks).toEqual([])
    expect(none.used.memories).toEqual([])
    expect(none.warnings.map((w) => w.code)).toEqual(["t1_overflow"])
  })

  test("the config cap applies even when the budget is larger", async () => {
    const { port, commands } = setup({ t1MaxBytes: 300 }) // two short items render to ~350 bytes
    await commands.remember({ body: "Tôi không sử dụng margin" })
    await commands.remember({ body: "Báo cáo cho tôi cần có kịch bản rủi ro" })
    const c = await port.beforeTurn(ctx, { maxBytes: 99_999 })
    expect(c.used.memories).toHaveLength(1)
    expect(utf8Bytes(c.stableBlocks[0]!)).toBeLessThanOrEqual(300)
    expect(c.warnings.map((w) => w.code)).toEqual(["t1_overflow"])
  })

  test("database failure: empty result with db_unavailable, never a throw", async () => {
    const { db, port, commands } = setup()
    await commands.remember({ body: "Tôi không sử dụng margin" })
    db.close()
    const c = await port.beforeTurn(ctx)
    expect(c.stableBlocks).toEqual([])
    expect(c.used.memories).toEqual([])
    expect(c.warnings.map((w) => w.code)).toEqual(["db_unavailable"])
  })

  test("a failure after reading is reported as selection_failed", async () => {
    const { port, commands } = setup()
    await commands.remember({ body: "Tôi không sử dụng margin" })
    const broken = {
      get maxBytes(): number {
        throw new Error("broken budget from the caller")
      },
    }
    const c = await port.beforeTurn(ctx, broken)
    expect(c.stableBlocks).toEqual([])
    expect(c.warnings.map((w) => w.code)).toEqual(["selection_failed"])
  })

  test("rows that are no longer valid V0 items are skipped with invalid_record, not silently", async () => {
    const { db, port, commands } = setup()
    await commands.remember({ body: "Tôi không sử dụng margin" })
    db.run(`INSERT INTO memory VALUES ('zz', 1, 'profile', 'global', 'x', 'active', 'model', 'user',
      'remember_command', 'not-a-date', 'not-a-date')`)
    const c = await port.beforeTurn(ctx)
    expect(c.used.memories).toEqual(["0190a000-0000-7000-8000-000000000001"])
    expect(c.warnings.map((w) => w.code)).toEqual(["invalid_record"])
    expect(c.warnings[0]!.message).not.toContain("x")
  })

  test("enabled: false never reads the database and returns empty without a warning", async () => {
    const { db, port } = setup({ enabled: false })
    db.close()
    expect(await port.beforeTurn(ctx)).toEqual({
      stableBlocks: [],
      injection: null,
      entities: null,
      used: { memories: [], rules: [] },
      warnings: [],
    })
  })
})

describe("capabilities", () => {
  test("the read port exposes only beforeTurn; writes live on a separate object", () => {
    const { port, commands } = setup()
    expect(Object.keys(port)).toEqual(["beforeTurn"])
    for (const name of ["remember", "purge", "list"]) expect(name in port).toBe(false)
    expect(Object.keys(commands).sort()).toEqual(["list", "purge", "remember"])
    expect(port).not.toBe(commands as never)
  })

  test("write methods take no actor: holding the object is the permission", () => {
    const { commands } = setup()
    expect(commands.remember.length).toBeLessThanOrEqual(2) // (input, opts)
    expect(commands.purge.length).toBe(1)
  })
})

describe("persistence through the service", () => {
  test("a file database reopened by a new service keeps memory and purge state", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opentrading-memory-svc-"))
    const file = path.join(dir, "memory.db")
    try {
      const first = new Database(file)
      const s1 = createMemoryService(first, { clock, ids: counterIds() })
      const a = await s1.commands.remember({ body: "Tôi không sử dụng margin" })
      await s1.commands.remember({ body: "Báo cáo cho tôi cần có kịch bản rủi ro" })
      await s1.commands.purge(a.ok ? a.item.id : "")
      first.close()

      const again = new Database(file)
      try {
        const s2 = createMemoryService(again, { clock })
        const c = await s2.port.beforeTurn(ctx)
        expect(c.stableBlocks[0]).toContain("kịch bản rủi ro")
        expect(c.stableBlocks[0]).not.toContain("margin")
      } finally {
        again.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
