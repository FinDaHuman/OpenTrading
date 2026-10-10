import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { initRuntime } from "../../src/core/runtime"
import { fold } from "../../src/core/skills/catalog"
import { loadSkills, skillRoots } from "../../src/core/skills/loader"
import type { Skill } from "../../src/core/skills/schema"
import { matchToolPattern } from "../../src/core/tools/patterns"

/**
 * Checks for the bundled skills (test/skill-lint.test.ts; `bun scripts/dev/skill-scan.ts`
 * prints the same report). Each rule comes from a real bug in teammate skills:
 * - tools a skill names must exist (MCP fixture + local tools), or the model calls nothing;
 * - trigger keywords must not fold (diacritics stripped) onto everyday words — "nến"
 *   matched "nên", so "VCB có nên mua" loaded the chart skill;
 * - a catalog line over 250 characters is cut with "…";
 * - headings are Vietnamese (the 06/10 convention);
 * - write tools are never preloaded by a skill.
 */

/** Folded forms that are everyday words, or so generic they fire on most questions. */
export const BANNED_TRIGGERS = new Set([
  "nen", // nến / nên
  "cot", // cột / cốt
  "dong", // dòng / đồng
  "dong tien", // dòng tiền / đồng tiền
  "ty trong",
  "chart",
  "phan tich",
  "la gi",
  "giai thich",
  "chu ky",
  "suy thoai",
  "phan phoi",
  "vs",
  "so voi",
  "comment",
  "dan dat",
])

/** Short folded keywords that are fine: tickers, acronyms, terms with no everyday twin. */
const SHORT_OK = new Set([
  ...["fed", "sjc", "btc", "eth", "cpi", "gdp", "pmi", "eps", "roe", "roa", "pe", "pb", "per", "ma", "rsi", "macd", "fomc", "etf", "ipo"],
  ...["vni", "usd", "fdi", "ctck", "bctc", "kqkd", "dhcd", "rrg", "nber", "sbv", "xnk", "dcf", "odds", "bb", "adx", "ema", "sma", "fomo", "ato", "atc", "pie"],
])

/** Backticked names in a tool family that are tables or fields, not tools. */
const NOT_TOOLS = new Set(["cycle_meta", "cycle_month_stats", "cycle_ohlcv", "vn_asset_ohlcv", "vn_asset_monthly", "g_asset_monthly"])

/** `mcp__<server>__name` → `name` (skills may name a tool with its server prefix). */
const bare = (t: string) => t.replace(/^mcp__.+?__/, "")

export async function toolNames(root: string) {
  const fixture = JSON.parse(await readFile(path.join(root, "test/fixtures/mcp-tool-names.json"), "utf8")) as { tools: string[] }
  const home = await mkdtemp(path.join(os.tmpdir(), "ot-lint-"))
  const runtime = initRuntime({ home, cwd: home, skills: () => [] })
  const local = runtime.registry.list().map((t) => t.name)
  const writes = new Set(runtime.registry.list().filter((t) => !t.readOnly).map((t) => t.name))
  return { all: new Set([...fixture.tools, ...local, "web_search"]), writes }
}

const MCP_WRITE = /_(refresh|finalize|create|add|remove|delete|update|pause|resume)$/

export async function lintSkills(root: string) {
  const { skills } = await loadSkills(skillRoots(root).filter((r) => r.source === "bundled"))
  const { all, writes } = await toolNames(root)
  const skillNames = new Set(skills.map((s) => s.name))
  const report: Record<string, string[]> = { unknownTools: [], triggers: [], catalogLength: [], englishHeadings: [], preloadedWrites: [] }
  const known = (t: string) => all.has(bare(t)) || matchToolPattern(bare(t), all).length > 0
  // Only words in a tool family (vn_, vs_, cycle_, chart_…) are checked in bodies; the
  // rest of the snake_case there is field names.
  const families = new Set([...all].map((t) => t.split("_")[0]!))
  for (const skill of skills) {
    for (const t of [...(skill.requires_tools ?? []), ...(skill.uses_tools ?? [])]) {
      if (!known(t)) report.unknownTools!.push(`${skill.name}: frontmatter ${t}`)
    }
    const body = await bodyWithReferences(skill)
    for (const m of body.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\(|`)/g)) {
      const t = m[1]!
      if (NOT_TOOLS.has(t) || skillNames.has(t) || !families.has(t.split("_")[0]!)) continue
      if (!known(t)) report.unknownTools!.push(`${skill.name}: \`${t}\``)
    }
    for (const k of skill.triggers?.keywords ?? []) {
      const key = fold(k).replace(/[^\p{L}\p{N}+]+/gu, " ").trim()
      if (BANNED_TRIGGERS.has(key) || (!key.includes(" ") && key.length <= 4 && !SHORT_OK.has(key))) report.triggers!.push(`${skill.name}: "${k}"`)
    }
    const line = (skill.when_to_use ? `${skill.description} Dùng khi: ${skill.when_to_use}` : skill.description).replace(/\s+/g, " ").trim()
    if (line.length > 250) report.catalogLength!.push(`${skill.name}: ${line.length}`)
    for (const m of skill.body.matchAll(/^#{1,4} +(.+)$/gm)) {
      const h = m[1]!.trim()
      if (/^[\x20-\x7e]+$/.test(h) && !/`/.test(h) && /\b(procedure|workflow|when|use|example|template|non-negotiable|step|output|notes?)\b/i.test(h)) {
        report.englishHeadings!.push(`${skill.name}: ${h}`)
      }
    }
    for (const t of skill.uses_tools ?? skill.requires_tools ?? []) {
      if (writes.has(bare(t)) || MCP_WRITE.test(t)) report.preloadedWrites!.push(`${skill.name}: ${t}`)
    }
  }
  for (const key of Object.keys(report)) report[key] = [...new Set(report[key])]
  return report
}

async function bodyWithReferences(skill: Skill) {
  const glob = new Bun.Glob("references/**/*.md")
  const parts = [skill.body]
  for await (const file of glob.scan({ cwd: skill.dir })) parts.push(await readFile(path.join(skill.dir, file), "utf8"))
  return parts.join("\n")
}
