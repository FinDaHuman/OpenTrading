import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

/**
 * Rules are general business standards written by people (not memory about the user). They are data inside the
 * prompt, never instructions that can grant permissions. Four modes, as in Cursor:
 * - always:  `alwaysApply: true`; part of the stable block.
 * - scoped:  `tickers` or `sectors`; injected while those instruments are being discussed.
 * - agent:   only a `description`; listed so the model can fetch it with load_rule.
 * - manual:  none of the above; only when the user writes @rule:<name>.
 */
export type RuleMode = "always" | "scoped" | "agent" | "manual"

const Frontmatter = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]{1,64}$/),
  description: z.string().max(300).optional(),
  tickers: z.array(z.string().regex(/^[A-Z0-9]{2,12}$/)).optional(),
  sectors: z.array(z.string().regex(/^[a-z_]+$/)).optional(),
  alwaysApply: z.boolean().optional(),
})

export interface Rule {
  name: string
  description: string
  tickers: string[]
  sectors: string[]
  mode: RuleMode
  body: string
  /** sha256 of the body, recorded in audit refs so a changed rule is distinguishable. */
  hash: string
  source: "repo" | "user"
}

export interface RuleSet {
  rules: Rule[]
  /** Files that could not be read or parsed. Reported, never skipped silently. */
  errors: { file: string; message: string }[]
}

export const REPO_RULES_DIR = path.resolve(import.meta.dir, "../../../rules")

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

export function parseRule(source: string, origin: Rule["source"]): Rule {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").normalize("NFC")
  const match = text.match(FRONTMATTER)
  if (!match) throw new Error("thiếu frontmatter ---")
  const meta = Frontmatter.parse(Bun.YAML.parse(match[1]!))
  const body = match[2]!.trim()
  if (!body) throw new Error("nội dung rule rỗng")
  const tickers = [...(meta.tickers ?? [])].sort()
  const sectors = [...(meta.sectors ?? [])].sort()
  const mode: RuleMode = meta.alwaysApply
    ? "always"
    : tickers.length > 0 || sectors.length > 0
      ? "scoped"
      : meta.description
        ? "agent"
        : "manual"
  return {
    name: meta.name,
    description: meta.description ?? "",
    tickers,
    sectors,
    mode,
    body,
    hash: createHash("sha256").update(body).digest("hex"),
    source: origin,
  }
}

function readDir(dir: string, origin: Rule["source"], into: Map<string, Rule>, errors: RuleSet["errors"]) {
  if (!existsSync(dir)) return
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const full = path.join(dir, file)
    try {
      const rule = parseRule(readFileSync(full, "utf8"), origin)
      if (rule.name !== file.replace(/\.md$/, "")) throw new Error(`name "${rule.name}" khác tên file`)
      into.set(rule.name, rule)
    } catch (error) {
      errors.push({ file: full, message: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Repo rules first, then the user's; a user rule with the same name replaces the repo one. Sorted by name. */
export function loadRules(dirs: { repo?: string; user?: string } = {}): RuleSet {
  const byName = new Map<string, Rule>()
  const errors: RuleSet["errors"] = []
  readDir(dirs.repo ?? REPO_RULES_DIR, "repo", byName, errors)
  if (dirs.user) readDir(dirs.user, "user", byName, errors)
  return { rules: [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), errors }
}
