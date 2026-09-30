import { describe, expect, test } from "bun:test"
import { MemoryConfig, parseMemoryConfig } from "../../src/core/memory/config"
import { uuidV7Ids } from "../../src/core/memory/deps"
import { MemoryItemV0, normalizeBody, prepareBody, utf8Bytes } from "../../src/core/memory/schema"

const valid = {
  schemaVersion: 1,
  id: "0190a000-0000-7000-8000-000000000001",
  kind: "profile",
  scope: "global",
  body: "Tôi không sử dụng margin",
  status: "active",
  visibility: "model",
  createdBy: "user",
  origin: "remember_command",
  createdAt: "2026-09-30T01:02:03.000Z",
  updatedAt: "2026-09-30T01:02:03.000Z",
}

describe("normalizeBody", () => {
  test("turns CRLF and lone CR into LF, then trims", () => {
    expect(normalizeBody("  a\r\nb\rc  ")).toBe("a\nb\nc")
  })

  test("composes decomposed Vietnamese into NFC", () => {
    const nfd = "Kết luận".normalize("NFD")
    expect(nfd).not.toBe("Kết luận")
    expect(normalizeBody(nfd)).toBe("Kết luận")
  })
})

describe("prepareBody", () => {
  test("accepts ordinary text and returns the normalized body", () => {
    expect(prepareBody("  Tôi không sử dụng margin\r\n", 4096)).toEqual({ ok: true, body: "Tôi không sử dụng margin" })
  })

  test("keeps TAB and LF but rejects other control characters", () => {
    expect(prepareBody("a\tb\nc", 4096).ok).toBe(true)
    for (const bad of ["a\u0000b", "a\u0007b", "a\u001Bb", "a\u007Fb"])
      expect(prepareBody(bad, 4096)).toEqual({ ok: false, code: "invalid_input", reasons: ["control_char"] })
  })

  test("rejects non-strings and bodies that are empty after trimming", () => {
    expect(prepareBody(42, 4096)).toEqual({ ok: false, code: "invalid_input", reasons: ["not_string"] })
    expect(prepareBody(" \r\n\t ", 4096)).toEqual({ ok: false, code: "invalid_input", reasons: ["empty"] })
  })

  test("4096 UTF-8 bytes of Vietnamese pass, 4097 fail", () => {
    const ok = "ệ".repeat(1365) + "a" // 1365 × 3 bytes + 1 = 4096
    expect(utf8Bytes(ok)).toBe(4096)
    expect(prepareBody(ok, 4096).ok).toBe(true)
    expect(prepareBody(ok + "a", 4096)).toEqual({ ok: false, code: "too_large", reasons: ["max_item_bytes"] })
  })

  test("the byte check runs after NFC, so decomposed input is measured as stored", () => {
    const composed = "ệ".repeat(1365) + "a"
    const decomposed = composed.normalize("NFD")
    expect(utf8Bytes(decomposed)).toBeGreaterThan(4096)
    expect(prepareBody(decomposed, 4096)).toEqual({ ok: true, body: composed })
  })

  test("a lower configured limit applies, but never above the hard ceiling", () => {
    expect(prepareBody("abcdef", 5).ok).toBe(false)
    expect(prepareBody("a".repeat(4097), 10_000).ok).toBe(false)
  })
})

describe("MemoryItemV0", () => {
  test("accepts the V0 subset", () => {
    expect(MemoryItemV0.parse(valid)).toEqual(valid as never)
  })

  test.each([
    ["kind", "lesson"],
    ["kind", "note"],
    ["scope", "ticker:HPG"],
    ["visibility", "restricted"],
    ["createdBy", "system"],
    ["origin", "feedback"],
    ["origin", "note_command"],
    ["status", "proposed"],
    ["schemaVersion", 2],
    ["createdAt", "30/09/2026"],
  ])("rejects %s = %p outside the V0 subset", (field, value) => {
    expect(MemoryItemV0.safeParse({ ...valid, [field]: value }).success).toBe(false)
  })

  test("rejects unknown fields and oversized bodies", () => {
    expect(MemoryItemV0.safeParse({ ...valid, title: "x" }).success).toBe(false)
    expect(MemoryItemV0.safeParse({ ...valid, body: "a".repeat(4097) }).success).toBe(false)
  })
})

describe("MemoryConfig", () => {
  test("fills defaults and ignores keys meant for later versions", () => {
    expect(parseMemoryConfig(undefined)).toEqual({ enabled: true, maxItemBytes: 4096, t1MaxBytes: 6000 })
    expect(parseMemoryConfig({ t3: "off", enabled: false })).toEqual({
      enabled: false,
      maxItemBytes: 4096,
      t1MaxBytes: 6000,
    })
  })

  test("rejects values that would break the limits", () => {
    expect(MemoryConfig.safeParse({ maxItemBytes: 4097 }).success).toBe(false)
    expect(MemoryConfig.safeParse({ t1MaxBytes: 0 }).success).toBe(false)
    expect(MemoryConfig.safeParse({ enabled: "yes" }).success).toBe(false)
  })
})

describe("uuidV7Ids", () => {
  test("produces time-ordered UUIDv7 ids", () => {
    const ids = Array.from({ length: 500 }, () => uuidV7Ids.next())
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect([...ids].sort()).toEqual(ids)
  })
})
