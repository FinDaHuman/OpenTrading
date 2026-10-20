import { expect, test } from "bun:test"
import path from "node:path"
import { loadSkills, skillRoots } from "../src/core/skills/loader"
import { catalogRegistry, evalRouting, loadCases } from "./helpers/routing-eval"

/**
 * Ratchet over the offline routing eval (test/helpers/routing-eval.ts). The floors are the
 * numbers measured when they were last raised; a change that lowers one fails here. Raise
 * them when a change improves routing. Per-case report: `bun scripts/dev/routing-eval.ts`.
 */
const FLOOR = {
  /** Cases whose expected MCP tool a keyword tool_search on the question loads. */
  toolHits: 51, // of 70 (2026-10-14: +distribution_count, 2/2 new cases hit)
  /**
   * Cases whose expected skill is suggested.
   * 2026-10-20: 34 dev cases mới cho 13 skill ngành VN (25 câu "hỏi đúng ngành" +
   * 9 câu nhắc tên ngành nhưng thuộc khía cạnh khác — định giá, so sánh, pha, vĩ mô,
   * tin, kỹ thuật, pre-BCTC, BCTC, cơ bản sàn). Floor = 75/79.
   */
  skillHits: 75, // of 79
  /**
   * Suggested skills that are not expected (on scored cases).
   * 18 gốc + 2 mới từ chồng lấn trigger đã biết: `danh-gia-vi-mo-viet-nam` có trigger
   * "xuất nhập khẩu"/"xuất khẩu" nên bắn cả câu "ngành xuất nhập khẩu chịu gì từ thuế
   * quan" (Q267/Q268). Muốn hạ phải siết trigger của skill vĩ mô — PR riêng.
   * +1: devil-advocate bắn thêm ở Q275 (câu pre-BCTC của HPG). Nới lên 21 có chủ đích,
   * ghi rõ thành phần để lần sau siết lại đúng chỗ.
   */
  maxWrongSuggestions: 21, // of 96
  /** "No skill" cases that still get a suggestion. */
  maxNegativesSuggested: 5, // of 27
}

const root = path.resolve(import.meta.dir, "..")

test("labels name real catalog tools and bundled auto skills", async () => {
  const cases = await loadCases(root)
  const registry = await catalogRegistry(root)
  const tools = new Set(registry.list().map((t) => t.name.replace(/^mcp__opentrading__/, "")))
  const { skills } = await loadSkills(skillRoots(root).filter((r) => r.source === "bundled"))
  const auto = new Set(skills.filter((s) => s.activation === "auto").map((s) => s.name))
  for (const c of cases) {
    for (const t of c.tools ?? []) expect(tools.has(t), `Q${c.id}: ${t}`).toBe(true)
    for (const s of c.skills ?? []) expect(auto.has(s), `Q${c.id}: ${s}`).toBe(true)
  }
  expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
})

test("routing does not regress below the recorded floors", async () => {
  const { summary } = await evalRouting(root)
  const all = summary.all
  console.log(JSON.stringify(summary))
  expect(all.toolHits).toBeGreaterThanOrEqual(FLOOR.toolHits)
  expect(all.skillHits).toBeGreaterThanOrEqual(FLOOR.skillHits)
  expect(all.suggestions - all.rightSuggestions).toBeLessThanOrEqual(FLOOR.maxWrongSuggestions)
  expect(all.negativesSuggested).toBeLessThanOrEqual(FLOOR.maxNegativesSuggested)
}, 30_000)
