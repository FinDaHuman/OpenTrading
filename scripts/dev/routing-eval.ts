import path from "node:path"
import { evalRouting, type Summary } from "../../test/helpers/routing-eval"

/**
 * Per-case report of the offline routing eval (same numbers as test/routing-eval.test.ts).
 * Cách chạy: bun scripts/dev/routing-eval.ts [--all]   (--all prints passing cases too)
 */

const root = path.resolve(import.meta.dir, "../..")
const showAll = process.argv.includes("--all")
const { results, summary } = await evalRouting(root)

for (const r of results) {
  const toolBad = r.toolHit === false
  const skillBad = r.skillHit === false || r.wrongSkills.length > 0
  if (!showAll && !toolBad && !skillBad) continue
  console.log(`Q${r.case.id} [${r.case.split}] ${r.case.q.slice(0, 90)}`)
  if (r.case.tools) console.log(`  tools ${r.toolHit ? "ok  " : "MISS"} want ${r.case.tools.join("|")} · loaded ${r.loaded.join(", ") || "-"}`)
  if (r.case.skills) {
    const ok = r.skillHit !== false && r.wrongSkills.length === 0
    console.log(`  skill ${ok ? "ok  " : "BAD "} want ${r.case.skills.join("|") || "(none)"} · suggested ${r.suggested.join(", ") || "-"}`)
  }
}

const pct = (a: number, b: number) => (b === 0 ? "-" : `${((100 * a) / b).toFixed(0)}% (${a}/${b})`)
const line = (name: string, s: Summary) =>
  `${name.padEnd(8)} tool recall ${pct(s.toolHits, s.toolCases).padEnd(13)} skill recall ${pct(s.skillHits, s.skillPositives).padEnd(13)} ` +
  `suggestion precision ${pct(s.rightSuggestions, s.suggestions).padEnd(13)} no-skill cases suggested ${pct(s.negativesSuggested, s.skillNegatives)}`
console.log("")
for (const [name, s] of Object.entries(summary)) console.log(line(name, s))
