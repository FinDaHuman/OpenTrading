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
  quota: "The model's daily quota is exhausted: no new agents run.",
  agents: "The run hit its agent cap (desk.maxAgents).",
  requests: "The run hit its request cap (desk.maxRequests).",
  rate: "The model kept reporting rate limits (429): the run stopped; continue later with /desk resume.",
  stop: "The run was stopped.",
}

/** The result block is capped so one run cannot flood the main context. */
export const MAX_RESULT_CHARS = 20_000

const STATUS: Record<DeskRunStatus, string> = {
  running: "running",
  paused: "paused",
  done: "done",
  partial: "partly done",
  failed: "failed",
  stopped: "stopped",
}

export const DESK_NOTE =
  "This is the harness's automatic notice that an ultradesk run finished, not the user's words. The user has not seen the result: present it to them, keeping data sources and times, and say clearly which parts are unverified or cut."

/** Kept for sessions saved before the English runtime text migration. */
const LEGACY_DESK_NOTE =
  "Đây là thông báo tự động của harness khi một run ultradesk kết thúc, không phải lời người dùng. Người dùng chưa thấy kết quả: trình bày cho họ, giữ nguồn và thời điểm dữ liệu, và nói rõ phần chưa kiểm chứng hoặc bị cắt."

function resultText(view: DeskRunView) {
  if (view.result === undefined) return view.error ? `Error: ${view.error}` : "(no result)"
  const raw = typeof view.result === "string" ? view.result : JSON.stringify(view.result, null, 2)
  const text = cleanText(raw)
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (${groupDigits(text.length - MAX_RESULT_CHARS)} characters cut)` : text
}

/** A stored desk notice, for transcript lines on resume (subagents/notification.ts splitNotices). */
export const DESK_NOTICE_PATTERN = new RegExp(
  `<${DESK_TAG}>\\nrun_id: (\\S+) · playbook: (\\S+) · (?:size|quy mô): \\S+ · (?:status|trạng thái): ([^\\n]+)\\n[\\s\\S]*?\\n([^\\n]*)\\n</${DESK_TAG}>(?:\\n${escape(DESK_NOTE)}|\\n${escape(LEGACY_DESK_NOTE)})?`,
  "g",
)

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Longest list of the agents that answered without some of their sources. */
const MAX_GAPS_CHARS = 1000

/**
 * Agents that answered but whose tools failed for some sources (#325). A typed answer looks
 * complete whatever is missing, so the notice names the gaps for the main agent to state.
 */
function gapsText(view: DeskRunView) {
  const gapped = view.agents.filter((a) => (a.status === "done" || a.status === "cached") && a.dataGaps?.length)
  if (gapped.length === 0) return undefined
  let list = gapped.map((a) => `${a.label} (${a.dataGaps!.join(", ")})`).join("; ")
  if (list.length > MAX_GAPS_CHARS) list = `${list.slice(0, MAX_GAPS_CHARS)}… (+${gapped.length} agents in all)`
  return `Missing data: ${gapped.length} agents answered without some sources because those tools failed, so the parts built on them are incomplete — say so, do not fill them in: ${list}.`
}

export function deskNotification(view: DeskRunView): string {
  const c = view.counters
  const failed = view.agents.filter((a) => a.status === "failed").length
  const skipped = view.agents.filter((a) => a.status === "skipped").length
  const seconds = Math.round(((view.endedAt ?? Date.now()) - view.createdAt) / 1000)
  const lines = [
    `<${DESK_TAG}>`,
    `run_id: ${view.id} · playbook: ${view.playbook} · size: ${view.size} · status: ${STATUS[view.status]}`,
  ]
  if (view.cut && view.cut !== "stop") lines.push(`Cut short: ${CUT_TEXT[view.cut]} Continue: /desk resume ${view.id}`)
  if (failed + skipped > 0) lines.push(`${failed} agents failed, ${skipped} agents did not run (their results are "unverified", not "wrong").`)
  const gaps = gapsText(view)
  if (gaps) lines.push(gaps)
  lines.push(`<ket_qua>\n${resultText(view)}\n</ket_qua>`)
  lines.push(`${c.agents} agents (${c.cached} reused from the journal) · ${groupDigits(c.requests)} request · ${groupDigits(c.input + c.output)} token · ${seconds}s`)
  lines.push(`</${DESK_TAG}>`)
  return lines.join("\n")
}
