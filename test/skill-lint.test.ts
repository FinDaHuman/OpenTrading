import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadSkills, skillRoots } from "../src/core/skills/loader"
import { suggestSkills } from "../src/core/skills/catalog"
import { loadSkillTool } from "../src/core/tools/builtin/load-skill"
import type { Skill } from "../src/core/skills/schema"
import { lintSkills } from "./helpers/skill-lint"

const root = path.join(import.meta.dir, "..")
const ctx = { signal: new AbortController().signal, callId: "c1" }

// The report lists every problem by skill; `bun scripts/dev/skill-scan.ts` prints it.
const report = await lintSkills(root)

test("bundled skills only name tools that exist (MCP fixture + local tools)", () => {
  expect(report.unknownTools).toEqual([])
})

test("trigger keywords never fold onto everyday words ('nến' vs 'nên') and are not catch-alls", () => {
  expect(report.triggers).toEqual([])
})

test("catalog lines fit 250 characters, headings are Vietnamese, write tools are never preloaded", () => {
  expect(report.catalogLength).toEqual([])
  expect(report.englishHeadings).toEqual([])
  expect(report.preloadedWrites).toEqual([])
})

test("an everyday question does not pull in the chart skill", async () => {
  const { skills } = await loadSkills(skillRoots(root).filter((r) => r.source === "bundled"))
  for (const q of ["VCB có nên mua không?", "đồng tiền nào mạnh nhất", "cốt lõi của FPT là gì"]) {
    expect(suggestSkills(q, skills).map((s) => s.name)).not.toContain("ve-bieu-do")
  }
  expect(suggestSkills("vẽ biểu đồ nến VCB", skills).map((s) => s.name)).toContain("ve-bieu-do")
})

async function skillDir(name: string) {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), "ot-skill-")), name)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: thử\n---\nTHÂN`)
  return dir
}

test("load_skill preloads uses_tools (not every gate tool) and refuses a skill whose required tools are missing", async () => {
  const skill: Skill = {
    name: "chu-ky",
    description: "thử",
    activation: "auto",
    requires_tools: ["cycle_stats_check"],
    uses_tools: ["cycle_stats_check", "cycle_seasonality"],
    body: "THÂN",
    dir: await skillDir("chu-ky"),
    source: "bundled",
  }
  const pool = ["cycle_stats_check", "cycle_seasonality", "cycle_stats_refresh"]
  const ok = loadSkillTool(() => [skill], () => pool, () => new Set(pool))
  const out = (await ok.execute({ name: "chu-ky" }, ctx)) as string
  expect(out.split("\n")[0]).toContain("cycle_stats_check, cycle_seasonality")
  expect(out).not.toContain("cycle_stats_refresh")

  const missing = loadSkillTool(() => [skill], () => [], () => new Set(["current_time"]))
  await expect(missing.execute({ name: "chu-ky" }, ctx)).rejects.toThrow("đang tắt vì thiếu tool: cycle_stats_check")
})
