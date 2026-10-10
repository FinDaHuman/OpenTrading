import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { availableSkills, fold, matchTriggers, renderCatalog } from "../src/core/skills/catalog"
import { matchToolPattern } from "../src/core/tools/patterns"
import { loadSkills, readSkillFile, skillRoots } from "../src/core/skills/loader"
import { parseSkill, type Skill } from "../src/core/skills/schema"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function root() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-skills-"))
  dirs.push(dir)
  return dir
}

async function skill(rootDir: string, name: string, frontmatter: string, body = "BODY") {
  await mkdir(path.join(rootDir, name), { recursive: true })
  await writeFile(path.join(rootDir, name, "SKILL.md"), `---\n${frontmatter}\n---\n${body}\n`)
}

const make = (partial: Partial<Skill> & { name: string }): Skill => ({
  description: `mô tả ${partial.name}`,
  activation: "auto",
  body: "BODY",
  dir: "/x",
  source: "bundled",
  ...partial,
})

test("SKILL.md frontmatter is validated with readable errors", () => {
  const ok = parseSkill("---\nname: bank-sector\ndescription: Ngân hàng\ntriggers:\n  keywords: [NIM, CASA]\n---\nThân")
  expect(ok.meta).toMatchObject({ name: "bank-sector", activation: "auto", triggers: { keywords: ["NIM", "CASA"] } })
  expect(ok.body).toBe("Thân")
  expect(() => parseSkill("no frontmatter")).toThrow("thiếu frontmatter")
  expect(() => parseSkill("---\nname: Bad Name\ndescription: x\n---\n")).toThrow('trường "name"')
  expect(() => parseSkill("---\nname: a\n---\n")).toThrow('trường "description"')
  expect(() => parseSkill("---\nname: a\ndescription: x\nactivation: sometimes\n---\n")).toThrow('trường "activation"')
})

test("project overrides user overrides bundled; broken skills are reported, not thrown", async () => {
  const [project, user, bundled] = await Promise.all([root(), root(), root()])
  await skill(bundled, "shared", "name: shared\ndescription: từ bundled")
  await skill(user, "shared", "name: shared\ndescription: từ user")
  await skill(project, "shared", "name: shared\ndescription: từ project")
  await skill(bundled, "only-bundled", "name: only-bundled\ndescription: b")
  await skill(user, "broken", "name: broken\n  bad: [")
  await skill(user, "mismatch", "name: other-name\ndescription: x")
  const { skills, problems } = await loadSkills([
    { dir: project, source: "project" },
    { dir: user, source: "user" },
    { dir: bundled, source: "bundled" },
  ])
  expect(skills.map((s) => [s.name, s.source])).toEqual([
    ["only-bundled", "bundled"],
    ["shared", "project"],
  ])
  expect(skills.find((s) => s.name === "shared")!.description).toBe("từ project")
  expect(problems.map((p) => path.basename(path.dirname(p.file))).sort()).toEqual(["broken", "mismatch"])
  expect(problems.find((p) => p.file.includes("mismatch"))!.error).toContain("trùng tên thư mục")
})

test("the bundled skills all load cleanly", async () => {
  const { skills, problems } = await loadSkills(skillRoots(await root()).filter((r) => r.source === "bundled"))
  expect(problems).toEqual([])
  expect(skills.map((s) => s.name)).toEqual([
    "bat-on-quoc-gia",
    "chu-ky-tai-san-the-gioi",
    "chu-ky-tai-san-vn",
    "co-ban-chuyen-sau",
    "danh-gia-tinh-hinh-chinh-tri-toan-cau",
    "danh-gia-tinh-hinh-xung-dot",
    "danh-gia-truoc-bctc",
    "danh-gia-vi-mo-quoc-te",
    "danh-gia-vi-mo-viet-nam",
    "devil-advocate",
    "dinh-gia-chuyen-sau",
    "dinh-vi-chu-ky-vn",
    "du-doan-fed",
    "du-doan-polymarket",
    "explain-term",
    "kiem-chien-luoc-backtest",
    "kiem-tra-nguon-du-lieu",
    "ky-thuat-chuyen-sau",
    "nhip-dap-crypto",
    "phan-tich-chuyen-sau-1-ma",
    "phan-tich-sentiment",
    "phan-tich-vang-ty-gia",
    "so-sanh-cung-nganh",
    "tim-co-hoi-bao-cao-ctck",
    "tim-kiem-tin-tuc",
    "tin-tuc-nong-quoc-te",
    "tin-tuc-nong-viet-nam",
    "ve-bieu-do",
    "vn-market-basics",
  ])
})

test("ve-bieu-do references đọc được qua load_skill file=", async () => {
  const { skills } = await loadSkills(skillRoots(await root()).filter((r) => r.source === "bundled"))
  const viz = skills.find((s) => s.name === "ve-bieu-do")!
  expect(viz.requires_tools).toEqual(["chart_render"])
  expect(viz.uses_tools).toEqual(["chart_render", "chart_compare", "chart_depth"])
  for (const f of ["references/choosing-a-form.md", "references/time-series.md", "references/comparison.md", "references/part-to-whole.md", "references/relationship.md", "references/anti-patterns.md"]) {
    const body = await readSkillFile(viz, f)
    expect(body.length).toBeGreaterThan(100)
  }
  await expect(readSkillFile(viz, "../SKILL.md")).rejects.toThrow("nằm ngoài thư mục")
})

test("supporting files are readable only inside the skill directory", async () => {
  const dir = await root()
  await skill(dir, "bank", "name: bank\ndescription: b")
  await writeFile(path.join(dir, "bank", "kpi.md"), "NIM, CASA")
  await writeFile(path.join(dir, "secret.txt"), "không được đọc")
  const bank = (await loadSkills([{ dir, source: "user" }])).skills[0]!
  expect(await readSkillFile(bank, "kpi.md")).toBe("NIM, CASA")
  await expect(readSkillFile(bank, "../secret.txt")).rejects.toThrow("nằm ngoài thư mục")
  await expect(readSkillFile(bank, path.join(dir, "secret.txt"))).rejects.toThrow("nằm ngoài thư mục")
  await expect(readSkillFile(bank, "missing.md")).rejects.toThrow("Không có file")
})

test("catalog lists auto skills only and stays within budget", () => {
  const skills = [
    make({ name: "auto-a", when_to_use: "khi hỏi A" }),
    make({ name: "hand", activation: "manual" }),
    make({ name: "always-on", activation: "always" }),
    ...Array.from({ length: 30 }, (_, i) => make({ name: `bulk-${i}`, description: "x".repeat(400) })),
  ]
  const full = renderCatalog(skills.slice(0, 3), 1_000)!
  expect(full.text).toContain("- auto-a: mô tả auto-a Dùng khi: khi hỏi A")
  expect(full.text).not.toContain("hand")
  expect(full.text).not.toContain("always-on")
  expect(full.truncated).toBe(false)

  const tight = renderCatalog(skills, 700)!
  expect(tight.truncated).toBe(true)
  expect(Math.ceil(tight.text.length / 4)).toBeLessThanOrEqual(700)
  expect(tight.text).toContain("bulk-29")
})

test("skills whose required tools are missing are hidden", () => {
  const skills = [make({ name: "needs-data", requires_tools: ["mcp__vn__quote"] }), make({ name: "free" })]
  expect(availableSkills(skills, new Set()).map((s) => s.name)).toEqual(["free"])
  expect(availableSkills(skills, new Set(["mcp__vn__quote"])).map((s) => s.name)).toEqual(["needs-data", "free"])
})

test("requires_tools accepts short names, server/tool and wildcards", () => {
  const tools = new Set(["current_time", "mcp__opentrading__vn_quote_history", "mcp__opentrading__vn_index_ohlcv", "mcp__other__vn_quote_history"])
  expect(matchToolPattern("vn_quote_history", tools)).toEqual(["mcp__opentrading__vn_quote_history", "mcp__other__vn_quote_history"])
  expect(matchToolPattern("opentrading/vn_quote_history", tools)).toEqual(["mcp__opentrading__vn_quote_history"])
  expect(matchToolPattern("opentrading/vn_*", tools)).toEqual(["mcp__opentrading__vn_quote_history", "mcp__opentrading__vn_index_ohlcv"])
  expect(matchToolPattern("current_time", tools)).toEqual(["current_time"])
  expect(matchToolPattern("mcp__other__*", tools)).toEqual(["mcp__other__vn_quote_history"])
  expect(matchToolPattern("quote", tools)).toEqual([]) // no substring matches without *
  const skills = [make({ name: "prices", requires_tools: ["opentrading/vn_quote_history"] }), make({ name: "gone", requires_tools: ["x/y"] })]
  expect(availableSkills(skills, tools).map((s) => s.name)).toEqual(["prices"])
})

test("trigger keywords match without Vietnamese diacritics, on word boundaries", () => {
  expect(fold("Phản Biện đầu tư")).toBe("phan bien dau tu")
  const skills = [
    make({ name: "devil", triggers: { keywords: ["phản biện", "bear case"] } }),
    make({ name: "bank", triggers: { keywords: ["NIM"] } }),
    make({ name: "hand", activation: "manual", triggers: { keywords: ["phản biện"] } }),
  ]
  expect(matchTriggers("hãy phan bien luận điểm FPT", skills).map((s) => s.name)).toEqual(["devil"])
  expect(matchTriggers("NIM của VCB?", skills).map((s) => s.name)).toEqual(["bank"])
  expect(matchTriggers("animation", skills)).toEqual([]) // "nim" inside a word does not count
})

test("analysis skills có hook Trực quan hóa trỏ về ve-bieu-do", async () => {
  const { skills } = await loadSkills(skillRoots(await root()).filter((r) => r.source === "bundled"))
  const withHook = [
    "bat-on-quoc-gia", "co-ban-chuyen-sau", "danh-gia-tinh-hinh-chinh-tri-toan-cau", "danh-gia-tinh-hinh-xung-dot",
    "danh-gia-truoc-bctc", "danh-gia-vi-mo-quoc-te", "danh-gia-vi-mo-viet-nam", "dinh-gia-chuyen-sau",
    "du-doan-fed", "du-doan-polymarket", "kiem-chien-luoc-backtest", "ky-thuat-chuyen-sau",
    "nhip-dap-crypto", "phan-tich-chuyen-sau-1-ma", "phan-tich-sentiment", "phan-tich-vang-ty-gia",
    "so-sanh-cung-nganh", "tim-co-hoi-bao-cao-ctck", "tim-kiem-tin-tuc", "tin-tuc-nong-quoc-te", "tin-tuc-nong-viet-nam",
  ]
  for (const name of withHook) {
    const s = skills.find((x) => x.name === name)!
    expect(s, name).toBeDefined()
    expect(s.body).toContain("## Trực quan hóa")
    expect(s.body).toContain("ve-bieu-do")
  }
  // Skill thuần lý luận không ép chart.
  for (const name of ["devil-advocate", "explain-term", "vn-market-basics", "kiem-tra-nguon-du-lieu"]) {
    expect(skills.find((x) => x.name === name)!.body).not.toContain("## Trực quan hóa")
  }
})

test("ve-bieu-do được gợi ý khi hỏi vẽ chart + có trong catalog", async () => {
  const { skills } = await loadSkills(skillRoots(await root()).filter((r) => r.source === "bundled"))
  expect(matchTriggers("vẽ biểu đồ nến VCB", skills).map((s) => s.name)).toContain("ve-bieu-do")
  expect(matchTriggers("ve bieu do tron", skills).map((s) => s.name)).toContain("ve-bieu-do")
  const catalog = renderCatalog(skills, 10_000)!
  expect(catalog.text).toContain("- ve-bieu-do:")
  expect(catalog.text).toContain("trực quan hóa")
})

test("cây quyết định choosing-a-form bao phủ đủ kinds + có lưới an toàn", async () => {
  const { skills } = await loadSkills(skillRoots(await root()).filter((r) => r.source === "bundled"))
  const viz = skills.find((s) => s.name === "ve-bieu-do")!
  const tree = await readSkillFile(viz, "references/choosing-a-form.md")
  // Đủ 9 nút Q0–Q8 theo đúng thứ tự duyệt.
  for (const q of ["Q0.", "Q1.", "Q2.", "Q3.", "Q3b.", "Q4.", "Q5.", "Q6.", "Q7.", "Q8."]) {
    expect(tree, `thiếu nút ${q}`).toContain(q)
  }
  // Mọi kind tool hỗ trợ đều xuất hiện trong cây (không chart mồ côi).
  for (const kind of ["candlestick", "line", "area", "sparkline", "sparkcolumn", "linebox", "multiline", "chart_compare", "bar", "pie", "donut", "waterfall", "stacked", "histogram", "boxplot", "scatter", "heatmap", "gauge", "chart_depth", "winloss"]) {
    expect(tree, `kind ${kind} không có trong cây`).toContain(kind)
  }
  // Quy tắc dừng ở node cha + lưới an toàn + cấm bịa.
  expect(tree).toContain("DỪNG ở node ★")
  expect(tree).toContain("KHÔNG VẼ")
  expect(tree).toContain("Không bao giờ bịa data")
  // Ngưỡng khớp đúng validation trong code (render.ts / pie.ts / waterfall.ts / boxplot.ts / multiline.ts / compare.ts).
  for (const t of ["≥5 nến", "≥2 điểm", "≥2 lát", "≥1 delta", "Mỗi nhóm ≥4 điểm", "≥3 điểm", "value + max", "2–5 chuỗi"]) {
    expect(tree, `thiếu ngưỡng ${t}`).toContain(t)
  }
})

test("SKILL.md trỏ sang cây thay vì bảng phẳng", async () => {
  const { skills } = await loadSkills(skillRoots(await root()).filter((r) => r.source === "bundled"))
  const viz = skills.find((s) => s.name === "ve-bieu-do")!
  expect(viz.body).not.toContain("## Bảng chọn hình")
  expect(viz.body).toContain("choosing-a-form.md")
  expect(viz.body).toContain("DỪNG ở node")
})
