import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { availableSkills, fold, matchTriggers, renderCatalog } from "../src/core/skills/catalog"
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
    "co-ban-chuyen-sau",
    "danh-gia-tinh-hinh-chinh-tri-toan-cau",
    "danh-gia-tinh-hinh-thi-truong",
    "danh-gia-tinh-hinh-xung-dot",
    "danh-gia-truoc-bctc",
    "danh-gia-vi-mo-quoc-te",
    "danh-gia-vi-mo-viet-nam",
    "devil-advocate",
    "dinh-gia-chuyen-sau",
    "du-doan-fed",
    "du-doan-polymarket",
    "explain-term",
    "kiem-chien-luoc-backtest",
    "kiem-tra-rui-ro-vi-the",
    "ky-thuat-chuyen-sau",
    "luan-chuyen-nganh-viet-nam",
    "luan-chuyen-tai-san-toan-cau",
    "nhip-dap-crypto",
    "phan-tich-chuyen-sau-1-ma",
    "phan-tich-sentiment",
    "phan-tich-vang-ty-gia",
    "san-loc-co-phieu",
    "so-sanh-cung-nganh",
    "theo-doi-va-bao-thuc",
    "tim-co-hoi-bao-cao-ctck",
    "tim-kiem-tin-tuc",
    "tin-tuc-nong-quoc-te",
    "tin-tuc-nong-viet-nam",
    "vn-market-basics",
  ])
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
