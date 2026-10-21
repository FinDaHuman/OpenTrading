import { expect, test } from "bun:test"
import path from "node:path"
import { loadSkills, skillRoots } from "../src/core/skills/loader"
import { catalogRegistry, evalRouting, loadCases, suggestedSkills } from "./helpers/routing-eval"

/**
 * Ratchet over the offline routing eval (test/helpers/routing-eval.ts). The floors are the
 * numbers measured when they were last raised; a change that lowers one fails here. Raise
 * them when a change improves routing. Per-case report: `bun scripts/dev/routing-eval.ts`.
 */
const FLOOR = {
  /** Cases whose expected MCP tool a keyword tool_search on the question loads. */
  toolHits: 51, // of 70 (2026-10-14: +distribution_count, 2/2 new cases hit)
  /** Existing and review regression cases; tool recall is unchanged. */
  skillHits: 86, // minimum retained from the parallel PR review fix
  /** Keep the stricter remote ratchet; macro trade exclusions remove Q267/Q268 overlap. */
  maxWrongSuggestions: 19,
  /** "No skill" cases that still get a suggestion. */
  maxNegativesSuggested: 5,

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


test("PR116 regressions produce the exact expected suggestions", async () => {
  const cases = (await loadCases(root)).filter((c) => c.note === "PR116 exact suggestions regression" || c.note === "PR116 reconciled remote exact regression")
  const registry = await catalogRegistry(root)
  const { skills } = await loadSkills(skillRoots(root).filter((r) => r.source === "bundled"))
  const declared = registry.list().map((tool) => tool.name)
  expect(cases.length).toBeGreaterThanOrEqual(14)
  for (const c of cases) {
    expect(suggestedSkills(c.q, skills, declared).sort(), `Q${c.id}: ${c.q}`).toEqual([...c.skills!].sort())
  }
})
