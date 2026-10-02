import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadInstruments, TickerIndex } from "../../src/core/market/tickers"
import { type Clock, createMemoryService, type IdFactory, type MemoryServiceDeps } from "../../src/core/memory"
import { utf8Bytes } from "../../src/core/memory/schema"
import { loadRules } from "../../src/core/rules/load"

// Test composition root: temp database, fixed ids, a clock the tests can move. Never DATA_DIR.
let at = new Date("2026-09-30T03:00:00.000Z") // 10:00 in Vietnam
const clock: Clock = { now: () => at }
function counterIds(): IdFactory {
  let n = 0
  return { next: () => `0190a000-0000-7000-8000-${String(++n).padStart(12, "0")}` }
}
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`
const tickers = new TickerIndex(loadInstruments())
const rules = loadRules()

const opened: Database[] = []
afterEach(() => {
  at = new Date("2026-09-30T03:00:00.000Z")
  while (opened.length) {
    try {
      opened.pop()!.close()
    } catch {}
  }
})
function setup(deps: Partial<MemoryServiceDeps> = {}) {
  const db = new Database(":memory:")
  opened.push(db)
  return {
    db,
    ...createMemoryService(db, { clock, ids: counterIds(), tickers, rules: () => rules, salt: "test", ...deps }),
  }
}
// Migration is lazy, so a database nobody wrote to has no memory table yet: that counts as zero rows.
const count = (db: Database) =>
  db.query("SELECT 1 FROM sqlite_master WHERE name = 'memory'").get()
    ? db.query<{ n: number }, []>("SELECT count(*) AS n FROM memory").get()!.n
    : 0
const turn = (svc: ReturnType<typeof setup>, userText: string, sessionId = "s1") =>
  svc.port.beforeTurn({ sessionId, userText })
const allText = (c: { stableBlocks: string[]; projection: string | null }) =>
  [...c.stableBlocks, c.projection ?? ""].join("\n")

describe("remember (profile)", () => {
  test("stores an accepted profile as active with Vietnam asOf and version 1", async () => {
    at = new Date("2026-09-30T18:00:00.000Z") // already 1 October in Vietnam
    const { commands } = setup()
    const r = await commands.remember({ body: "  Tôi không sử dụng margin\r\n" })
    expect(r).toMatchObject({
      ok: true,
      item: {
        id: id(1),
        version: 1,
        kind: "profile",
        scope: "global",
        status: "active",
        asOf: "2026-10-01",
        body: "Tôi không sử dụng margin",
      },
    })
  })

  test("rejected content is never stored, even with confirmAmbiguous; reasons never echo the body", async () => {
    const { db, commands } = setup()
    for (const body of ["giá vốn 25.000 đ", "tôi đang giữ 1000 cp HPG", "key gsk_" + "A1b2C3d4E5f6G7h8I9j0"]) {
      const r = await commands.remember({ body }, { confirmAmbiguous: true })
      expect(r).toMatchObject({ ok: false, code: "content_rejected" })
      expect(JSON.stringify(r)).not.toContain(body)
    }
    expect(await commands.remember({ body: "ổn", title: "giá mục tiêu 45" })).toMatchObject({
      code: "content_rejected",
    })
    expect(count(db)).toBe(0)
  })

  test("ambiguous needs confirmation without touching the database; confirmed it is stored", async () => {
    const { db, commands } = setup()
    db.close()
    expect(await commands.remember({ body: "luôn đưa ra 3 kịch bản" })).toMatchObject({ code: "needs_confirmation" })
    const fresh = setup()
    expect(await fresh.commands.remember({ body: "không vượt 20% danh mục" })).toEqual({
      ok: false,
      code: "needs_confirmation",
      reasons: ["number_present"],
    })
    expect(count(fresh.db)).toBe(0)
    expect((await fresh.commands.remember({ body: "không vượt 20% danh mục" }, { confirmAmbiguous: true })).ok).toBe(
      true,
    )
    expect(count(fresh.db)).toBe(1)
  })

  test("invalid input, oversized and t1-unfit bodies are refused with their own codes", async () => {
    const { db, commands } = setup()
    expect(await commands.remember({ body: "   " })).toMatchObject({ code: "invalid_input" })
    expect(await commands.remember(undefined as never)).toMatchObject({ code: "invalid_input" })
    expect(await commands.remember({ body: "x", visibility: "public" as never })).toMatchObject({
      code: "invalid_input",
    })
    expect(await commands.remember({ body: "a".repeat(4097) })).toMatchObject({ code: "too_large" })
    const quotes = `Tránh từ "${`"`.repeat(996)}"`
    expect(await commands.remember({ body: quotes }, { confirmAmbiguous: true })).toMatchObject({ code: "t1_unfit" })
    expect(count(db)).toBe(0)
  })

  test("saying the same thing twice keeps one memory", async () => {
    const { db, commands } = setup()
    const a = await commands.remember({ body: "Tôi không sử dụng margin" })
    const b = await commands.remember({ body: "tôi KHÔNG sử dụng margin!" })
    expect(a.ok && b.ok && a.item.id === b.item.id).toBe(true)
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

describe("note (per instrument, with expiry)", () => {
  test("ties a note to the instrument scope with a default 30-day expiry", async () => {
    const { commands } = setup()
    expect(await commands.note({ code: "vcb", body: "Chờ báo cáo thường niên" })).toMatchObject({
      ok: true,
      item: { kind: "note", scope: "ticker:VCB", expiresAt: "2026-10-30" },
    })
    expect(
      await commands.note({ code: "VN30F1M", body: "Theo dõi ngày đáo hạn", expiresAt: "2026-10-15" }),
    ).toMatchObject({
      item: { scope: "future:VN30F1M", expiresAt: "2026-10-15" },
    })
  })

  test("unknown instrument, past or malformed dates are refused", async () => {
    const { commands } = setup()
    expect(await commands.note({ code: "XYZ", body: "x" })).toMatchObject({ code: "unknown_instrument" })
    expect(await commands.note({ code: "VCB", body: "x", expiresAt: "2026-09-29" })).toMatchObject({
      code: "invalid_date",
    })
    expect(await commands.note({ code: "VCB", body: "x", expiresAt: "30/10/2026" })).toMatchObject({
      code: "invalid_date",
    })
  })

  test("expiry is inclusive and uses the Vietnam date", async () => {
    const svc = setup()
    await svc.commands.note({ code: "VCB", body: "Chờ ĐHCĐ", expiresAt: "2026-10-01" })
    at = new Date("2026-10-01T16:59:00.000Z") // 23:59 on 1 October in Vietnam
    expect(allText(await turn(svc, "VCB thế nào"))).toContain("Chờ ĐHCĐ")
    at = new Date("2026-10-01T17:00:00.000Z") // 2 October in Vietnam
    expect(allText(await turn(svc, "VCB thế nào"))).not.toContain("Chờ ĐHCĐ")
  })
})

describe("beforeTurn: T1, T2, rules and entities", () => {
  async function seeded() {
    const svc = setup()
    await svc.commands.remember({ body: "Tôi không sử dụng margin" })
    await svc.commands.note({ code: "VCB", body: "Chờ kết quả ĐHCĐ" })
    await svc.commands.note({ code: "HPG", body: "Chờ giá thép phục hồi" }, { confirmAmbiguous: true })
    const lesson = await svc.system.propose({
      body: "Nêu thêm tỷ lệ LDR khi so sánh ngân hàng",
      scope: "sector:banking",
      origin: "feedback",
    })
    if (lesson.ok) await svc.commands.approve(lesson.item.id)
    return svc
  }

  test("asking about VCB loads its note, the banking rule and the banking lesson; HPG's note stays out", async () => {
    const svc = await seeded()
    const c = await turn(svc, "Phân tích VCB giúp tôi")
    expect(c.stableBlocks[0]).toContain("Tôi không sử dụng margin")
    expect(c.stableBlocks[0]).toContain(`<rule name="nguon-so-lieu">`)
    expect(c.stableBlocks[0]).toContain("phai-sinh") // agent-rule catalog
    expect(c.projection).toContain("Chờ kết quả ĐHCĐ")
    expect(c.projection).toContain(`<rule name="ngan-hang">`)
    expect(c.projection).toContain("LDR")
    expect(c.projection).not.toContain("thép")
    expect(c.used.rules).toEqual(["nguon-so-lieu", "ngan-hang"])
    expect(c.injection!.refs.every((r) => !("body" in r))).toBe(true)
  })

  test("a different bank in the same sector gets the sector lesson but not VCB's note", async () => {
    const svc = await seeded()
    const c = await turn(svc, "So sánh MBB với ngành")
    expect(c.projection).toContain("LDR")
    expect(c.projection).not.toContain("ĐHCĐ")
  })

  test("follow-up questions keep the instrument until it has gone unmentioned for entityTtlTurns turns", async () => {
    const svc = await seeded()
    await turn(svc, "Phân tích VCB")
    expect((await turn(svc, "so sánh tiếp với quý trước")).projection).toContain("ĐHCĐ")
    for (let i = 0; i < 4; i++) await turn(svc, "câu hỏi chung")
    expect((await turn(svc, "câu hỏi chung")).projection).toBeNull()
  })

  test("focus sets and clears the entities directly", async () => {
    const svc = await seeded()
    expect((await svc.commands.focus("s1", ["HPG", "nope"])).items.map((e) => e.code)).toEqual(["HPG"])
    expect((await turn(svc, "còn gì nữa")).projection).toContain("thép")
    await svc.commands.focus("s1", [])
    expect((await turn(svc, "còn gì nữa")).projection).toBeNull()
  })

  test("too many instruments: least recently mentioned are dropped with a warning", async () => {
    const svc = setup()
    await turn(svc, "VCB TCB MBB")
    const c = await turn(svc, "ACB BID CTG")
    expect(c.entities!.items.map((e) => e.code)).toEqual(["ACB", "BID", "CTG", "MBB", "TCB"])
    expect(c.warnings.map((w) => w.code)).toEqual(["entity_limit"])
  })

  test("the stable block is byte-identical across turns while data is unchanged", async () => {
    const svc = await seeded()
    const a = await turn(svc, "Phân tích VCB")
    const b = await turn(svc, "HPG thì sao")
    expect(b.stableBlocks).toEqual(a.stableBlocks)
    expect(b.projection).not.toEqual(a.projection)
  })

  test("@rule: loads a manual or agent rule for this turn", async () => {
    const svc = setup()
    expect((await turn(svc, "phân tích @rule:phai-sinh")).projection).toContain(`<rule name="phai-sinh">`)
    expect(svc.port.loadRule("phai-sinh")).toContain("VN30F1M")
    expect(svc.port.loadRule("nope")).toBeNull()
  })

  test("budget: stable first, the per-turn block gets what is left; overflow is reported", async () => {
    const svc = await seeded()
    const full = await turn(svc, "VCB")
    const stableBytes = utf8Bytes(full.stableBlocks[0]!)
    const tight = await turn(svc, "VCB", "s2")
    expect(tight.projection).not.toBeNull()
    const capped = await svc.port.beforeTurn({ sessionId: "s3", userText: "VCB" }, { maxBytes: stableBytes + 10 })
    expect(capped.projection).toBeNull()
    expect(capped.warnings.map((w) => w.code)).toContain("projection_overflow")
    const none = await svc.port.beforeTurn({ sessionId: "s4", userText: "VCB" }, { maxBytes: 5 })
    expect(none.stableBlocks).toEqual([])
    expect(none.warnings.map((w) => w.code)).toEqual(["t1_overflow", "projection_overflow"])
  })

  test("peek has no side effects; enabled:false never reads the database", async () => {
    const svc = await seeded()
    await svc.port.peek({ sessionId: "s1", userText: "VCB" })
    expect((await turn(svc, "câu hỏi chung")).projection).toBeNull() // peek did not add VCB
    const off = setup({ config: { enabled: false } })
    off.db.close()
    expect(await off.port.beforeTurn({ userText: "VCB" })).toMatchObject({
      stableBlocks: [],
      projection: null,
      warnings: [],
    })
  })

  test("database failure: rules still apply, memory is missing with a db_unavailable warning", async () => {
    const svc = await seeded()
    svc.db.close()
    const c = await turn(svc, "VCB")
    expect(c.stableBlocks[0]).toContain("nguon-so-lieu")
    expect(allText(c)).not.toContain("margin")
    expect(c.warnings.map((w) => w.code)).toEqual(["db_unavailable"])
  })

  test("a failure after reading is reported as selection_failed", async () => {
    const svc = await seeded()
    const broken = {
      get maxBytes(): number {
        throw new Error("broken budget")
      },
    }
    const c = await svc.port.beforeTurn({ userText: "VCB" }, broken)
    expect(c.stableBlocks).toEqual([])
    expect(c.warnings.map((w) => w.code)).toEqual(["selection_failed"])
  })

  test("1,000 memories: a turn stays fast", async () => {
    const svc = setup()
    for (let i = 0; i < 1000; i++)
      await svc.commands.remember({
        body:
          `Sở thích trình bày kiểu ${"abcdefghij"[i % 10]} mẫu ${"x".repeat(i % 7)}` +
          " ".repeat(0) +
          `-${i.toString(36)}`,
      })
    const started = performance.now()
    await turn(svc, "Phân tích VCB")
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe("restricted memory", () => {
  test("never in the stable block or search; only in the per-turn block of a turn that allows it by id", async () => {
    const svc = setup()
    const r = await svc.commands.remember({ body: "Tôi có khoản vay mua nhà", visibility: "restricted" })
    const rid = r.ok ? r.item.id : ""
    expect(allText(await turn(svc, "câu hỏi"))).not.toContain("khoản vay")
    expect(await svc.port.search("khoan vay")).toEqual([])
    const allowed = await svc.port.beforeTurn({ sessionId: "s1", userText: "câu hỏi", allowedRestrictedIds: [rid] })
    expect(allowed.projection).toContain("khoản vay")
    expect(allowed.injection!.refs).toEqual([{ type: "memory", id: rid, version: 1, ageDays: 0, restricted: true }])
    expect(allText(await turn(svc, "câu tiếp"))).not.toContain("khoản vay")
    expect((await svc.port.search("khoan vay", { allowedRestrictedIds: [rid] })).map((h) => h.id)).toEqual([rid])
  })
})

describe("lifecycle", () => {
  test("transitions follow the state machine; wrong states and unknown ids are refused", async () => {
    const { commands, system } = setup()
    const p = await system.propose({ body: "Luôn nêu rủi ro thanh khoản", origin: "feedback" })
    const pid = p.ok ? p.item.id : ""
    expect(await commands.disable(pid)).toEqual({ ok: false, code: "invalid_state" })
    expect(await commands.approve(pid)).toEqual({ ok: true })
    expect(await commands.approve(pid)).toEqual({ ok: false, code: "invalid_state" })
    expect(await commands.disable(pid)).toEqual({ ok: true })
    expect(await commands.enable(pid)).toEqual({ ok: true })
    expect(await commands.archive(pid)).toEqual({ ok: true })
    expect(await commands.enable(pid)).toEqual({ ok: true })
    expect(await commands.approve("missing")).toEqual({ ok: false, code: "not_found" })
  })

  test("proposed lessons are invisible until approved", async () => {
    const svc = setup()
    const p = await svc.system.propose({ body: "Luôn nêu rủi ro thanh khoản", origin: "validator" })
    expect(p).toMatchObject({ ok: true, item: { status: "proposed", kind: "lesson", createdBy: "system" } })
    expect(allText(await turn(svc, "x"))).not.toContain("thanh khoản")
    expect(await svc.port.search("thanh khoan")).toEqual([])
    await svc.commands.approve(p.ok ? p.item.id : "")
    expect(allText(await turn(svc, "x", "new-session"))).toContain("thanh khoản")
  })

  test("reject erases the content but keeps the fingerprint, so it is not proposed again", async () => {
    const { commands, system } = setup()
    const p = await system.propose({ body: "Luôn nêu rủi ro thanh khoản", origin: "feedback" })
    await commands.reject(p.ok ? p.item.id : "")
    const [tomb] = (await commands.exportAll()).filter((i) => i.status === "rejected")
    expect(tomb).toMatchObject({ body: null, title: null })
    expect(await system.propose({ body: "luôn nêu RỦI RO thanh khoản.", origin: "feedback" })).toMatchObject({
      ok: false,
      code: "duplicate",
    })
  })

  test("purge erases every version, leaves search and the prompt, and is final", async () => {
    const svc = setup()
    const a = await svc.commands.remember({ body: "Tôi thích ngân hàng" })
    const aid = a.ok ? a.item.id : ""
    await svc.commands.edit(aid, { body: "Tôi thích ngân hàng quốc doanh" })
    expect(await svc.commands.purge(aid)).toEqual({ ok: true })
    expect(svc.db.query("SELECT body FROM memory_version WHERE memory_id = ?").all(aid)).toEqual([
      { body: null },
      { body: null },
    ])
    expect(await svc.port.search("ngan hang")).toEqual([])
    expect(allText(await turn(svc, "x"))).not.toContain("ngân hàng")
    expect(await svc.commands.purge(aid)).toEqual({ ok: false, code: "invalid_state" })
    expect((await svc.commands.list()).map((i) => i.id)).not.toContain(aid)
    expect((await svc.commands.exportAll()).find((i) => i.id === aid)).toMatchObject({ status: "purged", body: null })
  })

  test("edit adds a version; the prompt shows only the current one", async () => {
    const svc = setup()
    const a = await svc.commands.remember({ body: "Tôi thích ngân hàng" })
    const e = await svc.commands.edit(a.ok ? a.item.id : "", { body: "Tôi thích thép" })
    expect(e).toMatchObject({ ok: true, item: { version: 2, body: "Tôi thích thép" } })
    const text = allText(await turn(svc, "x"))
    expect(text).toContain("thép")
    expect(text).not.toContain("ngân hàng")
    expect(await svc.commands.edit("missing", { body: "x" })).toMatchObject({ code: "not_found" })
    expect(await svc.commands.edit(a.ok ? a.item.id : "", { body: "giá vốn 25.000 đ" })).toMatchObject({
      code: "content_rejected",
    })
  })
})

describe("system proposals", () => {
  test("market data, rule copies and the daily cap are refused", async () => {
    const { system } = setup({ config: { maxProposalsPerDay: 2 } })
    expect(await system.propose({ body: "HPG sẽ tăng 20% quý 4", origin: "feedback" })).toMatchObject({
      code: "content_rejected",
    })
    const copy =
      "Khi phân tích ngân hàng, luôn xem NIM, CASA, tỷ lệ nợ xấu (NPL), tỷ lệ bao phủ nợ xấu và hệ số an toàn vốn (CAR)."
    expect(await system.propose({ body: copy, origin: "feedback" })).toMatchObject({ code: "covered_by_rule" })
    expect((await system.propose({ body: "Bài học một", origin: "feedback" })).ok).toBe(true)
    expect((await system.propose({ body: "Bài học hai", origin: "feedback" })).ok).toBe(true)
    expect(await system.propose({ body: "Bài học ba", origin: "feedback" })).toMatchObject({ code: "daily_cap" })
    at = new Date("2026-10-01T04:00:00.000Z")
    expect((await system.propose({ body: "Bài học ba", origin: "feedback" })).ok).toBe(true)
  })

  test("ambiguous text may be proposed: the user reviews it anyway", async () => {
    const { system } = setup()
    expect((await system.propose({ body: "Luôn đưa 3 kịch bản", origin: "feedback" })).ok).toBe(true)
  })
})

describe("feedback, usage and auto-disable", () => {
  test("a harmful rating with a correction proposes a lesson tied to that turn", async () => {
    const svc = setup()
    await svc.commands.remember({ body: "Tôi không sử dụng margin" })
    await turn(svc, "Phân tích VCB")
    await svc.port.afterTurn({ sessionId: "s1" })
    const f = await svc.commands.feedback({
      sessionId: "s1",
      verdict: "harmful",
      correction: "Báo cáo ngân hàng phải có tỷ lệ bao phủ nợ xấu",
    })
    expect(f.rated).toEqual([id(1)])
    expect(f.proposal).toMatchObject({
      status: "proposed",
      origin: "feedback",
      sourceEvents: [{ sessionId: "s1", turn: 1 }],
    })
    expect(svc.db.query("SELECT verdict FROM memory_usage ORDER BY rowid").all()).toEqual([
      { verdict: "applied" },
      { verdict: "harmful" },
    ])
  })

  test("afterTurn records an application once", async () => {
    const svc = setup()
    await svc.commands.remember({ body: "Tôi không sử dụng margin" })
    await turn(svc, "x")
    await svc.port.afterTurn({ sessionId: "s1" })
    await svc.port.afterTurn({ sessionId: "s1" })
    expect(svc.db.query("SELECT count(*) AS n FROM memory_usage").get()).toEqual({ n: 1 })
  })

  test("a lesson rated harmful in 2 of its last 5 applications is switched off", async () => {
    const svc = setup()
    const p = await svc.system.propose({ body: "Luôn kết luận bằng một câu khuyến nghị", origin: "feedback" })
    const lid = p.ok ? p.item.id : ""
    await svc.commands.approve(lid)
    await turn(svc, "a")
    expect((await svc.commands.feedback({ sessionId: "s1", verdict: "harmful" })).disabled).toEqual([])
    await turn(svc, "b")
    await svc.commands.feedback({ sessionId: "s1", verdict: "helpful" })
    await turn(svc, "c")
    expect((await svc.commands.feedback({ sessionId: "s1", verdict: "harmful" })).disabled).toEqual([lid])
    expect(allText(await turn(svc, "d"))).not.toContain("khuyến nghị")
    expect((await svc.commands.list({ status: "disabled" })).map((i) => i.id)).toEqual([lid])
  })

  test("profiles are never auto-disabled; lessons that keep helping are promotion candidates", async () => {
    const svc = setup()
    await svc.commands.remember({ body: "Tôi không sử dụng margin" })
    const p = await svc.system.propose({ body: "Luôn tách phần dữ kiện và nhận định", origin: "feedback" })
    await svc.commands.approve(p.ok ? p.item.id : "")
    for (let i = 0; i < 5; i++) {
      await turn(svc, `q${i}`)
      await svc.commands.feedback({ sessionId: "s1", verdict: i < 3 ? "helpful" : "helpful" })
    }
    expect((await svc.commands.promotionCandidates()).map((i) => i.body)).toEqual([
      "Luôn tách phần dữ kiện và nhận định",
    ])
    for (let i = 0; i < 3; i++) {
      await turn(svc, `h${i}`)
      await svc.commands.feedback({ sessionId: "s1", verdict: "harmful" })
    }
    expect((await svc.commands.list({ kind: "profile" })).map((i) => i.status)).toEqual(["active"])
  })
})

describe("T3 selector", () => {
  test("off by default; when on, only allowlisted ids are taken, at most five", async () => {
    const calls: string[] = []
    const svc = setup({
      config: { t3: "llm" },
      t3: async ({ manifest }) => {
        calls.push(manifest)
        return [id(1), "not-a-candidate", id(1)]
      },
    })
    const long = "Chờ giá thép phục hồi; theo dõi biên lợi nhuận gộp, tồn kho và sản lượng tiêu thụ trong các quý tới"
    await svc.commands.note({ code: "HPG", body: long }, { confirmAmbiguous: true })
    await svc.commands.remember({ body: "Khoản vay riêng", visibility: "restricted" })
    const c = await turn(svc, "câu hỏi chung")
    expect(c.projection).toContain("thép")
    expect(calls[0]).toContain(id(1))
    expect(calls[0]).not.toContain(long) // only a short label, never the whole body
    expect(calls[0]).not.toContain("Khoản vay") // restricted items never enter the manifest
    expect((await setup().port.beforeTurn({ userText: "x" })).warnings).toEqual([])
  })

  test("a slow or failing selector is skipped with a warning; peek never calls it", async () => {
    let called = 0
    const slow = setup({
      config: { t3: "llm", t3TimeoutMs: 20 },
      t3: () => {
        called++
        return new Promise((r) => setTimeout(() => r([]), 500))
      },
    })
    await slow.commands.remember({ body: "x", visibility: "model" })
    await slow.commands.note({ code: "HPG", body: "ghi chú" })
    expect((await turn(slow, "câu hỏi")).warnings.map((w) => w.code)).toEqual(["t3_timeout"])
    await slow.port.peek({ sessionId: "s1" })
    expect(called).toBe(1)
    const failing = setup({ config: { t3: "llm" }, t3: async () => Promise.reject(new Error("model down")) })
    await failing.commands.note({ code: "HPG", body: "ghi chú" })
    expect((await turn(failing, "câu hỏi")).warnings.map((w) => w.code)).toEqual(["t3_failed"])
  })
})

describe("search", () => {
  test("unaccented queries match; only active, valid, model-visible items; scope filter", async () => {
    const svc = setup()
    await svc.commands.remember({ body: "Báo cáo ngân hàng cần tỷ lệ bao phủ nợ xấu" })
    await svc.commands.note({ code: "VCB", body: "Ngân hàng chờ ĐHCĐ" })
    const p = await svc.system.propose({ body: "Ngân hàng: nêu thêm LDR", origin: "feedback" })
    expect((await svc.port.search("ngan hang")).map((h) => h.scope).sort()).toEqual(["global", "ticker:VCB"])
    expect((await svc.port.search("dhcd", { scope: "ticker:VCB" })).map((h) => h.scope)).toEqual(["ticker:VCB"])
    expect(await svc.port.search("LDR")).toEqual([]) // still proposed
    expect(await svc.port.search("   ")).toEqual([])
    expect(p.ok).toBe(true)
  })
})

describe("capabilities", () => {
  test("read port, user commands and system proposals are separate objects; writes take no actor", () => {
    const { port, commands, system } = setup()
    expect(Object.keys(port).sort()).toEqual(["afterTurn", "beforeTurn", "endSession", "loadRule", "peek", "search"])
    for (const name of ["remember", "purge", "approve", "propose"]) expect(name in port).toBe(false)
    expect(Object.keys(system)).toEqual(["propose"])
    expect("approve" in system).toBe(false)
    expect(Object.keys(commands).sort()).toEqual([
      "approve",
      "archive",
      "disable",
      "edit",
      "enable",
      "exportAll",
      "feedback",
      "focus",
      "list",
      "note",
      "promotionCandidates",
      "purge",
      "reject",
      "remember",
    ])
  })
})

describe("persistence through the service", () => {
  test("a file database reopened by a new service keeps memory, versions and purge state", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opentrading-memory-svc-"))
    const file = path.join(dir, "memory.db")
    try {
      const first = new Database(file)
      const s1 = createMemoryService(first, { clock, ids: counterIds(), salt: "s" })
      const a = await s1.commands.remember({ body: "Tôi không sử dụng margin" })
      await s1.commands.remember({ body: "Báo cáo cho tôi cần có kịch bản rủi ro" })
      await s1.commands.purge(a.ok ? a.item.id : "")
      first.close()
      const again = new Database(file)
      try {
        const c = await createMemoryService(again, { clock, salt: "s" }).port.beforeTurn({ userText: "x" })
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
