import type { NotebookEntry, NotebookGroup } from "./admin"
import type { AnyDraft, ConstraintDraft, LessonDraft } from "./drafts"
import { draftFields, type FormGroup } from "./form-model"
import { foldName } from "./topics"

/**
 * Warnings a form shows before saving. None blocks a save: a pattern cannot know the user's intent, so a
 * wrong warning costs one key press while a block would stop a legitimate entry. Each pattern table is a
 * fixed list; adding a pattern is one line plus one test case. Messages name the pattern, never the text.
 */

export type WarningKind = "hard_rule" | "figure" | "duplicate"

export interface DraftWarning {
  kind: WarningKind
  field: string
  message: string
  duplicateOf?: { group: NotebookGroup; id: number }
}

const NOT_WORD = String.raw`(?<![\p{L}\p{N}])`
const END = String.raw`(?![\p{L}\p{N}])`
const phrase = (p: string) => new RegExp(NOT_WORD + p.replace(/ /g, String.raw`\s+`) + END, "u")

/**
 * A hard rule saved as a lesson stops being always applied, and nobody is told: the most harmful mix-up
 * between the two sections. Matched on lower-case NFC text with its diacritics; multi-word phrases also
 * on the folded text (typed without diacritics). "cấm" has no folded form: folded it is "cảm", "cám" too.
 */
const HARD_RULES: readonly { label: string; accented: RegExp; folded?: RegExp }[] = [
  { label: "không bao giờ", accented: phrase("không bao giờ"), folded: phrase("khong bao gio") },
  { label: "tuyệt đối không", accented: phrase("tuyệt đối không"), folded: phrase("tuyet doi khong") },
  { label: "cấm", accented: phrase("cấm") },
  { label: "không được", accented: phrase("không được"), folded: phrase("khong duoc") },
  // A position cap ("tối đa 15% danh mục"), with or without "danh mục" and a space before "%".
  {
    label: "tối đa … %",
    accented: new RegExp(NOT_WORD + String.raw`tối\s+đa\s*\d+(?:[.,]\d+)?\s*%`, "u"),
    folded: new RegExp(NOT_WORD + String.raw`toi\s+da\s*\d+(?:[.,]\d+)?\s*%`, "u"),
  },
]

/**
 * Prices and forecasts: the notebook is not a data source, and a stale price read back as a fact is a made
 * up number. Numbers and percentages alone are thresholds ("biên gộp dưới 10%"), so only a number with a
 * currency unit, or a price or forecast phrase, warns.
 */
const FIGURES: readonly RegExp[] = [
  new RegExp(String.raw`\d[\d.,]*\s*(?:đồng|đ|vnđ|vnd|nghìn|ngàn|k|triệu|tỷ|tỉ)` + END, "u"),
  phrase("giá mục tiêu"),
  phrase("giá hiện tại"),
  phrase("dự báo"),
  phrase("sẽ lên"),
  phrase("sẽ xuống"),
  phrase("sẽ đạt"),
]

const FIGURE_MESSAGE =
  "Có vẻ đây là giá hoặc dự báo. Sổ ghi nhớ không phải nguồn số liệu; model sẽ lấy số mới bằng tool. " +
  "Vẫn lưu nếu đây là ngưỡng của bạn."

const hardRuleMessage = (label: string) =>
  `Câu này có dạng một luật cứng («${label}»). Bài học chỉ được model đọc khi cần, không luôn được áp dụng. ` +
  "Muốn luôn áp dụng thì lưu thành ràng buộc."

function hardRule(text: string): string | undefined {
  const lower = text.normalize("NFC").toLocaleLowerCase("vi")
  const folded = foldName(text)
  return HARD_RULES.find((r) => r.accented.test(lower) || (r.folded?.test(folded) ?? false))?.label
}

const isFigure = (text: string) => {
  const lower = text.normalize("NFC").toLocaleLowerCase("vi")
  return FIGURES.some((p) => p.test(lower))
}

/** Constraints and styles share one id sequence; lessons have their own. */
const sameTable = (a: NotebookGroup, b: NotebookGroup) => (a === "lesson") === (b === "lesson")

/** The text an entry is compared on: a constraint's or style's whole text, a lesson's title. */
const entryText = (e: NotebookEntry) => e.text ?? e.title

function duplicate(
  group: FormGroup,
  value: string,
  existing: readonly NotebookEntry[],
  self?: { group: NotebookGroup; id: number },
): DraftWarning | undefined {
  const key = foldName(value)
  if (!key) return undefined
  const field = group === "lesson" ? "title" : "text"
  const hit = existing.find(
    (e) =>
      (e.group === "constraint" || e.group === "style" || e.group === "lesson") &&
      !(self && self.id === e.id && sameTable(self.group, e.group)) &&
      foldName(entryText(e)) === key,
  )
  if (!hit) return undefined
  const message =
    hit.group === "constraint"
      ? `Trùng ràng buộc #${hit.id}.`
      : hit.group === "style"
        ? `Trùng cách trình bày #${hit.id}.`
        : group === "lesson"
          ? `Trùng tiêu đề bài học #${hit.id}. Sửa #${hit.id} trong /memory thay vì tạo mới?`
          : `Trùng tiêu đề bài học #${hit.id}.`
  return { kind: "duplicate", field, message, duplicateOf: { group: hit.group, id: hit.id } }
}

/**
 * Warnings for a draft against the notebook's active entries. `self` is the entry being edited, which is
 * not its own duplicate.
 */
export function draftWarnings(
  group: FormGroup,
  draft: AnyDraft,
  existing: readonly NotebookEntry[],
  self?: { group: NotebookGroup; id: number },
): DraftWarning[] {
  const out: DraftWarning[] = []
  if (group === "lesson") {
    const d = draft as LessonDraft
    for (const [field, text] of [["title", d.title], ["summary", d.summary]] as const) {
      const label = hardRule(text)
      if (label) out.push({ kind: "hard_rule", field, message: hardRuleMessage(label) })
    }
  }
  for (const f of draftFields(group, draft)) {
    if (f.field === "appliesTo" || f.field === "tags" || f.field === "confidence") continue
    if (isFigure(f.value)) out.push({ kind: "figure", field: f.field, message: FIGURE_MESSAGE })
  }
  const compared =
    group === "constraint" ? (draft as ConstraintDraft).text : group === "lesson" ? (draft as LessonDraft).title : undefined
  const dup = compared === undefined ? undefined : duplicate(group, compared, existing, self)
  if (dup) out.push(dup)
  return out
}
