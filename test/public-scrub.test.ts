import { expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

/**
 * The repository is public: comments and docs may compare behaviour with Claude Code, but
 * never cite its internal source (file paths, symbols, constants), and never carry a
 * developer's local folders.
 */
const ROOT = path.join(import.meta.dir, "..")
const DIRS = ["src", "test", "scripts", "prompts", "agents", "skills", "docs", "handbook", "examples", "resources", ".github"]
const TEXT = /\.(ts|tsx|md|json|ya?ml|py)$/

/** Anywhere in the tree. */
const ALWAYS = [/\bCLAUDE_CODE_[A-Z0-9_]+/, /\b[A-Z]:[\\/]VsCode[\\/]/i]

/** After "Claude Code" on a line. */
const NEAR_CLAUDE_CODE = [
  /\b[\w./*-]+\.tsx?\b/, // a source file
  /\b(?:components|services|utils)\//, // a source folder
  /\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/, // a lowerCamelCase symbol
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, // an UPPER_CASE constant
  /\b[A-Z]\w+(?:Tool|Dialog|Footer)\b/, // a component or tool class
]
/** Public names the rules above would otherwise catch. */
const ALLOWED = ["mcpServers", "ultracode", "ultradesk"]

function files(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const full = path.join(dir, name)
    if (name === "node_modules") return []
    return statSync(full).isDirectory() ? files(full) : TEXT.test(name) ? [full] : []
  })
}

function offenders(): string[] {
  const roots = readdirSync(ROOT).filter((n) => n.endsWith(".md")).map((n) => path.join(ROOT, n))
  const all = [...roots, ...DIRS.flatMap((d) => files(path.join(ROOT, d)))].filter((f) => f !== import.meta.path)
  const found: string[] = []
  for (const file of all) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((raw, i) => {
        const line = ALLOWED.reduce((s, word) => s.replaceAll(word, ""), raw)
        const where = `${path.relative(ROOT, file)}:${i + 1}`
        for (const rule of ALWAYS) if (rule.test(line)) found.push(`${where} ${rule}`)
        // What follows the name is what the comment attributes to it.
        const at = line.indexOf("Claude Code")
        if (at >= 0) for (const rule of NEAR_CLAUDE_CODE) if (rule.test(line.slice(at))) found.push(`${where} ${rule}`)
      })
  }
  return found
}

test("no internal Claude Code source references or local folders in the public tree", () => {
  expect(offenders()).toEqual([])
})
