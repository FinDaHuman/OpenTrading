import { expect, test } from "bun:test"
import {
  MEMORY_POLICY,
  type MemoryAction,
  type MemoryKind,
  type MemoryRole,
  type PolicyRule,
} from "../src/core/memory/policy"
import { readFileSync } from "node:fs"
import { createNotebookAdmin } from "../src/core/memory/notebook/admin"
import { useTempStores } from "./helpers/memory-store"

const t = useTempStores()

/**
 * What each role may get, written out here on purpose instead of read from MEMORY_POLICY: changing
 * the policy then needs this table changed too, so a slip in one place turns the test red.
 * Absent = denied. An empty list = allowed, but the action carries no data (propose, activate).
 */
const EXPECTED: Record<string, readonly string[]> = {
  "main_agent/system/constraint": ["id", "version", "text", "scope"],
  "main_agent/system/style": ["id", "version", "text"],
  "subagent/system/constraint": ["id", "version", "text", "scope"],
  "main_agent/index/thesis": ["subjectId", "display", "sectorDisplay", "state"],
  "main_agent/index/lesson": ["id", "title"],
  "main_agent/block/thesis": [
    "subjectId",
    "display",
    "sectorId",
    "sectorDisplay",
    "version",
    "text",
    "conditions",
    "reviewBy",
    "state",
    "validFrom",
  ],
  "main_agent/memory_read/constraint": ["id", "version", "text", "scope"],
  "main_agent/memory_read/style": ["id", "version", "text"],
  "main_agent/memory_read/thesis": [
    "subjectId",
    "display",
    "sectorId",
    "sectorDisplay",
    "version",
    "text",
    "conditions",
    "reviewBy",
    "state",
    "validFrom",
    "detail",
  ],
  "main_agent/memory_read/lesson": [
    "id",
    "version",
    "title",
    "summary",
    "appliesTo",
    "appliesToDisplay",
    "exceptions",
    "detail",
    "tags",
    "createdAt",
  ],
  // Spotting subjects in what the user typed: aliases are compared, never put in a prompt.
  "main_agent/match/thesis": ["subjectId", "aliases", "uppercaseOnly"],
  "main_agent/propose/constraint": [],
  "main_agent/propose/style": [],
  "main_agent/propose/lesson": [],
  "user/activate/constraint": [],
  "user/activate/style": [],
  "user/activate/thesis": [],
  "user/activate/lesson": [],
  "user/activate/decision": [],
}

const ROLES: MemoryRole[] = ["user", "main_agent", "subagent"]
const ACTIONS: MemoryAction[] = ["system", "index", "block", "match", "memory_read", "propose", "activate"]
const KINDS: MemoryKind[] = ["constraint", "style", "thesis", "lesson", "decision"]

/** One entry of every kind, every optional field filled so a projection shows all its fields. */
function oneOfEach() {
  const store = t.open()
  const w = store.writer
  w.addConstraint({ kind: "constraint", text: "Không dùng margin" })
  w.addConstraint({ kind: "style", text: "Trả lời ngắn" })
  const steel = w.createSubject({ kind: "sector", alias: "Thép" }).id
  const hpg = w.createSubject({ kind: "ticker", alias: "HPG", sectorId: steel }).id
  w.saveThesis(hpg, null, {
    text: "Hưởng lợi từ đầu tư công",
    detail: "Chi tiết luận điểm",
    conditions: ["Sai nếu biên gộp dưới 10%"],
    reviewBy: "2026-12-31",
  })
  const banks = w.createSubject({ kind: "sector", alias: "Ngân hàng" }).id
  w.addLesson({
    title: "Định giá ngân hàng",
    summary: "Dùng P/B và ROE",
    appliesTo: [banks],
    exceptions: "Ngân hàng tái cơ cấu",
    detail: "Chi tiết bài học",
    tags: ["định giá"],
  })
  w.addDecision({ subjectId: hpg, thesisVersion: 1, action: "Mua HPG", reason: "Lý do riêng tư của tôi" })
  return { store, hpg, steel }
}

test("every role × action × kind × context reads exactly what the policy table allows", () => {
  const { store } = oneOfEach()
  for (const shared of [false, true]) {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        const items = store.gate.read(role, action, { shared })
        for (const kind of KINDS) {
          const key = `${role}/${action}/${kind}`
          const expected = EXPECTED[key]
          const allowed = store.gate.allows(role, action, kind, { shared })
          expect({ key, allowed }).toEqual({ key, allowed: !!expected })
          const ofKind = items.filter((i) => i.kind === kind)
          if (!expected?.length) {
            expect({ key, items: ofKind }).toEqual({ key, items: [] })
            continue
          }
          expect({ key, n: ofKind.length }).toEqual({ key, n: 1 })
          expect({ key, fields: Object.keys(ofKind[0]!.fields).sort() }).toEqual({ key, fields: [...expected].sort() })
        }
      }
    }
  }
})

test("no read by a model role ever carries a decision's content", () => {
  const { store } = oneOfEach()
  for (const shared of [false, true]) {
    for (const role of ["main_agent", "subagent"] as const) {
      for (const action of ACTIONS) {
        const json = JSON.stringify(store.gate.read(role, action, { shared }))
        expect(json).not.toContain("Mua HPG")
        expect(json).not.toContain("riêng tư")
      }
    }
  }
})

test("a sub-agent gets the constraints and nothing else", () => {
  const { store } = oneOfEach()
  expect(store.gate.read("subagent", "system")).toEqual([
    { kind: "constraint", fields: { id: 1, version: 1, text: "Không dùng margin", scope: "all_accounts" } },
  ])
})

test("the index lists HPG with its sector and state, and lesson #1 by title; no thesis text, no summary", () => {
  const { store, hpg } = oneOfEach()
  const index = store.gate.read("main_agent", "index")
  expect(index).toEqual([
    { kind: "thesis", fields: { subjectId: hpg, display: "HPG", sectorDisplay: "Thép", state: "watching" } },
    { kind: "lesson", fields: { id: 1, title: "Định giá ngân hàng" } },
  ])
  // A ticker outside any sector has no sector field; a refuted thesis stays listed, saying so.
  const vnm = store.writer.createSubject({ kind: "ticker", alias: "VNM" }).id
  store.writer.saveThesis(vnm, null, { text: "Thương hiệu mạnh", conditions: [] })
  store.writer.setThesisState(vnm, 1, "refuted")
  expect(store.gate.read("main_agent", "index").find((i) => i.fields.subjectId === vnm)?.fields).toEqual({
    subjectId: vnm,
    display: "VNM",
    state: "refuted",
  })
})

test("a thesis block names its sector, so the reader can point to the sector's thesis", () => {
  const { store, hpg, steel } = oneOfEach()
  const block = store.gate.read("main_agent", "block", { shared: false }, { subjectIds: [hpg] })
  expect(block[0]!.fields).toMatchObject({ subjectId: hpg, display: "HPG", sectorId: steel, sectorDisplay: "Thép" })
})

test("the policy table cannot be widened at run time", () => {
  for (const rule of MEMORY_POLICY) {
    expect(Object.isFrozen(rule)).toBe(true)
    expect(Object.isFrozen(rule.fields)).toBe(true)
  }
  expect(() => (MEMORY_POLICY[0]!.fields as string[]).push("detail")).toThrow()
  expect(() => (MEMORY_POLICY as PolicyRule[]).push(MEMORY_POLICY[0]!)).toThrow()
})

test("filters narrow blocks to the subjects in focus and memory_read to the lessons asked for", () => {
  const { store, hpg } = oneOfEach()
  const vnm = store.writer.createSubject({ kind: "ticker", alias: "VNM" }).id
  store.writer.saveThesis(vnm, null, { text: "Thương hiệu mạnh", conditions: [] })
  store.writer.addLesson({ title: "Bài hai", summary: "Tóm tắt hai" })
  const blocks = store.gate.read("main_agent", "block", { shared: false }, { subjectIds: [vnm] })
  expect(blocks.map((b) => b.fields.subjectId)).toEqual([vnm])
  const lessons = store.gate
    .read("main_agent", "memory_read", { shared: false }, { lessonIds: [2] })
    .filter((i) => i.kind === "lesson")
  expect(lessons.map((l) => l.fields.title)).toEqual(["Bài hai"])
  expect(store.gate.read("main_agent", "block").map((b) => b.fields.subjectId)).toEqual([hpg, vnm])
})

test("an undeclared role is denied", () => {
  const { store } = oneOfEach()
  const stranger = "mcp_server" as MemoryRole
  expect(store.gate.read(stranger, "system")).toEqual([])
  expect(store.gate.allows(stranger, "memory_read", "lesson")).toBe(false)
})

test("only the user makes memory take effect; no model role ever can", () => {
  const { store } = oneOfEach()
  for (const kind of KINDS) {
    expect(store.gate.allows("user", "activate", kind)).toBe(true)
    expect(store.gate.allows("main_agent", "activate", kind)).toBe(false)
    expect(store.gate.allows("subagent", "activate", kind)).toBe(false)
  }
})

test("deleted entries never come out of the gate", () => {
  const { store, hpg } = oneOfEach()
  store.writer.deleteConstraint(1, 1)
  store.writer.deleteThesis(hpg, 1)
  store.writer.deleteLesson(1, 1)
  const everything = JSON.stringify(ACTIONS.map((a) => store.gate.read("main_agent", a)))
  expect(everything).not.toContain("margin")
  expect(everything).not.toContain("đầu tư công")
  expect(everything).not.toContain("Định giá ngân hàng")
})

test("matching sees the aliases in use of subjects with a thesis, and the uppercase-only flag", () => {
  const { store, hpg } = oneOfEach()
  const w = store.writer
  w.addAlias(hpg, "Hòa Phát")
  w.addAlias(hpg, "HPG cũ")
  w.retireAlias(hpg, "HPG cũ")
  const tin = w.createSubject({ kind: "ticker", alias: "TIN", uppercaseOnly: true }).id
  w.saveThesis(tin, null, { text: "Tín dụng tăng", conditions: [] })
  // A subject without a thesis is never looked for: nothing would be injected.
  w.createSubject({ kind: "ticker", alias: "VCB" })
  expect(store.gate.read("main_agent", "match").map((i) => i.fields)).toEqual([
    { subjectId: hpg, aliases: ["HPG", "Hòa Phát"], uppercaseOnly: false },
    { subjectId: tin, aliases: ["TIN"], uppercaseOnly: true },
  ])
})

test("memory_read names the subjects a lesson applies to, so a keyword search finds the sector", () => {
  const { store } = oneOfEach()
  const lesson = store.gate.read("main_agent", "memory_read").find((i) => i.kind === "lesson")!
  expect(lesson.fields.appliesToDisplay).toEqual(["Ngân hàng"])
})

test("the gate and the reader have no write, and all three capabilities are frozen", () => {
  const { store } = oneOfEach()
  // @ts-expect-error the gate is read-only
  expect(store.gate.addConstraint).toBeUndefined()
  // @ts-expect-error the reader is read-only
  expect(store.reader.deleteLesson).toBeUndefined()
  expect(Object.keys(store.gate).sort()).toEqual(["allows", "read"])
  expect(Object.keys(store.reader).filter((k) => /^(add|revise|delete|save|set|create|retire)/.test(k))).toEqual([])
  expect(Object.isFrozen(store.gate)).toBe(true)
  expect(Object.isFrozen(store.reader)).toBe(true)
  expect(Object.isFrozen(store.writer)).toBe(true)
})

test("the store has no proposal state: nothing waits for approval inside it", () => {
  t.open()
  const schema = JSON.stringify(t.raw().query("SELECT sql FROM sqlite_master").all())
  expect(schema).not.toMatch(/propos|pending|draft/i)
})

test("exporting to Markdown is the user's own read: decisions only when asked; no model role ever activates", async () => {
  const { store } = oneOfEach()
  const admin = createNotebookAdmin({
    path: store.path,
    reader: () => store.reader,
    writer: () => store.writer,
    problem: () => undefined,
    closed: () => false,
  })
  // The export's output is what is checked: the table holds rules for model roles and the user's
  // "activate" only, and has no rule for the user reading or exporting their own notebook.
  const plain = await admin.exportMarkdown({ decisions: false })
  const withLog = await admin.exportMarkdown({ decisions: true })
  if (!plain.ok || !withLog.ok) throw new Error("export failed")
  expect(readFileSync(plain.file, "utf8")).not.toContain("Lý do riêng tư của tôi")
  expect(readFileSync(withLog.file, "utf8")).toContain("Lý do riêng tư của tôi")
  for (const role of ["main_agent", "subagent"] as const) {
    for (const kind of ["constraint", "style", "thesis", "lesson", "decision"] as const) {
      expect(EXPECTED[`${role}/activate/${kind}`]).toBeUndefined()
      expect(MEMORY_POLICY.some((r: PolicyRule) => r.role === role && r.action === "activate" && r.kind === kind)).toBe(false)
    }
  }
})
