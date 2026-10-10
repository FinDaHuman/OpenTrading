// Dev helper: prints what test/skill-lint.test.ts checks, for every bundled skill.
// Run: bun scripts/dev/skill-scan.ts
import path from "node:path"
import { lintSkills } from "../../test/helpers/skill-lint"

const root = path.join(import.meta.dir, "../..")
const report = await lintSkills(root)
for (const [rule, items] of Object.entries(report)) {
  console.log(`== ${rule} (${items.length})`)
  for (const item of items) console.log(`  ${item}`)
}
