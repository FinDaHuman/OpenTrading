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
  toolHits: 34, // of 58
  /** Cases whose expected skill is suggested. */
  skillHits: 39, // of 43
  /** Suggested skills that are not expected (on scored cases). */
  maxWrongSuggestions: 18, // of 57
  /** "No skill" cases that still get a suggestion. */
  maxNegativesSuggested: 4, // of 18
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
