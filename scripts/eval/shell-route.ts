import { classifyOutcome } from "../../src/core/loop/failures"
import { MATH_NEAR_MISS_PREFIX } from "../../src/core/tools/shell/shell"

/**
 * What became of one `shell` call (issue #268 asked for these counts before a merge):
 * - "math": ran as an arithmetic-only command, no approval in any mode.
 * - "read-only": ran, and the command only lists or prints state.
 * - "approved": ran any other command (a rule, an approval, or bypass let it).
 * - "near-miss": refused as arithmetic in a form the grammar does not take, with the form to use.
 * - "denied": needed an approval nobody could give, or a rule or the classifier blocked it.
 * - "error": never started for another reason (bad arguments, a missing folder).
 */
export const SHELL_TOOL = "shell"

export type ShellRoute = "math" | "read-only" | "approved" | "near-miss" | "denied" | "error"

export const SHELL_ROUTES: ShellRoute[] = ["math", "read-only", "approved", "near-miss", "denied", "error"]

/** Routes where the command really ran. */
export const RAN: ReadonlySet<ShellRoute> = new Set(["math", "read-only", "approved"])

export interface ShellCall {
  /** The scope the tool gave the gate (`math:…`, `read:…`, `cmd:…`). */
  scope?: string
  /** The command only reads (the tool's own `autoSafe`). */
  readOnly: boolean
  /** The tool's `execute` was reached. */
  executed: boolean
  ok: boolean
  /** What the model was shown. */
  visible: string
}

export function shellRoute(call: ShellCall): ShellRoute {
  if (call.executed) {
    if (call.scope?.startsWith("math:")) return "math"
    return call.readOnly || call.scope?.startsWith("read:") ? "read-only" : "approved"
  }
  if (call.visible.startsWith(MATH_NEAR_MISS_PREFIX)) return "near-miss"
  return classifyOutcome(call.ok, call.visible) === "denied" ? "denied" : "error"
}

/** The run time the shell tool writes in its first line: `[mã thoát 0 · 0.3s · /cwd]`. */
export function shellExecMs(visible: string): number | undefined {
  const m = /^\[[^\]\n]*? · (\d+(?:\.\d+)?)s · /.exec(visible)
  return m ? Math.round(Number(m[1]) * 1000) : undefined
}
