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
  keyword: "Người dùng gõ ultradesk trong yêu cầu này",
  session: "Chế độ ultradesk đang bật cho cả phiên (/desk on)",
  command: "Người dùng chạy lệnh playbook",
}

/** The reminder for a request with desk runs allowed: what the playbooks are for, and how to start one. */
export function deskReminder(optIn: DeskOptIn, playbooks: Playbook[]): string {
  const list = playbooks.map((p) => `- ${p.meta.name.replace(/-/g, "_")}: ${p.meta.whenToUse.replace(/\s+/g, " ").trim()}`).join("\n")
  const scope =
    optIn === "session"
      ? "Với yêu cầu nghiên cứu lớn khớp một playbook, chạy nó bằng desk_run; câu hỏi nhỏ thì trả lời bình thường."
      : "Nếu yêu cầu khớp một playbook, gọi desk_run và điền key của playbook đó (ví dụ sang_loc) bằng tham số đúng schema. Không khớp playbook nào thì làm như bình thường và nói ngắn vì sao."
  return [
    `${WHY[optIn]}. ${scope}`,
    "Run chạy nền; kết quả về sau trong <thong_bao_desk>. Sau khi gọi desk_run, chỉ báo ngắn là run đang chạy (xem /desk), không tự làm lại việc của run.",
    "Có gợi ý skill làm cùng việc với một playbook (ví dụ so sánh nhiều mã) thì chạy playbook, thay vì tự điều phối theo skill.",
    list ? `Playbook:\n${list}` : "Chưa có playbook nào.",
  ].join("\n")
}
