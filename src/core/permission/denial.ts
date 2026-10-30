import type { AgentOrigin } from "../tools/types"

/**
 * What the model reads when a call does not run. Line 1 is the summary (the TUI shows it as the
 * row); the guidance follows after a blank line. Rules, after Claude Code's auto-mode denial and
 * Codex's guardian:
 * - every denial says not to reach the same effect through another tool or command (shell
 *   blocked → not write_file, an MCP tool, a script or a subagent instead), only a clearly safer
 *   way that does not have that effect;
 * - a block by auto mode, a deny rule or a missing UI also says: go on with independent work,
 *   then stop and explain what was needed, why, and how the USER can allow it (the model must
 *   not touch the permission settings itself: that is a hard deny);
 * - a plain "no" from the user keeps asking the user what to do instead (the turn's flow after
 *   a refusal does not change);
 * - a subagent cannot ask the user: it reports the block in its result.
 */

/** A classifier verdict carried to the denial: the rule's label (already in Vietnamese) and the reason. */
export interface AutoBlock {
  label?: string
  reason: string
}

export interface DenyInfo {
  reason?: "user" | "cancelled" | "headless" | "rule" | "blocked" | "classifier" | "unsaved"
  /** The user's note when denying, or why it is blocked. */
  message?: string
  /** Auto mode blocked this call (directly, or before handing it to the user). */
  auto?: AutoBlock
}

export const AUTO_BLOCK_PREFIX = "Auto mode chặn "
export const USER_DENY_PREFIX = "Người dùng từ chối chạy tool này"
export const RULE_DENY_PREFIX = "Quy tắc chặn của người dùng"
export const USER_NOTE = "Lời nhắn của người dùng: "

const NO_WORKAROUND =
  "Đừng làm đúng việc này bằng tool hay lệnh khác (write_file, edit_file, tool MCP, subagent, script, lệnh viết lại): như vậy là lách quyết định này, và cũng sẽ bị chặn. " +
  "Chỉ được chọn cách an toàn hơn hẳn mà không gây ra tác dụng đó (ví dụ ghi ra file mới thay vì ghi đè, hoặc đưa lệnh để người dùng tự chạy)."

const THEN_STOP =
  "Còn việc khác không phụ thuộc vào hành động này thì làm tiếp. Nếu nó bắt buộc để xong yêu cầu: làm hết phần còn lại, rồi DỪNG và nói với người dùng bạn định làm gì, vì sao cần, và cách họ cho phép; để người dùng quyết."

const THEN_REPORT =
  "Bạn là subagent, không hỏi được người dùng: làm tiếp phần việc không phụ thuộc vào hành động này, rồi ghi rõ trong kết quả việc nào bị chặn, lý do, và vì sao cần nó, để agent chính báo người dùng."

const ALLOW_AUTO =
  "Cách cho phép (người dùng tự làm; bạn đừng tự sửa cấu hình quyền): /permissions → chọn lần chặn → r để chạy lại một lần; nói rõ trong tin nhắn đúng hành động và đối tượng của nó; chuyển sang ▸ sửa có hỏi (Shift+Tab) để tự duyệt; hoặc thêm luật autoMode.allow trong ~/.opentrading/config.json."

const ALLOW_RULE = "Cách cho phép (người dùng tự làm; bạn đừng tự sửa cấu hình quyền): bỏ hoặc sửa luật đó trong /permissions."

/** "Lý do." with one final period whatever the classifier wrote. */
const sentence = (text: string) => `${text.trim().replace(/[.。\s]+$/, "")}.`

const labelled = (block: AutoBlock) => `${block.label ? ` [${block.label}]` : ""}: ${sentence(block.reason)}`

const paragraphs = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join("\n\n")

/** What comes after a block the model must not work around: independent work, then stop (or report, in a subagent). */
const afterBlock = (agent: AgentOrigin | undefined) => (agent ? THEN_REPORT : THEN_STOP)

/** What the model reads when the classifier blocks. */
export function blockedMessage(tool: string, block: AutoBlock, agent?: AgentOrigin) {
  return paragraphs(`${AUTO_BLOCK_PREFIX}${tool}${labelled(block)}`, NO_WORKAROUND, afterBlock(agent), ALLOW_AUTO)
}

/** The error the model reads when a call does not run. `tool` is the model-visible name. */
export function deniedMessage(decision: DenyInfo, opts: { tool?: string; agent?: AgentOrigin } = {}) {
  const tool = opts.tool ?? "tool này"
  switch (decision.reason) {
    case "cancelled":
      return "Lời gọi tool đã bị huỷ."
    case "unsaved":
      return `Không chạy được: ${decision.message ?? "chưa lưu được quyền"}.`
    case "classifier":
      return blockedMessage(tool, decision.auto ?? { reason: "khớp một luật chặn của auto mode" }, opts.agent)
    case "headless":
      // Auto mode blocked it and wanted the user to decide, but nobody can be asked: it is a block.
      if (decision.auto) return blockedMessage(tool, decision.auto, opts.agent)
      return paragraphs("Lời gọi này cần người dùng xác nhận, nhưng không có giao diện để hỏi. Không chạy.", NO_WORKAROUND, afterBlock(opts.agent))
    case "blocked":
      return paragraphs(`Không chạy được: ${decision.message ?? "lời gọi này bị chặn"}. Đừng thử lại cùng cách.`, NO_WORKAROUND)
    case "rule":
      return paragraphs(`${RULE_DENY_PREFIX} (permissions.deny) không cho chạy ${tool}.`, NO_WORKAROUND, afterBlock(opts.agent), ALLOW_RULE)
    default: {
      const why = decision.auto ? ` (auto mode đã chặn${labelled(decision.auto).replace(/\.$/, "")})` : ""
      const note = decision.message ? ` ${USER_NOTE}${decision.message}` : ""
      const next = decision.message ? undefined : opts.agent ? "Ghi việc bị từ chối vào kết quả." : "Đừng thử lại cùng lời gọi; hỏi người dùng muốn làm gì khác."
      return paragraphs(`${USER_DENY_PREFIX}${why}.${note}`, next, NO_WORKAROUND)
    }
  }
}

/** The user's note in a denial the model read (the TUI's one-line summary). */
export function userNoteOf(text: string): string | undefined {
  const at = text.indexOf(USER_NOTE)
  if (at < 0) return undefined
  const rest = text.slice(at + USER_NOTE.length)
  const end = rest.indexOf("\n\n")
  return (end < 0 ? rest : rest.slice(0, end)).trim() || undefined
}
