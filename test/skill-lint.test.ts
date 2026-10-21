import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadSkills, skillRoots } from "../src/core/skills/loader"
import { suggestSkills } from "../src/core/skills/catalog"
import { loadSkillTool } from "../src/core/tools/builtin/load-skill"
import type { Skill } from "../src/core/skills/schema"
import { lintSkills } from "./helpers/skill-lint"
import { copiedResultHit, decisionTreeIssues } from "./helpers/skill-lint"

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

test("references giữ luật/ngưỡng, không chép kết quả bảng (docs/contracts.md §3)", () => {
  expect(report.copiedResults).toEqual([])
})

test("copiedResults bắt đúng các dạng kết quả bảng, và không bắt luật/ngưỡng", () => {
  // dạng #90 từng chép vào references
  expect(copiedResultHit("thép **mạnh nhất toàn bảng**, sau Tết")).toBe("so sánh nhất")
  expect(copiedResultHit("**BĐS hit cao nhất bảng**")).toBe("so sánh nhất")
  expect(copiedResultHit("**thép dẫn đầu cả hai đáy**; CK nằm top 3 cả hai")).toBe("so sánh nhất")
  expect(copiedResultHit("Mẫu ~8 Tết cho baskets (từ 2019), ~15 cho VNINDEX")).toBe("số mẫu")
  expect(copiedResultHit("mẫu mảng ~8–9 năm (từ 2018-10)")).toBe("số mẫu")
  expect(copiedResultHit("CNTT rất mạnh ở đáy 2020 nhưng chỉ trung bình ở đáy 2022")).toBe("kết quả gắn năm")
  // luật, ngưỡng, cơ chế, prior có nhãn → không bắt
  expect(copiedResultHit("Ngưỡng diễn giải: hit ≥ 75% = bias mạnh; 60–75% = vừa; < 50% = không bias.")).toBeNull()
  expect(copiedResultHit("thép mạnh T2 (sau Tết); dầu khí mạnh T1–T2/T5, yếu T3–T4")).toBeNull()
  expect(copiedResultHit("- Q1 (đặc biệt T1–T2) thường mạnh nhất năm; T12→T3 là cửa sổ tốt.")).toBeNull()
  expect(copiedResultHit("| 2016–2017 | Uptrend dài | Tín dụng cao, bank + Vingroup dẫn dắt |")).toBeNull()
  // ca hợp lệ (provenance) thoát bằng marker
  expect(copiedResultHit("<!-- lint:allow-result --> Backtest gốc Mỹ 1973–2004, mạnh nhất toàn bảng")).toBeNull()
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


test("sector decision trees close branches and reference existing Q nodes", () => {
  expect(report.decisionTrees).toEqual([])
})

test("decision tree lint handles source-qualified Q headings and wrapped branches", () => {
  const body = `## Cây quyết định nhà máy
Q1. Nhóm nào?
├─ Có → Q3 (thủy)
└─ Chưa rõ → ★ "Chưa đủ dữ liệu"

Q3 (thủy). Nước đủ không?
├─ Có → ★ "Thuận lợi"
└─ Chưa rõ → ★ "Chưa đủ dữ liệu"

## Ví dụ
Q99. Ngoài cây
├─ Không kiểm tra
`
  expect(decisionTreeIssues(body)).toEqual([])
  expect(decisionTreeIssues(body.replace('└─ Chưa rõ → ★ "Chưa đủ dữ liệu"', '├─ Chưa rõ → ★ "Chưa đủ dữ liệu"'))).toContain("Q1: nhánh cuối phải là └─")
  expect(decisionTreeIssues(body.replace("→ Q3 (thủy)", "→ Q4 (thủy)"))).toContain("Q1: tham chiếu Q4 không tồn tại")
  const terminalTransition = body.replace('Có → ★ "Thuận lợi"', `Có → ★ "Thuận lợi" nhưng
   tiếp Q1`)
  expect(decisionTreeIssues(terminalTransition)).toContain("Q3: ★ vừa kết luận vừa chuyển Q")
  expect(decisionTreeIssues(body.replace('Có → ★ "Thuận lợi"', 'Có → Q1 rồi ★ "Thuận lợi"'))).toContain("Q3: ★ vừa kết luận vừa chuyển Q")
  expect(decisionTreeIssues(`## Ví dụ
Q1. Không phải cây
├─ thử → Q99`)).toEqual([])
})
