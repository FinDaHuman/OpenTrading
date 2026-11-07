import { escapeMemoryText } from "../notebook/escape"
import type { ConstraintLine, SourceFailure } from "./constraints"

/**
 * Every text of the turn binding: the constraint block (same bytes for the main agent and every
 * sub-agent, same as the notebook used to send), the note to the model when the user ran without a
 * source, and what the user or the main agent is told when a turn is held.
 */

export type BoundSource = "profile" | "constraints"

/** Why a turn was not sent. */
export type TurnHold =
  | { kind: "unreadable"; profile?: SourceFailure; constraints?: SourceFailure }
  | { kind: "too-large"; model: string }

export const CONSTRAINT_HEADING = "Ràng buộc của người dùng (người dùng tự ghi, luôn áp dụng):"

/**
 * A heading, then one "- [#id · bản N] text" line per entry, escaped; nothing at all for no entry. The one
 * format of the constraint block and of the notebook's style list, so both read the same to the model.
 */
export function labelledList(heading: string, items: readonly ConstraintLine[]): string[] {
  if (items.length === 0) return []
  return [heading, ...items.map((c) => escapeMemoryText(`- [#${c.id} · bản ${c.version}] `, c.text))]
}

/** With no constraint there is no heading at all: an empty list could read as "the user set no limits". */
export function renderConstraints(lines: readonly ConstraintLine[]): string | undefined {
  return lines.length === 0 ? undefined : labelledList(CONSTRAINT_HEADING, lines).join("\n")
}

const has = (sources: readonly BoundSource[], s: BoundSource) => sources.includes(s)

function sourceNames(sources: readonly BoundSource[]) {
  const profile = has(sources, "profile")
  const constraints = has(sources, "constraints")
  if (profile && constraints) return { note: "Hồ sơ nhà đầu tư và ràng buộc của người dùng", label: "hồ sơ và ràng buộc" }
  if (profile) return { note: "Hồ sơ nhà đầu tư của người dùng", label: "hồ sơ" }
  return { note: "Ràng buộc của người dùng", label: "ràng buộc" }
}

/** A fixed sentence from the code (not prompt content): the model must not read a missing source as "no limits". */
export function unreadNote(sources: readonly BoundSource[]): string {
  return (
    `${sourceNames(sources).note} không nạp được ở lượt này; người dùng đã chọn chạy tiếp. ` +
    "Không giả định người dùng không có giới hạn nào."
  )
}

export function waiveLabel(sources: readonly BoundSource[]): string {
  return `Chạy lượt này không có ${sourceNames(sources).label}`
}

/** /context: a source the next turn could not read; it would be held, not sent without it. */
export function unreadableLine(source: BoundSource, reason: string): string {
  return `Không đọc được ${source === "profile" ? "hồ sơ nhà đầu tư" : "ràng buộc"} (${reason}); lượt sau sẽ bị hoãn.`
}

export function stillApplyLine(count: number): string {
  return `${count} ràng buộc vẫn áp dụng khi tắt Sổ ghi nhớ. Bật Sổ ghi nhớ để xem, sửa hoặc xoá.`
}

/** A lasting store error gets a way out; the app itself never deletes or repairs the file. */
function wayOut(failure: SourceFailure | undefined): string[] {
  if (!failure?.lasting) return []
  const move = "nếu không cần các ràng buộc trong kho này nữa, chuyển file trên ra chỗ khác."
  return [
    failure.newerSchema ? `Cách xử lý: dùng phiên bản OpenTrading mới hơn; hoặc, ${move}` : `Cách xử lý: ${move}`,
    "OpenTrading không tự xoá hay sửa file này.",
  ]
}

export function holdMessage(hold: TurnHold, role: "main" | "subagent"): string {
  if (hold.kind === "too-large") {
    return role === "main"
      ? `Chưa gửi: ràng buộc của bạn không vừa ngữ cảnh của model ${hold.model}. Chọn model khác trong /model.`
      : `Agent con không chạy: ràng buộc của người dùng không vừa ngữ cảnh của model ${hold.model}. ` +
          "Chọn model có ngữ cảnh lớn hơn cho loại agent này."
  }
  if (role === "subagent") {
    // A sub-agent never reads the profile; its result goes to the main agent, not to the user's screen.
    const reason = hold.constraints?.reason ?? hold.profile?.reason ?? "lỗi không rõ"
    return `Agent con không chạy: không đọc được ràng buộc của người dùng (${reason}).`
  }
  const parts: string[] = []
  if (hold.profile) parts.push(`không đọc được hồ sơ nhà đầu tư (INVESTOR.md): ${hold.profile.reason}`)
  if (hold.constraints) {
    parts.push(`không đọc được ràng buộc trong kho memory (${hold.constraints.file}): ${hold.constraints.reason}`)
  }
  return [`Chưa gửi câu hỏi: ${parts.join("; ")}.`, ...wayOut(hold.constraints)].join("\n")
}
