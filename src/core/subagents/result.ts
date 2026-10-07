import type { ModelMessage } from "ai"
import type { AgentStatus, SubagentResult } from "./types"

export const META_TAG = "subagent_meta"

const STATUS_TEXT: Record<AgentStatus, string> = {
  queued: "đang chờ",
  running: "đang chạy",
  completed: "xong",
  failed: "lỗi",
  stopped: "đã dừng",
}

/** 18234 → "18.234" (Vietnamese thousands separator). */
export const groupDigits = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")

/** Compact token count for the UI: 850, 12,3k, 123k. */
export function fmtTokens(n: number) {
  if (n < 1000) return String(Math.round(n))
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "").replace(".", ",")}k`
  return `${Math.round(n / 1000)}k`
}

export const fmtSeconds = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`)

/** Text of the last assistant message that has any (the subagent's report). */
export function lastAssistantText(messages: readonly ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role !== "assistant") continue
    const text =
      typeof m.content === "string"
        ? m.content
        : m.content
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("\n")
    if (text.trim()) return text.trim()
  }
  return ""
}

export interface Trailer {
  agentId: string
  type: string
  status: string
  tools: number
  tokens: number
  seconds: number
}

/**
 * What the parent model reads: the report, then a metadata block (Claude Code appends
 * agentId, total_tokens, tool_uses, duration_ms). The block sits at the end so output
 * truncation (head + tail) keeps it.
 */
export function formatResult(agent: { id: string; type: string }, result: SubagentResult): string {
  const tokens = result.usage.input + result.usage.output
  const body =
    result.status === "failed"
      ? `⚠ Subagent gặp lỗi giữa chừng: ${result.error ?? "không rõ"}. Kết quả dưới đây có thể thiếu.\n\n${result.text}`
      : result.status === "stopped"
        ? `(Subagent đã bị dừng; kết quả dưới đây có thể thiếu.)\n\n${result.text}`
        : result.text || "(Subagent không trả lời. Hãy tự tổng kết từ dữ liệu đã có.)"
  const meta = [
    `agent_id: ${agent.id} · loại: ${agent.type} · trạng thái: ${STATUS_TEXT[result.status]}`,
    `${result.toolCount} tool · ${groupDigits(tokens)} token · ${Math.round(result.durationMs / 1000)}s`,
    "Người dùng không thấy kết quả này: hãy trình bày lại các điểm cần thiết (giữ nguồn).",
  ]
  return `${body}\n\n<${META_TAG}>\n${meta.join("\n")}\n</${META_TAG}>`
}

/** The metadata block of a stored result (resume), or undefined for old or foreign output. */
export function parseTrailer(output: string | undefined): Trailer | undefined {
  if (!output) return undefined
  const m = new RegExp(
    `<${META_TAG}>\\nagent_id: (\\S+) · loại: (\\S+) · trạng thái: ([^\\n]+)\\n(\\d+) tool · ([\\d.]+) token · (\\d+)s`,
  ).exec(output)
  if (!m) return undefined
  return {
    agentId: m[1]!,
    type: m[2]!,
    status: m[3]!,
    tools: Number(m[4]),
    tokens: Number(m[5]!.replace(/\./g, "")),
    seconds: Number(m[6]),
  }
}

/** The report without the metadata block (what ctrl+o shows as "Kết quả"). */
export const stripTrailer = (output: string) => output.replace(new RegExp(`\\n*<${META_TAG}>[\\s\\S]*</${META_TAG}>\\s*$`), "")
