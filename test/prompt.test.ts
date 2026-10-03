import { expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assemble, type AssembleInput } from "../src/core/prompt/assemble"
import { fit, tierOf } from "../src/core/prompt/budget"
import { clockState, loadCalendar, renderClock, sameSnapshot } from "../src/core/prompt/market-clock"
import type { Skill } from "../src/core/skills/schema"

const calendar = loadCalendar()
// 2026-09-28 is a Monday. Times are UTC; Vietnam is UTC+7.
const at = (hhmm: string, day = "2026-09-28") => new Date(`${day}T${hhmm}:00+07:00`)

const skill = (partial: Partial<Skill> & { name: string }): Skill => ({
  description: `mô tả ${partial.name}`,
  activation: "auto",
  body: `BODY-${partial.name}`,
  dir: "/x",
  source: "bundled",
  ...partial,
})

const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  tier: "B",
  tools: ["current_time", "load_skill"],
  skills: [skill({ name: "devil", triggers: { keywords: ["phản biện"] } })],
  sticky: [],
  input: "xin chào",
  now: at("10:00"),
  calendar,
  ...over,
})

test("market phases come from calendar data", () => {
  const phase = (t: string, day?: string) => clockState(at(t, day), calendar).snapshot.phases
  expect(phase("08:50").HOSE).toBe("pre-open")
  expect(phase("09:05").HOSE).toBe("ATO")
  expect(phase("09:05").HNX).toBe("continuous")
  expect(phase("11:40").HOSE).toBe("break")
  expect(phase("14:35").HOSE).toBe("ATC")
  expect(phase("14:50").UPCoM).toBe("continuous")
  expect(phase("15:30").HOSE).toBe("closed")
  expect(phase("10:00", "2026-09-27").HOSE).toBe("closed-day") // Sunday
  const text = renderClock(clockState(at("10:00"), calendar), calendar)
  expect(text).toContain("Thứ hai 28/09/2026")
  expect(text).toContain("chưa kiểm chứng") // calendar.json is marked verified: false
})

test("system prompt has a fixed layer order and is byte-identical when nothing changes", () => {
  const a = assemble(base())
  const b = assemble(base({ now: at("10:05"), input: "câu khác" }))
  expect(a.system).toBe(b.system)
  const order = ["<identity>", "<tools>", "<citations>", "<style>", "<skill_catalog>"].map((t) => a.system.indexOf(t))
  expect(order.every((i) => i >= 0)).toBe(true)
  expect([...order].sort((x, y) => x - y)).toEqual(order)
  expect(a.system).toContain("- devil: mô tả devil")
})

test("the market clock is re-sent only when a phase changes", () => {
  const first = assemble(base({ now: at("09:10") }))
  expect(first.reminders.some((r) => r.startsWith("<phien_giao_dich>"))).toBe(true)
  const same = assemble(base({ now: at("09:14"), prevClock: first.clock }))
  expect(same.reminders.some((r) => r.startsWith("<phien_giao_dich>"))).toBe(false)
  const next = assemble(base({ now: at("09:20"), prevClock: same.clock }))
  expect(next.reminders.find((r) => r.startsWith("<phien_giao_dich>"))).toContain("khớp lệnh liên tục")
  expect(sameSnapshot(first.clock, next.clock)).toBe(false)
})

test("trigger hits add a skill hint reminder; manual and sticky skills behave", () => {
  const skills = [
    skill({ name: "devil", triggers: { keywords: ["phản biện"] } }),
    skill({ name: "hand", activation: "manual" }),
    skill({ name: "rules", activation: "always" }),
  ]
  const hit = assemble(base({ skills, input: "phan bien giup minh" }))
  expect(hit.reminders.find((r) => r.startsWith("<goi_y_skill>"))).toContain("devil")
  expect(hit.system).toContain("BODY-rules") // always-on body in system
  expect(hit.system).not.toContain("- hand") // manual skills are not in the catalog
  expect(hit.context).toBeUndefined()

  const pinned = assemble(base({ skills, sticky: ["hand"] }))
  expect(pinned.context).toContain('<skill name="hand">')
})

test("investor profile goes to context, is capped per tier, and never into system", () => {
  const profile = "# Hồ sơ\n" + "Luôn nêu bear case trước. ".repeat(600)
  const a = assemble(base({ tier: "A", investorProfile: profile }))
  expect(a.system).not.toContain("Hồ sơ")
  expect(a.context).toContain("<ho_so_nha_dau_tu>")
  const row = a.report.find((r) => r.id === "ho_so_nha_dau_tu")!
  expect(row.truncated).toBe(true)
  expect(row.tokens).toBeLessThanOrEqual(1_400)
  expect(a.context).toContain("đã được cắt bớt")
})

test("tier C drops style first but keeps identity and the market clock", () => {
  const c = assemble(base({ tier: "C" }))
  expect(c.system).not.toContain("<style>")
  expect(c.report.find((r) => r.id === "style")!.dropped).toBe(true)
  expect(c.system).toContain("<identity>")
  expect(c.reminders.some((r) => r.startsWith("<phien_giao_dich>"))).toBe(true)
})

test("no tools: no tool guidance, no skill catalog", () => {
  const plain = assemble(base({ tools: [] }))
  expect(plain.system).not.toContain("<tools>")
  expect(plain.system).not.toContain("<skill_catalog>")
})

test("prompt text is read from prompts/*.md, so edits apply without code changes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-prompts-"))
  await writeFile(path.join(dir, "identity.md"), "Bạn là trợ lý thử nghiệm.")
  const custom = assemble(base(), dir)
  expect(custom.system).toContain("<identity>\nBạn là trợ lý thử nghiệm.\n</identity>")
  expect(custom.system).not.toContain("<citations>") // missing files are simply skipped
})

test("budget helpers", () => {
  expect(tierOf(1_000_000)).toBe("A")
  expect(tierOf(128_000)).toBe("B")
  expect(tierOf(32_000)).toBe("C")
  expect(tierOf(undefined)).toBe("B")
  expect(fit("ngắn", 100)).toMatchObject({ truncated: false, dropped: false })
  expect(fit("x".repeat(1000), 0)).toMatchObject({ dropped: true, text: "" })
})

test("deferred tools are listed by server in system, after the skill catalog; skills may need deferred tools", () => {
  const needs = skill({ name: "flows", requires_tools: ["mcp__ot__money_flow"] })
  const input = base({
    tools: ["current_time", "load_skill", "tool_search"],
    skills: [needs],
    deferredTools: [{ server: "ot", tools: ["money_flow", "vn_quote_history"] }],
    declaredTools: ["current_time", "load_skill", "tool_search", "mcp__ot__money_flow", "mcp__ot__vn_quote_history"],
  })
  const a = assemble(input)
  expect(a.system).toContain("<tool_hoan>\n")
  expect(a.system).toContain("ot (2): money_flow, vn_quote_history")
  expect(a.system.indexOf("<skill_catalog>")).toBeLessThan(a.system.indexOf("<tool_hoan>\n"))
  // The skill stays visible although its tool is only deferred.
  expect(a.system).toContain("- flows:")
  expect(a.report.find((r) => r.id === "tool_hoan")?.channel).toBe("system")
  // Without tool_search there is nothing to load them with: no list.
  expect(assemble({ ...input, tools: ["current_time", "load_skill"] }).system).not.toContain("<tool_hoan>\n")
})

test("MCP server instructions go to system, framed below the invariants, within budget", () => {
  const input = base({ mcpInstructions: [{ server: "ot", text: "Dùng symbol_lookup khi chưa chắc mã." }] })
  const a = assemble(input)
  expect(a.system).toContain('<server name="ot">\nDùng symbol_lookup khi chưa chắc mã.\n</server>')
  expect(a.system.indexOf("<identity>")).toBeLessThan(a.system.indexOf("<huong_dan_mcp>"))
  expect(a.report.find((r) => r.id === "huong_dan_mcp")?.channel).toBe("system")
  // A model without tools gets no tool instructions.
  expect(assemble({ ...input, tools: [] }).system).not.toContain("<huong_dan_mcp>")
  const long = assemble(base({ tier: "C", mcpInstructions: [{ server: "ot", text: "x ".repeat(5_000) }] }))
  expect(long.report.find((r) => r.id === "huong_dan_mcp")?.truncated).toBe(true)
})
