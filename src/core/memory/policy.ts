/**
 * Where each kind of memory may go: the single source of truth every read path asks, instead of
 * each block deciding for itself (a forgotten check in one place is how sub-agents came to read old
 * sessions). Rules are allow-only; anything not listed is denied.
 *
 * The shape follows Cedar (principal · action · resource · context) so a policy engine can replace
 * this table later without reshaping it:
 * - role: who reads the store. History tools never read it; they read session files, which other
 *   code guards.
 * - action: where the content goes. "propose" and "activate" carry no data, only permission. "match"
 *   goes nowhere: it is what spotting subjects in the user's words compares against.
 * - kind: which memory.
 * - shared: a rule with `shared` set applies only in that context; without it, in any. No rule
 *   lets a model role see decisions yet; sharing them is a later feature.
 * - fields: what the read returns (a projection), e.g. the index shows a thesis by its ticker only.
 */

export type MemoryRole = "user" | "main_agent" | "subagent"
export type MemoryAction = "system" | "index" | "block" | "match" | "memory_read" | "propose" | "activate"
export type MemoryKind = "constraint" | "style" | "thesis" | "lesson" | "decision"

export interface PolicyContext {
  shared: boolean
}

export interface PolicyRule {
  readonly role: MemoryRole
  readonly action: MemoryAction
  readonly kind: MemoryKind
  readonly shared?: boolean
  readonly fields: readonly string[]
}

const CONSTRAINT = ["id", "version", "text", "scope"] as const
const STYLE = ["id", "version", "text"] as const
const THESIS_BLOCK = [
  "subjectId",
  "display",
  "sectorId",
  "sectorDisplay",
  "version",
  "text",
  "conditions",
  "reviewBy",
  "state",
  "validFrom",
] as const
const LESSON_FULL = [
  "id",
  "version",
  "title",
  "summary",
  "appliesTo",
  "appliesToDisplay",
  "exceptions",
  "detail",
  "tags",
  "createdAt",
] as const

// Both the rule and its field list are frozen: `as const` only holds at compile time, and a pushed
// field would widen what the model reads.
const rule = (role: MemoryRole, action: MemoryAction, kind: MemoryKind, fields: readonly string[] = []): PolicyRule =>
  Object.freeze({ role, action, kind, fields: Object.freeze([...fields]) })

export const MEMORY_POLICY: readonly PolicyRule[] = Object.freeze([
  // Constraints reach the main agent and every sub-agent, whole; style shapes only the main agent's answers.
  rule("main_agent", "system", "constraint", CONSTRAINT),
  rule("main_agent", "system", "style", STYLE),
  rule("subagent", "system", "constraint", CONSTRAINT),
  // The index names what exists so the model knows to read it: a ticker (with its sector, and its state,
  // so a refuted thesis is not taken for a live one), a lesson title.
  rule("main_agent", "index", "thesis", ["subjectId", "display", "sectorDisplay", "state"]),
  rule("main_agent", "index", "lesson", ["id", "title"]),
  // A thesis is injected as a labelled block when its subject is in focus, naming its sector so the block
  // can point to the sector's own thesis; its detail only on request.
  rule("main_agent", "block", "thesis", THESIS_BLOCK),
  // Which subjects the user named: the aliases in use of subjects that have a thesis (nothing else would be
  // injected). Retired aliases come apart: they only tell which subject a block already in the history (sent
  // under an old code) belongs to, and never match what the user types. Compared only, never rendered.
  rule("main_agent", "match", "thesis", ["subjectId", "aliases", "uppercaseOnly", "pastAliases"]),
  rule("main_agent", "memory_read", "constraint", CONSTRAINT),
  rule("main_agent", "memory_read", "style", STYLE),
  rule("main_agent", "memory_read", "thesis", [...THESIS_BLOCK, "detail"]),
  rule("main_agent", "memory_read", "lesson", LESSON_FULL),
  // Suggestion cards (a later spec) may propose these; never a thesis or a decision.
  rule("main_agent", "propose", "constraint"),
  rule("main_agent", "propose", "style"),
  rule("main_agent", "propose", "lesson"),
  // Only a trusted user action makes memory take effect.
  rule("user", "activate", "constraint"),
  rule("user", "activate", "style"),
  rule("user", "activate", "thesis"),
  rule("user", "activate", "lesson"),
  rule("user", "activate", "decision"),
])

/** The rule allowing this, or undefined (denied). */
export function policyRule(
  role: MemoryRole,
  action: MemoryAction,
  kind: MemoryKind,
  ctx: PolicyContext = { shared: false },
): PolicyRule | undefined {
  return MEMORY_POLICY.find(
    (r) =>
      r.role === role &&
      r.action === action &&
      r.kind === kind &&
      (r.shared === undefined || r.shared === ctx.shared),
  )
}
