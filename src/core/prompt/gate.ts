/**
 * Conditional lines in prompts/*.md: a rule that only makes sense with some tool or for some caller
 * says so where it is written, and assemble leaves it out when the turn does not meet it.
 *
 * - One line: end it with `<!-- khi: shell -->`.
 * - Several lines: a line `<!-- khi: chart_render -->` opens a block, a line `<!-- /khi -->` closes it
 *   (blocks do not nest).
 * - A condition is alternatives split by `|`, each a comma list that must all hold. A term is
 *   `terminal` or `machine` (the prompt profile), `memory` (the notebook is on), or a tool name;
 *   `!term` negates it.
 *
 * Tools count when the turn declares them, deferred ones included, so loading a deferred tool
 * never changes the system prompt (the cached prefix stays byte-identical).
 */

export interface GateContext {
  tools: ReadonlySet<string>
  profile: "terminal" | "machine"
  memory: boolean
}

const LINE = /\s*<!--\s*khi:\s*([^>]*?)\s*-->\s*$/
const OPEN = /^\s*<!--\s*khi:\s*([^>]*?)\s*-->\s*$/
const CLOSE = /^\s*<!--\s*\/khi\s*-->\s*$/

function term(raw: string, ctx: GateContext): boolean {
  const negate = raw.startsWith("!")
  const name = negate ? raw.slice(1).trim() : raw
  const value =
    name === "terminal" || name === "machine" ? ctx.profile === name : name === "memory" ? ctx.memory : ctx.tools.has(name)
  return negate ? !value : value
}

/** Whether a `khi:` condition holds; with no context every condition holds (the widest prompt). */
export function holds(condition: string, ctx: GateContext | undefined): boolean {
  if (!ctx) return true
  return condition.split("|").some((alt) => alt.split(",").map((t) => t.trim()).filter(Boolean).every((t) => term(t, ctx)))
}

/**
 * The prompt text for this turn: lines whose condition fails are dropped, every marker is removed.
 * Without a context every line is kept (used to size the widest prompt a role can get).
 */
export function gate(text: string, ctx: GateContext | undefined): string
export function gate(text: string | undefined, ctx: GateContext | undefined): string | undefined
export function gate(text: string | undefined, ctx: GateContext | undefined): string | undefined {
  if (text === undefined) return undefined
  const out: string[] = []
  let block: boolean | undefined
  for (const line of text.split("\n")) {
    const open = OPEN.exec(line)
    if (open) {
      if (block !== undefined) throw new Error("prompt gate: <!-- khi: … --> blocks do not nest")
      block = holds(open[1]!, ctx)
      continue
    }
    if (CLOSE.test(line)) {
      if (block === undefined) throw new Error("prompt gate: <!-- /khi --> without an open block")
      block = undefined
      continue
    }
    if (block === false) continue
    const inline = LINE.exec(line)
    if (inline) {
      if (holds(inline[1]!, ctx)) out.push(line.slice(0, inline.index))
      continue
    }
    out.push(line)
  }
  if (block !== undefined) throw new Error("prompt gate: <!-- khi: … --> block not closed")
  return out.join("\n")
}
