import type { PermissionGate } from "../../src/core/permission"

/**
 * Nobody watches an eval, and a gate that is not interactive refuses every call that asks
 * before any responder hears of it, so `web_fetch` would fail on every new domain and the run
 * would measure a harness that cannot read a page.
 *
 * What may pass is a list, not "read-only": `read_file` is read-only too, and asks for paths
 * outside the workspace, which an unattended model must not reach. The loop guard's question
 * arrives under the tool's own name, with its own scope, and is refused like any other.
 */
const ALLOWED_ONCE = new Set(["web_fetch"])
const LOOP_SCOPE = "lap-lai"

/** Answer every approval by the list above. Returns the function that stops answering. */
export function answerUnattended(gate: PermissionGate, who: string) {
  gate.interactive = true
  const stop = gate.onChange((head) => {
    if (!head) return
    const allowed = ALLOWED_ONCE.has(head.tool) && head.scope !== LOOP_SCOPE && head.choices.includes("once")
    void gate.respond(head.id, allowed ? "once" : "deny", `${who}: không có người duyệt`)
  })
  return () => {
    stop()
    gate.interactive = false
  }
}
