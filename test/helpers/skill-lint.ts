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

/**
 * `references/` giữ luật + ngưỡng + cơ chế, không giữ **kết quả bảng** (luật ở
 * docs/contracts.md §3). Kết quả đo sẽ cũ sau mỗi lần refresh và model sẽ trích
 * từ file thay vì tra tool. Ba dạng hay gặp (PR #90):
 * - so sánh nhất kèm phạm vi: "mạnh nhất toàn bảng", "hit cao nhất nhóm", "dẫn đầu cả hai đáy";
 * - số mẫu: "mẫu ~8 Tết", "mẫu mảng ~8–9 năm";
 * - kết quả gắn năm: "đáy 2020 … trung bình ở đáy 2022".
 * Chỉ quét `references/` — SKILL.md hợp lệ dùng "mạnh nhất"/"dẫn đầu" (VD so-sanh mã).
 * Ca hợp lệ (provenance của framework) thoát bằng `<!-- lint:allow-result -->`.
 */
const COPIED_RESULT_RULES: { name: string; res: RegExp[] }[] = [
  {
    name: "so sánh nhất",
    res: [
      // "mạnh nhất toàn bảng", "hit cao nhất nhóm", "dẫn đầu cả hai đáy"
      /(mạnh nhất|cao nhất|hit cao nhất|dẫn đầu)[^\n]{0,40}(bảng|nhóm|cả hai|tuyệt đối|thứ \d)/i,
      // "top 3 cả hai", "top cả 2 đáy" — nhưng "top 3 ở mọi đáy" là tiêu chí, không bắt
      /\btop\s+(?:cả\s+)?\d+\s*(?:đáy|bảng|nhóm|cả)/i,
    ],
  },
  { name: "số mẫu", res: [/(mẫu|số mã|quy mắc)(\s+\S+){0,2}\s*~\s*\d+/i] },
  { name: "kết quả gắn năm", res: [/(năm|đáy)\s*(19|20)\d{2}[^\n]{0,50}(dẫn|top|rơi|mạnh|yếu|nhất|trung bình)/i] },
]
const ALLOW_RESULT = /<!--\s*lint:allow-result\s*-->/

/** Tên rule vi phạm trong một dòng references, hoặc null nếu dòng đó sạch. */
export function copiedResultHit(line: string): string | null {
  if (ALLOW_RESULT.test(line)) return null
  for (const { name, res } of COPIED_RESULT_RULES) if (res.some((re) => re.test(line))) return name
  return null
}

/** Check only the sector decision-tree section, leaving unrelated prose/trees alone. */
export function decisionTreeIssues(body: string): string[] {
  const section = body.match(/^## Cây quyết định[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]
  if (!section) return []
  const nodes = [...section.matchAll(/^(Q\d+[a-z]*)(?:\s*\([^\n]*?\))?\.[^\n]*$/gm)]
  const ids = new Set(nodes.map((node) => node[1]!))
  const issues: string[] = []
  if (!nodes.length) return ["Cây quyết định không có node Q"]
  if (ids.size !== nodes.length) issues.push("Node Q trùng ID")
  for (const [i, node] of nodes.entries()) {
    const block = section.slice(node.index! + node[0].length, nodes[i + 1]?.index ?? section.length)
    const branches: { marker: string; text: string }[] = []
    for (const line of block.split("\n")) {
      const branch = line.match(/^([├└]─)\s*(.*)$/)
      if (branch) branches.push({ marker: branch[1]!, text: branch[2]! })
      else if (/^\s+\S/.test(line) && branches.length) branches.at(-1)!.text += ` ${line.trim()}`
    }
    if (!branches.length || branches.at(-1)!.marker !== "└─" || branches.slice(0, -1).some((b) => b.marker === "└─")) {
      issues.push(`${node[1]}: nhánh cuối phải là └─`)
    }
    for (const branch of branches) {
      for (const ref of branch.text.matchAll(/\bQ\d+[a-z]*\b/g)) {
        if (!ids.has(ref[0])) issues.push(`${node[1]}: tham chiếu ${ref[0]} không tồn tại`)
      }
      if (branch.text.includes("★") && /(?:→|tiếp|rồi|sang)\s*Q\d+[a-z]*\b/.test(branch.text)) {
        issues.push(`${node[1]}: ★ vừa kết luận vừa chuyển Q`)
      }
    }
  }
  return [...new Set(issues)]
}

export async function lintSkills(root: string) {
  const { skills } = await loadSkills(skillRoots(root).filter((r) => r.source === "bundled"))
  const { all, writes } = await toolNames(root)
  const skillNames = new Set(skills.map((s) => s.name))
  const report: Record<string, string[]> = { unknownTools: [], triggers: [], catalogLength: [], englishHeadings: [], preloadedWrites: [], copiedResults: [], decisionTrees: [] }
  const known = (t: string) => all.has(bare(t)) || matchToolPattern(bare(t), all).length > 0
  // Only words in a tool family (vn_, vs_, cycle_, chart_…) are checked in bodies; the
  // rest of the snake_case there is field names.
  const families = new Set([...all].map((t) => t.split("_")[0]!))
  for (const skill of skills) {
    for (const t of [...(skill.requires_tools ?? []), ...(skill.uses_tools ?? [])]) {
      if (!known(t)) report.unknownTools!.push(`${skill.name}: frontmatter ${t}`)
    }
    for (const issue of decisionTreeIssues(skill.body)) report.decisionTrees!.push(`${skill.name}: ${issue}`)
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
      if (/\b(procedure|workflow|when to use|examples?|templates?|non-negotiables?|reference files?|output format|steps?)\b/i.test(h)) {
        report.englishHeadings!.push(`${skill.name}: ${h}`)
      }
    }
    for (const t of skill.uses_tools ?? skill.requires_tools ?? []) {
      if (writes.has(bare(t)) || MCP_WRITE.test(t)) report.preloadedWrites!.push(`${skill.name}: ${t}`)
    }
    for (const { file, text } of await referenceFiles(skill)) {
      for (const line of text.split("\n")) {
        const rule = copiedResultHit(line)
        if (rule) report.copiedResults!.push(`${skill.name}: ${file} — ${rule}: ${line.trim().slice(0, 90)}`)
      }
    }
  }
  for (const key of Object.keys(report)) report[key] = [...new Set(report[key])]
  return report
}

/** The `references/` files of one skill, with their path relative to the skill dir. */
async function referenceFiles(skill: Skill) {
  const glob = new Bun.Glob("references/**/*.md")
  const out: { file: string; text: string }[] = []
  for await (const file of glob.scan({ cwd: skill.dir })) out.push({ file, text: await readFile(path.join(skill.dir, file), "utf8") })
  return out
}

async function bodyWithReferences(skill: Skill) {
  const glob = new Bun.Glob("references/**/*.md")
  const parts = [skill.body]
  for await (const file of glob.scan({ cwd: skill.dir })) parts.push(await readFile(path.join(skill.dir, file), "utf8"))
  return parts.join("\n")
}
