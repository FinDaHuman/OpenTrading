/**
 * Permission modes (Shift+Tab cycles them, as in Claude Code):
 * - `read-only` (‖ chỉ đọc, the default): reads run; a local file write or shell command asks
 *   each time, with "switch to ▸" as one of the answers.
 * - `ask` (▸ sửa có hỏi): every write or command asks; "this session" covers a folder.
 * - `auto` (▸▸ tự động): a classifier decides instead of the user (permission/auto).
 * - `bypass` (▸▸▸ bỏ qua quyền, Claude Code's bypass permissions mode): nothing asks, no classifier
 *   request either. Only a session started with `--yolo` has it; config and resume never turn
 *   it on. Deny rules, ask rules, blocked calls and the user-only scopes (key files, tool
 *   config folders, outside the workspace, the loop guard) still stop or ask.
 */

export type PermissionMode = "read-only" | "ask" | "auto" | "bypass"

export const MODE_LABEL: Record<PermissionMode, string> = {
  "read-only": "‖ chỉ đọc",
  ask: "▸ sửa có hỏi",
  auto: "▸▸ tự động",
  bypass: "▸▸▸ bỏ qua quyền",
}

/** The flags that start a session in ▸▸▸ bypass (Codex `--yolo`, Claude Code's long name). */
export const YOLO_FLAGS = ["--yolo", "--dangerously-skip-permissions"]

/** The next mode for Shift+Tab: ‖ → ▸ → ▸▸ (→ ▸▸▸ when started with --yolo) → ‖. */
export function cycleMode(mode: PermissionMode, opts: { auto?: boolean; bypass?: boolean } = {}): PermissionMode {
  const order: PermissionMode[] = ["read-only", "ask"]
  if (opts.auto !== false) order.push("auto")
  if (opts.bypass) order.push("bypass")
  return order[(order.indexOf(mode) + 1) % order.length] ?? "read-only"
}

/**
 * The mode a session opens in (config `permissions.defaultMode`). ▸▸ auto that the user never
 * said yes to (set by hand, or picked in /config) opens as ▸ instead; the TUI then asks.
 */
export function startMode(permissions: { defaultMode?: string; autoAcknowledged?: boolean } | undefined): PermissionMode {
  const mode = permissions?.defaultMode
  if (mode === "auto") return permissions?.autoAcknowledged === true ? "auto" : "ask"
  return mode === "ask" ? "ask" : "read-only"
}

/** The mode line of the `<quyen_tep>` reminder: what the model may expect when it writes. */
/**
 * `present`: the registered tools (the ‖ line names only write tools it holds). `profile`: a program
 * caller (`--profile machine`) gets the short ▸▸▸ line: the long one speaks to a person who chose
 * --yolo, and it rides in every request of the turn (issue #309).
 */
export function modeNote(mode: PermissionMode, present?: ReadonlySet<string>, profile?: "terminal" | "machine"): string {
  if (mode === "read-only") {
    // Name only the write tools the registry holds (`present`; without it, all of them).
    const writers = ["write_file", "edit_file"].filter((name) => !present || present.has(name))
    if (writers.length === 0)
      return "Permission mode: ‖ read-only. Running commands (shell) needs the user's approval each time in a dialog, except commands that only compute numbers or only list workspace directories."
    return `Permission mode: ‖ read-only. Writing files (${writers.join(", ")}) and running commands (shell) need the user's approval each time in a dialog, except commands that only compute numbers or only list workspace directories; still call these tools when the user wants a file created or changed, rather than pasting the content into the answer.`
  }
  if (mode === "ask") return "Permission mode: ▸ ask before changes. The user approves every file write or command in a dialog (they may allow a whole folder, or one command, for the session)."
  if (mode === "bypass" && profile === "machine")
    return "Permission mode: ▸▸▸ bypass (the caller is a program): commands and write tools run immediately, nobody approves them. Do not delete or overwrite existing data, do not send data out, do not place real orders or move money; if refused, do not do the same thing another way."
  if (mode === "bypass")
    return "Permission mode: ▸▸▸ bypass. The user runs you with --yolo: file writes, commands and write tools run immediately, nobody approves them. So be careful yourself: do only what was asked, do not delete or overwrite existing data, do not send data out, do not place real orders or move money unless the user said so explicitly. The user's block rules, key files, config folders (.git, .opentrading…) and anything outside the workspace still need the user; if refused, do not do the same thing another way."
  return "Permission mode: ▸▸ auto. The user chose to let you work continuously without asking at each step: a model approves each action on the user's behalf. Go ahead with the routine work the user asked for (reading, creating files in the workspace, running scripts you wrote). Do not delete or overwrite existing data, send data out, or place real orders or move money unless the user said exactly that. If an action is blocked, follow the instructions in the result: do not do the same thing with another tool, command or subagent; carry on with work that does not depend on it; if it is essential, stop, say why and let the user decide."
}
