import { DESK_NOTICE_PATTERN } from "../desk/notification"
import { groupDigits } from "./result"
import type { AgentStatus, SubagentView } from "./types"

/**
 * A background subagent's result reaches the main agent as a user-role message (Claude
 * Code's <task-notification>): queued while an answer runs, sent on its own when idle, or
 * put in front of the user's next message.
 */
export const NOTICE_TAG = "thong_bao_subagent"

const STATUS: Record<AgentStatus, string> = {
  queued: "đang chờ",
  running: "đang chạy",
  completed: "xong",
  failed: "lỗi",
  stopped: "đã dừng",
}

export const NOTE =
  "Đây là thông báo tự động của harness khi một subagent chạy nền kết thúc, không phải lời người dùng. Người dùng chưa thấy kết quả này: nếu liên quan tới việc họ đang hỏi thì tóm tắt cho họ (giữ nguồn và thời điểm)."

export function notificationText(view: SubagentView): string {
  const tokens = view.usage.input + view.usage.output
  const seconds = Math.round(((view.endedAt ?? Date.now()) - (view.startedAt ?? view.createdAt)) / 1000)
  const result = view.status === "completed" ? view.text || "(subagent không trả lời)" : [view.error ? `Lỗi: ${view.error}` : "", view.text].filter(Boolean).join("\n\n") || "(không có kết quả)"
  return [
    `<${NOTICE_TAG}>`,
    `agent_id: ${view.id} · loại: ${view.type} · mô tả: ${view.description} · trạng thái: ${STATUS[view.status]}`,
    `<ket_qua>\n${result}\n</ket_qua>`,
    `${view.toolCount} tool · ${groupDigits(tokens)} token · ${seconds}s`,
    `</${NOTICE_TAG}>`,
  ].join("\n")
}

/** Several notifications (and the note once) as one message. */
export const noticesMessage = (texts: string[]) => `${texts.join("\n\n")}\n${NOTE}`

export interface ParsedNotice {
  agentId: string
  type: string
  description: string
  status: string
  stats: string
}

/**
 * A stored user message split into its notifications and what the user typed (resume
 * shows notifications as their own lines, never as "❯" text).
 */
export function splitNotices(text: string): { notices: ParsedNotice[]; rest: string } {
  const notices: ParsedNotice[] = []
  const pattern = new RegExp(`<${NOTICE_TAG}>\\nagent_id: (\\S+) · loại: (\\S+) · mô tả: (.*?) · trạng thái: ([^\\n]+)\\n[\\s\\S]*?\\n([^\\n]*)\\n</${NOTICE_TAG}>`, "g")
  let rest = text.replace(pattern, (_m, agentId, type, description, status, stats) => {
    notices.push({ agentId, type, description, status, stats })
    return ""
  })
  // Desk runs notify the same way, one block per run (desk/notification.ts).
  rest = rest.replace(new RegExp(DESK_NOTICE_PATTERN.source, "g"), (_m, runId, playbook, status, stats) => {
    notices.push({ agentId: runId, type: "ultradesk", description: playbook, status, stats })
    return ""
  })
  if (notices.length > 0) rest = rest.replace(NOTE, "")
  return { notices, rest: rest.trim() }
}
