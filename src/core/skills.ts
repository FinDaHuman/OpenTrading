import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { SKILLS_DIR } from "./paths"

export interface Skill {
  name: string
  description: string
  body: string
}

/** Skills are markdown files with `name` and `description` frontmatter. */
export async function loadSkills(dir = SKILLS_DIR): Promise<Skill[]> {
  const files = await readdir(dir).catch(() => [] as string[])
  const skills = await Promise.all(
    files
      .filter((f) => f.endsWith(".md"))
      .map(async (f) => parseSkill(await readFile(path.join(dir, f), "utf8"), f)),
  )
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export function parseSkill(source: string, file = "skill.md"): Skill {
  const text = source.replace(/\r\n/g, "\n")
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta: Record<string, string> = {}
  if (match) {
    for (const line of match[1]!.split("\n")) {
      const i = line.indexOf(":")
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
  }
  return {
    name: meta.name || file.replace(/\.md$/, ""),
    description: meta.description || "",
    body: (match ? match[2]! : text).trim(),
  }
}
