import type { Playbook } from "./types"

/**
 * The opt-in word, like Claude Code's `ultracode`: typed in a prompt, that request may run a
 * playbook without being asked to first (when the playbook was approved before). It counts
 * only in what the user typed — not in pasted text, @file contents, MCP prompt templates or
 * harness notices.
 */
export const DESK_KEYWORD = "ultradesk"

// Case-insensitive; a letter, digit or _ on either side makes it part of another word.
const PATTERN = new RegExp(`(^|[^\\p{L}\\p{N}_])${DESK_KEYWORD}($|[^\\p{L}\\p{N}_])`, "iu")

export function hasDeskKeyword(text: string): boolean {
  return PATTERN.test(text)
}

/** Where the keyword sits in `text` (for highlighting), or undefined. */
export function deskKeywordRange(text: string): { start: number; end: number } | undefined {
  const m = PATTERN.exec(text)
  if (!m) return undefined
  const start = m.index + m[1]!.length
  return { start, end: start + DESK_KEYWORD.length }
}

/** How a request came to allow desk runs: the keyword, the session mode, or a /<playbook> command. */
export type DeskOptIn = "keyword" | "session" | "command"

const WHY: Record<DeskOptIn, string> = {
  keyword: "The user typed ultradesk in this request",
  session: "Ultradesk mode is on for the whole session (/desk on)",
  command: "The user ran a playbook command",
}

/**
 * The transcript line when the user asked for ultradesk in a message (keyword or /<playbook>)
 * and the turn ended without desk_run: the model judged no playbook fits, or ignored the
 * reminder (weak models often do). Without it nothing on screen says no run started.
 */
export function deskSkippedNote(optIn: DeskOptIn, playbooks: Playbook[]): string {
  const commands = playbooks.map((p) => `/${p.meta.name}`).join(" · ")
  return optIn === "command"
    ? `ultradesk: model không gọi desk_run nên playbook chưa chạy. Thử lại, hoặc dùng model gọi tool tốt hơn (/model).`
    : `ultradesk: model không chạy playbook nào cho yêu cầu này (không khớp playbook, hoặc model bỏ qua). Chạy thẳng một playbook: ${commands} <yêu cầu>; /desk xem các run.`
}

/** The reminder for a request with desk runs allowed: what the playbooks are for, and how to start one. */
export function deskReminder(optIn: DeskOptIn, playbooks: Playbook[]): string {
  const list = playbooks.map((p) => `- ${p.meta.name.replace(/-/g, "_")}: ${p.meta.whenToUse.replace(/\s+/g, " ").trim()}`).join("\n")
  const scope =
    optIn === "session"
      ? "For a large research request that fits a playbook, run it with desk_run; answer small questions as usual."
      : "If the request fits a playbook, call desk_run and fill that playbook's key (e.g. sang_loc) with arguments matching its schema. If no playbook fits, work as usual and say briefly why."
  return [
    `${WHY[optIn]}. ${scope}`,
    "The run works in the background; its result arrives later in <thong_bao_desk>. After calling desk_run, only say briefly that the run is going (see /desk); do not redo the run's work yourself.",
    "When a skill hint does the same job as a playbook (e.g. comparing several tickers), run the playbook instead of orchestrating the skill yourself.",
    list ? `Playbooks:\n${list}` : "No playbooks yet.",
  ].join("\n")
}
