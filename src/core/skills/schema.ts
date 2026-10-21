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
  /**
   * Deterministic pre-routing (HarnessPlan §5.3 L1): keywords suggest the skill for a turn;
   * an `exclude` phrase in the message rules it out of both routing layers for that turn
   * (a sector skill steps aside when the question is about market phase or rotation).
   */
  triggers: z
    .object({ keywords: z.array(z.string()).default([]), exclude: z.array(z.string()).optional() })
    .optional(),
  /**
   * Gate: hide the skill unless all these tools are available. Keep it to the one to three
   * tools the skill cannot work without — every extra entry is another way to hide it.
   */
  requires_tools: z.array(z.string()).optional(),
  /**
   * Tools loaded with the skill (deferred ones become callable without a tool_search).
   * Read tools only; write tools stay behind tool_search. Unset: the requires_tools.
   */
  uses_tools: z.array(z.string()).optional(),
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

/**
 * Split `---\nyaml\n---\nbody` and validate the YAML against `schema` (skills, agent
 * definitions). Errors are one readable line.
 */
export function parseFrontmatter<T>(text: string, schema: z.ZodType<T>): { meta: T; body: string } {
  const normalised = text.replace(/^﻿/, "").replace(/\r\n/g, "\n")
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) throw new Error("thiếu frontmatter (--- ... ---) ở đầu file")
  let data: unknown
  try {
    data = Bun.YAML.parse(match[1]!)
  } catch (error) {
    throw new Error(`YAML không hợp lệ: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = schema.safeParse(data ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new Error(`trường "${issue.path.join(".") || "?"}": ${issue.message}`)
  }
  return { meta: parsed.data, body: match[2]!.trim() }
}

export const parseSkill = (text: string) => parseFrontmatter(text, SkillFrontmatter)
