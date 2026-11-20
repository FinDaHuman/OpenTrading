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
  queued: "queued",
  running: "running",
  completed: "done",
  failed: "failed",
  stopped: "stopped",
}

export const NOTE =
  "This is the harness's automatic notice that a background subagent finished, not the user's words. The user has not seen this result: if it relates to what they are asking, summarise it for them (keeping sources and times)."

/** Kept for sessions saved before the English runtime text migration. */
const LEGACY_NOTE =
  "Đây là thông báo tự động của harness khi một subagent chạy nền kết thúc, không phải lời người dùng. Người dùng chưa thấy kết quả này: nếu liên quan tới việc họ đang hỏi thì tóm tắt cho họ (giữ nguồn và thời điểm)."

export function notificationText(view: SubagentView): string {
  const tokens = view.usage.input + view.usage.output
  const seconds = Math.round(((view.endedAt ?? Date.now()) - (view.startedAt ?? view.createdAt)) / 1000)
  const result = view.status === "completed" ? view.text || "(the subagent gave no answer)" : [view.error ? `Error: ${view.error}` : "", view.text].filter(Boolean).join("\n\n") || "(no result)"
  return [
    `<${NOTICE_TAG}>`,
    `agent_id: ${view.id} · type: ${view.type} · description: ${view.description} · status: ${STATUS[view.status]}`,
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
  const pattern = new RegExp(`<${NOTICE_TAG}>\\nagent_id: (\\S+) · (?:type|loại): (\\S+) · (?:description|mô tả): (.*?) · (?:status|trạng thái): ([^\\n]+)\\n[\\s\\S]*?\\n([^\\n]*)\\n</${NOTICE_TAG}>`, "g")
  let rest = text.replace(pattern, (_m, agentId, type, description, status, stats) => {
    notices.push({ agentId, type, description, status, stats })
    return ""
  })
  // Desk runs notify the same way, one block per run (desk/notification.ts).
  rest = rest.replace(new RegExp(DESK_NOTICE_PATTERN.source, "g"), (_m, runId, playbook, status, stats) => {
    notices.push({ agentId: runId, type: "ultradesk", description: playbook, status, stats })
    return ""
  })
  if (notices.length > 0) rest = rest.replace(NOTE, "").replace(LEGACY_NOTE, "")
  return { notices, rest: rest.trim() }
}
