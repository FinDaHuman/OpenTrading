import { readdir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { dataDir, SKILLS_DIR } from "../paths"
import { parseSkill, type Skill, type SkillProblem, type SkillSource } from "./schema"

export interface SkillRoot {
  dir: string
  source: SkillSource
}

/** Highest precedence first: project overrides user overrides bundled (same name). */
export function skillRoots(cwd = process.cwd()): SkillRoot[] {
  return [
    { dir: path.join(cwd, ".opentrading", "skills"), source: "project" },
    { dir: path.join(dataDir(), "skills"), source: "user" },
    { dir: SKILLS_DIR, source: "bundled" },
  ]
}

export interface SkillSet {
  skills: Skill[]
  problems: SkillProblem[]
}

/** Load every `<root>/<name>/SKILL.md`. Broken files are reported, never thrown. */
export async function loadSkills(roots: SkillRoot[] = skillRoots()): Promise<SkillSet> {
  const byName = new Map<string, Skill>()
  const seenDirs = new Set<string>()
  const problems: SkillProblem[] = []

  for (const root of roots) {
    const entries = await readdir(root.dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root.dir, entry.name)
      const file = path.join(dir, "SKILL.md")
      if (!(await stat(file).catch(() => undefined))?.isFile()) continue
      // The same directory reached twice (symlink, overlapping roots) loads once.
      const real = await realpath(dir).catch(() => dir)
      if (seenDirs.has(real)) continue
      seenDirs.add(real)
      try {
        const { meta, body } = parseSkill(await readFile(file, "utf8"))
        if (meta.name !== entry.name) throw new Error(`name "${meta.name}" phải trùng tên thư mục "${entry.name}"`)
        if (!byName.has(meta.name)) byName.set(meta.name, { ...meta, body, dir, source: root.source })
      } catch (error) {
        problems.push({ file, source: root.source, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  return { skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), problems }
}

/** Read a supporting file inside a skill directory; refuses paths that escape it. */
export async function readSkillFile(skill: Skill, relative: string) {
  const target = path.resolve(skill.dir, relative)
  const inside = path.relative(skill.dir, target)
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error(`Đường dẫn "${relative}" nằm ngoài thư mục của skill ${skill.name}.`)
  }
  return readFile(target, "utf8").catch(() => {
    throw new Error(`Không có file "${relative}" trong skill ${skill.name}.`)
  })
}
