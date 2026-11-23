import type { AgentOrigin } from "../tools/types"

/**
 * What the model reads when a call does not run. Line 1 is the summary (the TUI shows it as the
 * row); the guidance follows after a blank line. Rules, after Claude Code's auto-mode denial and
 * Codex's guardian:
 * - every denial says not to reach the same effect through another tool or command (shell
 *   blocked → not write_file, an MCP tool, a script or a subagent instead), only a clearly safer
 *   way that does not have that effect;
 * - a block by auto mode, a deny rule or a missing UI also says: go on with independent work,
 *   then stop and explain what was needed, why, and how the USER can allow it (the model must
 *   not touch the permission settings itself: that is a hard deny);
 * - a plain "no" from the user keeps asking the user what to do instead (the turn's flow after
 *   a refusal does not change);
 * - a subagent cannot ask the user: it reports the block in its result.
 */

/** A classifier verdict carried to the denial: the rule's label (already in Vietnamese) and the reason. */
export interface AutoBlock {
  label?: string
  reason: string
  /** A hard-deny rule: the denial names no way to allow it (a message or an allow rule would not). */
  hard?: boolean
}

export interface DenyInfo {
  reason?: "user" | "cancelled" | "headless" | "rule" | "blocked" | "classifier" | "unsaved" | "rewrite"
  /** The user's note when denying, or why it is blocked. */
  message?: string
  /** Auto mode blocked this call (directly, or before handing it to the user). */
  auto?: AutoBlock
}

export const AUTO_BLOCK_PREFIX = "Auto mode blocked "
export const USER_DENY_PREFIX = "The user declined to run this tool"
export const RULE_DENY_PREFIX = "A block rule of the user's"
export const USER_NOTE = "The user's message: "

/**
 * The same prefixes as written before the runtime text moved to English (20/11/2026). Sessions
 * saved earlier still hold them, so every reader takes both lists.
 */
export const LEGACY_AUTO_BLOCK_PREFIX = "Auto mode chặn "
export const LEGACY_USER_DENY_PREFIX = "Người dùng từ chối chạy tool này"
export const LEGACY_RULE_DENY_PREFIX = "Quy tắc chặn của người dùng"
export const LEGACY_USER_NOTE = "Lời nhắn của người dùng: "
export const AUTO_BLOCK_PREFIXES = [AUTO_BLOCK_PREFIX, LEGACY_AUTO_BLOCK_PREFIX] as const
export const USER_DENY_PREFIXES = [USER_DENY_PREFIX, LEGACY_USER_DENY_PREFIX] as const
export const RULE_DENY_PREFIXES = [RULE_DENY_PREFIX, LEGACY_RULE_DENY_PREFIX] as const

/** The prefix of `prefixes` that `text` starts with, or undefined. */
export const prefixOf = (text: string, prefixes: readonly string[]) => prefixes.find((p) => text.startsWith(p))

const NO_WORKAROUND =
  "Do not do this same thing with another tool or command (write_file, edit_file, an MCP tool, a subagent, a script, a rewritten command): that works around this decision and will be blocked too. " +
  "Only a clearly safer way that does not have that effect is allowed (e.g. writing a new file instead of overwriting, or giving the command for the user to run)."

const THEN_STOP =
  "Carry on with other work that does not depend on this action. If it is essential to finish the request: do everything else, then STOP and tell the user what you meant to do, why it is needed, and how they can allow it; let the user decide."

const THEN_REPORT =
  "You are a subagent and cannot ask the user: carry on with the work that does not depend on this action, then state in your result what was blocked, the reason, and why it is needed, so the main agent can tell the user."

const ALLOW_AUTO =
  "How to allow it (the user does this; never change the permission settings yourself): /permissions → pick the block → ctrl+r to run it once; name the exact action and its target in a message; switch to ▸ ask before changes (Shift+Tab) to approve it themselves; or add an autoMode.allow rule in ~/.opentrading/config.json."

const HARD_STOP =
  "This is a hard rule: the user naming the action in a message, or an autoMode.allow rule, does not clear it. Do not ask the user to allow it. Carry on with other work that does not depend on it, then tell the user it was not done and that they can do it themselves outside OpenTrading."

const HARD_REPORT =
  "This is a hard rule: nothing the user or the main agent says clears it. Carry on with the work that does not depend on this action, then state in your result what was blocked and why."

const ALLOW_RULE = "How to allow it (the user does this; never change the permission settings yourself): remove or edit that rule in /permissions."

/** "Lý do." with one final period whatever the classifier wrote. */
const sentence = (text: string) => `${text.trim().replace(/[.。\s]+$/, "")}.`

const labelled = (block: AutoBlock) => `${block.label ? ` [${block.label}]` : ""}: ${sentence(block.reason)}`

const paragraphs = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join("\n\n")

/** What comes after a block the model must not work around: independent work, then stop (or report, in a subagent). */
const afterBlock = (agent: AgentOrigin | undefined) => (agent ? THEN_REPORT : THEN_STOP)

/** What the model reads when the classifier blocks. */
export function blockedMessage(tool: string, block: AutoBlock, agent?: AgentOrigin) {
  const head = `${AUTO_BLOCK_PREFIX}${tool}${labelled(block)}`
  if (block.hard) return paragraphs(head, NO_WORKAROUND, agent ? HARD_REPORT : HARD_STOP)
  return paragraphs(head, NO_WORKAROUND, afterBlock(agent), ALLOW_AUTO)
}

/** The error the model reads when a call does not run. `tool` is the model-visible name. */
export function deniedMessage(decision: DenyInfo, opts: { tool?: string; agent?: AgentOrigin } = {}) {
  const tool = opts.tool ?? "this tool"
  switch (decision.reason) {
    case "cancelled":
      return "The tool call was cancelled."
    case "rewrite":
      // Not a denial: the tool says how to write the call so that it runs (ToolDef.rewrite).
      return decision.message ?? "Rewrite this call in the form the tool accepts."
    case "unsaved":
      return `Could not run: ${decision.message ?? "the permission could not be saved"}.`
    case "classifier":
      return blockedMessage(tool, decision.auto ?? { reason: "it matches an auto-mode block rule" }, opts.agent)
    case "headless":
      // Auto mode blocked it and wanted the user to decide, but nobody can be asked: it is a block.
      if (decision.auto) return blockedMessage(tool, decision.auto, opts.agent)
      return paragraphs("This call needs the user's confirmation, but there is no interface to ask. Not run.", NO_WORKAROUND, afterBlock(opts.agent))
    case "blocked":
      return paragraphs(`Could not run: ${decision.message ?? "this call is blocked"}. Do not retry the same way.`, NO_WORKAROUND)
    case "rule":
      return paragraphs(`${RULE_DENY_PREFIX} (permissions.deny) does not allow ${tool}.`, NO_WORKAROUND, afterBlock(opts.agent), ALLOW_RULE)
    default: {
      const why = decision.auto ? ` (auto mode had blocked it${labelled(decision.auto).replace(/\.$/, "")})` : ""
      const note = decision.message ? ` ${USER_NOTE}${decision.message}` : ""
      const next = decision.message ? undefined : opts.agent ? "Record the declined action in your result." : "Do not retry the same call; ask the user what else they want."
      return paragraphs(`${USER_DENY_PREFIX}${why}.${note}`, next, NO_WORKAROUND)
    }
  }
}

/** The user's note in a denial the model read (the TUI's one-line summary). */
export function userNoteOf(text: string): string | undefined {
  const mark = [USER_NOTE, LEGACY_USER_NOTE].find((m) => text.includes(m))
  if (!mark) return undefined
  const rest = text.slice(text.indexOf(mark) + mark.length)
  const end = rest.indexOf("\n\n")
  return (end < 0 ? rest : rest.slice(0, end)).trim() || undefined
}
