import { describe, expect, test } from "bun:test"
import { MemoryConfig, parseMemoryConfig } from "../../src/core/memory/config"
import { addDays, calendarDate, daysBetween, uuidV7Ids } from "../../src/core/memory/deps"
import { foldVietnamese, MemoryItem, normalizeBody, prepareBody, utf8Bytes } from "../../src/core/memory/schema"

const valid = {
  schemaVersion: 1,
  id: "0190a000-0000-7000-8000-000000000001",
  version: 1,
  kind: "profile",
  scope: "global",
  title: null,
  body: "Tôi không sử dụng margin",
  status: "active",
  visibility: "model",
  createdBy: "user",
  origin: "remember_command",
  asOf: "2026-09-30",
  expiresAt: null,
  sourceEvents: [],
  createdAt: "2026-09-30T01:02:03.000Z",
  updatedAt: "2026-09-30T01:02:03.000Z",
}

describe("normalizeBody / prepareBody", () => {
  test("CRLF and lone CR become LF, then trim; decomposed Vietnamese becomes NFC", () => {
    expect(normalizeBody("  a\r\nb\rc  ")).toBe("a\nb\nc")
    expect(normalizeBody("Kết luận".normalize("NFD"))).toBe("Kết luận")
  })

  test("keeps TAB and LF but rejects other control characters, non-strings and empty bodies", () => {
    expect(prepareBody("a\tb\nc", 4096).ok).toBe(true)
    for (const bad of ["a\u0000b", "a\u0007b", "a\u001Bb", "a\u007Fb"])
      expect(prepareBody(bad, 4096)).toEqual({ ok: false, code: "invalid_input", reasons: ["control_char"] })
    expect(prepareBody(42, 4096)).toEqual({ ok: false, code: "invalid_input", reasons: ["not_string"] })
    expect(prepareBody(" \r\n\t ", 4096)).toEqual({ ok: false, code: "invalid_input", reasons: ["empty"] })
  })

  test("4096 UTF-8 bytes of Vietnamese pass, 4097 fail; measured after NFC", () => {
    const ok = "ệ".repeat(1365) + "a"
    expect(utf8Bytes(ok)).toBe(4096)
    expect(prepareBody(ok, 4096).ok).toBe(true)
    expect(prepareBody(ok + "a", 4096)).toEqual({ ok: false, code: "too_large", reasons: ["max_item_bytes"] })
    const decomposed = ok.normalize("NFD")
    expect(utf8Bytes(decomposed)).toBeGreaterThan(4096)
    expect(prepareBody(decomposed, 4096)).toEqual({ ok: true, body: ok })
    expect(prepareBody("a".repeat(4097), 10_000).ok).toBe(false) // hard ceiling
  })
})

describe("MemoryItem", () => {
  test("accepts every kind with its rules", () => {
    expect(MemoryItem.safeParse(valid).success).toBe(true)
    const lesson = { ...valid, kind: "lesson", createdBy: "system", origin: "feedback", status: "proposed" }
    expect(MemoryItem.safeParse(lesson).success).toBe(true)
    const note = { ...valid, kind: "note", scope: "ticker:VCB", origin: "note_command", expiresAt: "2026-10-30" }
    expect(MemoryItem.safeParse(note).success).toBe(true)
  })

  test.each([
    ["system-created profile", { createdBy: "system" }],
    ["user-created lesson", { kind: "lesson" }],
    ["note without expiry", { kind: "note", scope: "ticker:VCB" }],
    ["global note", { kind: "note", expiresAt: "2026-10-30" }],
    ["purged with a body", { status: "purged" }],
    ["active without a body", { body: null }],
    ["bad scope", { scope: "ticker:hpg" }],
    ["bad date", { asOf: "30/09/2026" }],
    ["unknown field", { stats: {} }],
    ["body over 4096 bytes", { body: "a".repeat(4097) }],
  ])("rejects %s", (_, patch) => {
    expect(MemoryItem.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  test("scopes for indices, futures, ETFs and sectors", () => {
    for (const scope of ["index:VN30", "future:VN30F1M", "ticker:E1VFVN30", "sector:banking", "agent:analyst"])
      expect(
        MemoryItem.safeParse({ ...valid, kind: "lesson", createdBy: "system", origin: "feedback", scope }).success,
      ).toBe(true)
  })
})

describe("MemoryConfig", () => {
  test("fills defaults and ignores keys meant for other modules", () => {
    const c = parseMemoryConfig({ provider: "sqlite", enabled: false })
    expect(c.enabled).toBe(false)
    expect(c).toMatchObject({ maxItemBytes: 4096, t1MaxBytes: 6000, entityTtlTurns: 6, maxEntities: 5, t3: "off" })
    expect(c.autoDisable).toEqual({ window: 5, harmful: 2 })
    expect(parseMemoryConfig(undefined).timezone).toBe("Asia/Ho_Chi_Minh")
  })

  test("rejects values that would break the limits", () => {
    expect(MemoryConfig.safeParse({ maxItemBytes: 4097 }).success).toBe(false)
    expect(MemoryConfig.safeParse({ t1MaxBytes: 0 }).success).toBe(false)
    expect(MemoryConfig.safeParse({ t3: "maybe" }).success).toBe(false)
  })
})

describe("dates and ids", () => {
  test("calendar dates are Vietnam dates, not UTC dates", () => {
    expect(calendarDate(new Date("2026-09-30T16:59:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-09-30")
    expect(calendarDate(new Date("2026-09-30T17:00:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-01")
    expect(daysBetween("2026-09-30", "2026-10-02")).toBe(2)
    expect(addDays("2026-09-30", 30)).toBe("2026-10-30")
  })

  test("UUIDv7 ids are time-ordered", () => {
    const ids = Array.from({ length: 500 }, () => uuidV7Ids.next())
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect([...ids].sort()).toEqual(ids)
  })

  test("folding handles đ, which FTS5 remove_diacritics does not", () => {
    expect(foldVietnamese("Định giá ĐẤT đai")).toBe("dinh gia dat dai")
  })
})
