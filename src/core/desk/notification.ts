import { groupDigits } from "../subagents/result"
import { cleanText } from "./sanitize"
import type { DeskRunStatus, DeskRunView } from "./types"

/**
 * A finished desk run reaches the main agent as ONE user-role message, like a background
 * subagent's <thong_bao_subagent>. Its agents never notify one by one.
 */
export const DESK_TAG = "thong_bao_desk"

/** Why a run ended early, for its log and its notice. */
export const CUT_TEXT: Record<NonNullable<DeskRunView["cut"]>, string> = {
  quota: "Hết quota ngày của model: không chạy thêm agent mới.",
  agents: "Đã chạm trần số agent của run (desk.maxAgents).",
  requests: "Đã chạm trần số request của run (desk.maxRequests).",
  rate: "Model liên tục báo giới hạn tốc độ (429): dừng run, chạy tiếp sau bằng /desk resume.",
  stop: "Run đã bị dừng.",
}

/** The result block is capped so one run cannot flood the main context. */
export const MAX_RESULT_CHARS = 20_000

const STATUS: Record<DeskRunStatus, string> = {
  running: "đang chạy",
  paused: "tạm dừng",
  done: "xong",
  partial: "xong một phần",
  failed: "lỗi",
  stopped: "đã dừng",
}

export const DESK_NOTE =
  "Đây là thông báo tự động của harness khi một run ultradesk kết thúc, không phải lời người dùng. Người dùng chưa thấy kết quả: trình bày cho họ, giữ nguồn và thời điểm dữ liệu, và nói rõ phần chưa kiểm chứng hoặc bị cắt."

function resultText(view: DeskRunView) {
  if (view.result === undefined) return view.error ? `Lỗi: ${view.error}` : "(không có kết quả)"
  const raw = typeof view.result === "string" ? view.result : JSON.stringify(view.result, null, 2)
  const text = cleanText(raw)
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (cắt bớt ${groupDigits(text.length - MAX_RESULT_CHARS)} ký tự)` : text
}

/** A stored desk notice, for transcript lines on resume (subagents/notification.ts splitNotices). */
export const DESK_NOTICE_PATTERN = new RegExp(
  `<${DESK_TAG}>\\nrun_id: (\\S+) · playbook: (\\S+) · quy mô: \\S+ · trạng thái: ([^\\n]+)\\n[\\s\\S]*?\\n([^\\n]*)\\n</${DESK_TAG}>(?:\\n${escape(DESK_NOTE)})?`,
  "g",
)

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function deskNotification(view: DeskRunView): string {
  const c = view.counters
  const failed = view.agents.filter((a) => a.status === "failed").length
  const skipped = view.agents.filter((a) => a.status === "skipped").length
  const seconds = Math.round(((view.endedAt ?? Date.now()) - view.createdAt) / 1000)
  const lines = [
    `<${DESK_TAG}>`,
    `run_id: ${view.id} · playbook: ${view.playbook} · quy mô: ${view.size} · trạng thái: ${STATUS[view.status]}`,
  ]
  if (view.cut && view.cut !== "stop") lines.push(`Bị cắt: ${CUT_TEXT[view.cut]} Chạy tiếp: /desk resume ${view.id}`)
  if (failed + skipped > 0) lines.push(`${failed} agent lỗi, ${skipped} agent không chạy (kết quả của chúng là "chưa kiểm chứng", không phải "sai").`)
  lines.push(`<ket_qua>\n${resultText(view)}\n</ket_qua>`)
  lines.push(`${c.agents} agent (${c.cached} lấy lại từ journal) · ${groupDigits(c.requests)} request · ${groupDigits(c.input + c.output)} token · ${seconds}s`)
  lines.push(`</${DESK_TAG}>`)
  return lines.join("\n")
}
