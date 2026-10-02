/**
 * Approval gate for actions the model may trigger but must not perform silently —
 * the harness-side twin of opencode's permission `ask` flow. The model requests
 * (e.g. switch_preset), a UI handler shows a dialog, and the user decides.
 *
 * Without a handler (scripts, tests) every request is allowed once: nothing to show
 * a dialog to, and the user explicitly asked for allow-by-default in that setting.
 */

export type Decision = "once" | "always" | "deny"

export interface ApprovalRequest {
  /** Stable category, e.g. "preset-switch". */
  kind: string
  /** One-line question shown in the dialog. */
  title: string
  /** Extra context (what changes, which server…). */
  detail?: string
  /** Cache key for an "always" decision; defaults to `${kind}:${detail ?? ""}`. */
  key?: string
}

type Handler = (request: ApprovalRequest) => Promise<Decision>

let handler: Handler | undefined
const alwaysAllowed = new Set<string>()

/** Register the UI handler; returns an unregister function. */
export function setApprovalHandler(next: Handler) {
  handler = next
  return () => {
    if (handler === next) handler = undefined
  }
}

/** "always" persists for the process (session-scoped, like opencode's session permission). */
export function isAlwaysAllowed(key: string) {
  return alwaysAllowed.has(key)
}

export function resetApprovals() {
  alwaysAllowed.clear()
  handler = undefined
}

/** Ask the user (or the cache, or the allow-by-default headless path). */
export async function requestApproval(request: ApprovalRequest): Promise<Decision> {
  const key = request.key ?? `${request.kind}:${request.detail ?? ""}`
  if (alwaysAllowed.has(key)) return "always"
  if (!handler) return "once"
  const decision = await handler(request)
  if (decision === "always") alwaysAllowed.add(key)
  return decision
}
