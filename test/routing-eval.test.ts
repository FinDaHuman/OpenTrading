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
   * 2026-10-21 (sector skills, PR #116): 2 cases per sector skill, look-alike questions that
   * belong to other skills, and the misroutes found in review. Misses: Q176/Q229 (old), Q290
   * (no news skill fires for "Vinhomes có tin gì mới", same on main).
   */
  skillHits: 86, // of 89
  /**
   * Suggested skills that are not expected (on scored cases).
   * 18 as before, +1 devil-advocate on Q275 (a pre-earnings HPG question, the same pattern
   * as Q5). Sector skills add none: phase/news/compare/buy questions are excluded through
   * `triggers.exclude`, and danh-gia-vi-mo-viet-nam steps aside for sector trade questions.
   */
  maxWrongSuggestions: 19, // of 105
  /** "No skill" cases that still get a suggestion. */
  maxNegativesSuggested: 5, // of 35
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
