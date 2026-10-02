import { z } from "zod"

/**
 * SKILL.md frontmatter — the Agent Skills layout Claude Code, Codex and Cursor share
 * (`name` + `description` required), plus a few OpenTrading fields for finance routing.
 */
export const SkillFrontmatter = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "chỉ gồm chữ thường, số, gạch ngang; tối đa 64 ký tự"),
  description: z.string().min(1, "không được để trống"),
  /** When the model should pick this skill. Vague descriptions never get picked. */
  when_to_use: z.string().optional(),
  /**
   * auto: listed in the catalog, the model loads it when relevant (default)
   * always: body is always in the system prompt (keep these few and short)
   * manual: not listed; only the user turns it on with /skill <name>
   */
  activation: z.enum(["auto", "always", "manual"]).default("auto"),
  /** Deterministic pre-routing (HarnessPlan §5.3 L1): keywords suggest the skill for a turn. */
  triggers: z.object({ keywords: z.array(z.string()).default([]) }).optional(),
  /** Hide the skill unless all these tools are available (e.g. an MCP data tool). */
  requires_tools: z.array(z.string()).optional(),
  /**
   * Tool calls this skill may spend per run (skills-design-for-harness §0.3). Shown in the
   * catalog so the model self-limits; the harness enforces a looser per-turn total cap.
   */
  tool_budget: z.number().int().positive().max(30).optional(),
  version: z.union([z.string(), z.number()]).transform(String).optional(),
})

export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>

export type SkillSource = "project" | "user" | "bundled"

export interface Skill extends SkillFrontmatter {
  body: string
  /** Directory holding SKILL.md and any supporting files. */
  dir: string
  source: SkillSource
}

export interface SkillProblem {
  file: string
  source: SkillSource
  error: string
}

/** Split `---\nyaml\n---\nbody` and validate the YAML. */
export function parseSkill(text: string): { meta: SkillFrontmatter; body: string } {
  const normalised = text.replace(/^﻿/, "").replace(/\r\n/g, "\n")
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) throw new Error("thiếu frontmatter (--- ... ---) ở đầu file")
  let data: unknown
  try {
    data = Bun.YAML.parse(match[1]!)
  } catch (error) {
    throw new Error(`YAML không hợp lệ: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = SkillFrontmatter.safeParse(data ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new Error(`trường "${issue.path.join(".") || "?"}": ${issue.message}`)
  }
  return { meta: parsed.data, body: match[2]!.trim() }
}
