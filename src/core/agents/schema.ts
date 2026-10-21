import { z } from "zod"
import { EFFORT_LEVELS } from "../effort"
import { parseFrontmatter, type SkillSource } from "../skills/schema"

/**
 * An agent type: `<name>.md` with frontmatter (Claude Code's .claude/agents/*.md). The body
 * is the agent's own instructions, added to the subagent system prompt.
 */
export const AgentFrontmatter = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "chỉ gồm chữ thường, số, gạch ngang; tối đa 64 ký tự"),
  /** When the main agent should pick this type; shown in spawn_subagent's description. */
  description: z.string().min(1, "không được để trống"),
  /**
   * Tools it may use, as patterns (`current_time`, `opentrading/vn_*`, `*news*`). Absent or
   * `*`: every tool a subagent can have. `@chi-doc`: read-only tools only (alone, or
   * narrowing the patterns next to it).
   */
  tools: z.array(z.string()).optional(),
  /** Patterns removed after `tools`. */
  disallowedTools: z.array(z.string()).optional(),
  /** Its own model; both unset = config subagents, then the session's model. */
  provider: z.string().optional(),
  model: z.string().optional(),
  /** Model requests per run (default 8). */
  maxSteps: z.number().int().min(1).max(30).optional(),
  /** Reasoning effort (low…max); unset = config subagents.effort, then effort. */
  effort: z.enum(EFFORT_LEVELS).optional(),
}).refine((a) => !a.provider || a.model, { path: ["model"], message: "có provider thì phải ghi cả model" })

export type AgentFrontmatter = z.infer<typeof AgentFrontmatter>

export interface AgentDefinition extends AgentFrontmatter {
  body: string
  file: string
  source: SkillSource
  /** A lower-precedence definition with the same name exists (this one wins). */
  overrides?: SkillSource
}

export interface AgentProblem {
  file: string
  source: SkillSource
  error: string
}

export const parseAgent = (text: string) => parseFrontmatter(text, AgentFrontmatter)
