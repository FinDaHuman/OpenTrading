import { countChars, MEMORY_LIMITS, type LimitKey } from "../limits"
import {
  refName,
  type AnyDraft,
  type ConstraintDraft,
  type DecisionDraft,
  type LessonDraft,
  type ThesisDraft,
} from "./drafts"

/**
 * What a form shows about its own fields, computed without the store: which fields differ between two
 * drafts (before an edit is saved, and on a conflict), and each field's length against the store's limit.
 * Lengths are counted exactly as the store counts them (NFC, trimmed, user-perceived characters), so
 * the form refuses what the store would; if the two ever disagree, the store's refusal is what shows.
 */

export type FormGroup = "constraint" | "thesis" | "lesson" | "decision"

export interface DraftField {
  field: string
  label: string
  value: string
  limit?: LimitKey
}

const CONFIDENCE_LABEL: Record<string, string> = { low: "thấp", medium: "vừa", high: "cao" }

/** Every field of a draft in form order, as text. Lists are one field per item, plus the joined list. */
export function draftFields(group: FormGroup, draft: AnyDraft): DraftField[] {
  switch (group) {
    case "constraint": {
      const d = draft as ConstraintDraft
      return [{ field: "text", label: "Văn bản", value: d.text, limit: d.kind === "style" ? "styleTotal" : "constraintItem" }]
    }
    case "thesis": {
      const d = draft as ThesisDraft
      return [
        { field: "text", label: "Văn bản", value: d.text, limit: "thesisText" },
        ...d.conditions.map(
          (value, i): DraftField => ({ field: `conditions.${i}`, label: `Điều kiện ${i + 1}`, value, limit: "thesisCondition" }),
        ),
        { field: "reviewBy", label: "Hạn xem lại", value: d.reviewBy ?? "" },
        { field: "detail", label: "Chi tiết", value: d.detail ?? "", limit: "thesisDetail" },
      ]
    }
    case "lesson": {
      const d = draft as LessonDraft
      return [
        { field: "title", label: "Tiêu đề", value: d.title, limit: "lessonTitle" },
        { field: "summary", label: "Tóm tắt", value: d.summary, limit: "lessonSummary" },
        { field: "appliesTo", label: "Áp dụng cho", value: d.appliesTo.map(refName).join(", ") },
        { field: "exceptions", label: "Ngoại lệ", value: d.exceptions ?? "", limit: "lessonExceptions" },
        { field: "detail", label: "Chi tiết", value: d.detail ?? "", limit: "lessonDetail" },
        { field: "tags", label: "Tag", value: d.tags.join(", ") },
      ]
    }
    case "decision": {
      const d = draft as DecisionDraft
      return [
        { field: "action", label: "Việc", value: d.action, limit: "decisionAction" },
        { field: "reason", label: "Lý do", value: d.reason, limit: "decisionReason" },
        { field: "expectation", label: "Kỳ vọng", value: d.expectation ?? "", limit: "decisionExpectation" },
        { field: "confidence", label: "Mức tự tin", value: d.confidence ? CONFIDENCE_LABEL[d.confidence]! : "" },
        { field: "reviewOn", label: "Ngày xem lại", value: d.reviewOn ?? "" },
        { field: "changeMind", label: "Điều gì làm đổi ý", value: d.changeMind ?? "", limit: "decisionChangeMind" },
      ]
    }
  }
}

/** A value as the store would keep it, so spaces around it or another Unicode form are not a change. */
const normal = (value: string) => value.normalize("NFC").trim()

export interface FieldChange {
  field: string
  label: string
  before: string
  after: string
}

/** Only the fields that differ; conditions are compared by position, a missing one reads as empty. */
export function fieldChanges(group: FormGroup, before: AnyDraft, after: AnyDraft): FieldChange[] {
  if (group === "thesis") {
    // Same number of condition fields on both sides: an added or removed one compares against "".
    const n = Math.max((before as ThesisDraft).conditions.length, (after as ThesisDraft).conditions.length)
    const pad = (d: ThesisDraft) => ({ ...d, conditions: Array.from({ length: n }, (_, i) => d.conditions[i] ?? "") })
    before = pad(before as ThesisDraft)
    after = pad(after as ThesisDraft)
  }
  const a = draftFields(group, before)
  const b = draftFields(group, after)
  const changes: FieldChange[] = []
  b.forEach((y, i) => {
    const was = normal(a[i]!.value)
    const now = normal(y.value)
    if (was !== now) changes.push({ field: y.field, label: y.label, before: was, after: now })
  })
  if (group === "constraint") {
    const k1 = (before as ConstraintDraft).kind
    const k2 = (after as ConstraintDraft).kind
    if (k1 && k2 && k1 !== k2) changes.unshift({ field: "kind", label: "Ngăn", before: KIND_LABEL[k1], after: KIND_LABEL[k2] })
  }
  return changes
}

const KIND_LABEL = { constraint: "Ràng buộc", style: "Cách trình bày" } as const

export interface FieldCount {
  field: string
  label: string
  count: number
  max: number
  over: boolean
}

const counted = (field: string, label: string, count: number, limit: LimitKey): FieldCount => {
  const max = MEMORY_LIMITS[limit].max
  return { field, label, count, max, over: count > max }
}

/**
 * Per-field counts, list sizes, and for constraints and styles the total of the active ones after this
 * save (`activeChars` leaves out the entry being edited, as the store does).
 */
export function fieldCounts(group: FormGroup, draft: AnyDraft, totals?: { activeChars: number }): FieldCount[] {
  const out = draftFields(group, draft)
    .filter((f) => f.limit)
    .map((f) => counted(f.field, f.label, countChars(normal(f.value)), f.limit!))
  if (group === "constraint" && totals) {
    const d = draft as ConstraintDraft
    const style = d.kind === "style"
    out.push(
      counted(
        "total",
        style ? "Tổng cách trình bày" : "Tổng ràng buộc",
        totals.activeChars + countChars(normal(d.text)),
        style ? "styleTotal" : "constraintTotal",
      ),
    )
  }
  if (group === "thesis") {
    out.push(counted("conditions", "Số điều kiện", (draft as ThesisDraft).conditions.length, "thesisConditions"))
  }
  if (group === "lesson") {
    const d = draft as LessonDraft
    d.tags.forEach((t, i) => out.push(counted(`tags.${i}`, `Tag ${i + 1}`, countChars(normal(t)), "lessonTag")))
    out.push(counted("tagCount", "Số tag", d.tags.length, "lessonTags"))
    out.push(counted("appliesToCount", "Số chủ đề áp dụng", d.appliesTo.length, "lessonAppliesTo"))
  }
  return out
}
