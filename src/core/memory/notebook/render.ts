import type { ConstraintLine } from "../binding/constraints"
import { labelledList } from "../binding/render"
import { escapeMemoryLine, escapeMemoryText } from "./escape"

/**
 * Every text the notebook provider sends: the system part, the index, labelled blocks, reminders.
 * Formats are fixed byte for byte (same data, same bytes) so prompt caching holds and a block in a saved
 * session reads exactly as the model saw it. Stored text goes through escape.ts and never starts a line.
 */

export const THESIS_STATE_LABEL: Readonly<Record<string, string>> = {
  watching: "đang theo dõi",
  refuted: "đã bị bác bỏ",
  closed: "đã đóng",
}
/** A thesis state as blocks and notes print it. */
export const stateLabel = (state: string) => THESIS_STATE_LABEL[state] ?? escapeMemoryLine(state)

// Vietnam has no daylight saving time, so a fixed offset gives the same day on every machine, with no
// dependence on the time zone data a runtime ships.
export const VIETNAM_OFFSET_MS = 7 * 3_600_000

/**
 * dd/mm/yyyy: a stored instant as the Vietnamese calendar day, or a stored calendar day as is. A value
 * that is not a date (a file damaged outside the app) is shown as stored, escaped, never guessed.
 */
export function formatDate(value: string): string {
  const ms = new Date(value).getTime()
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(ms)) return escapeMemoryLine(value)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(ms + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)
  const [y, m, d] = day.split("-")
  return `${d}/${m}/${y}`
}

export type { ConstraintLine }

/**
 * The system part: the guide, then style in full. The constraints are not here: memory/binding sends
 * them to every agent in their own block, whatever memory is switched to, so they go out exactly once.
 */
export function renderInstructions(guide: string, styles: readonly ConstraintLine[]): string {
  const body = labelledList("Cách trình bày người dùng muốn:", styles)
  return body.length === 0 ? guide : `${guide}\n\n${body.join("\n")}`
}

export interface IndexThesis {
  subjectId: number
  display: string
  sectorDisplay?: string
  state: string
}
export interface IndexLesson {
  id: number
  title: string
}

const INDEX_HEADER = "[Sổ ghi nhớ · mục lục · người dùng tự ghi]"

function thesisName(t: IndexThesis) {
  const notes = [
    t.sectorDisplay === undefined ? undefined : escapeMemoryLine(t.sectorDisplay),
    t.state === "watching" ? undefined : stateLabel(t.state),
  ].filter((n) => n !== undefined)
  return escapeMemoryLine(t.display) + (notes.length > 0 ? ` (${notes.join(", ")})` : "")
}

function indexText(theses: readonly IndexThesis[], lessons: readonly IndexLesson[], t: number, l: number) {
  const lines = [INDEX_HEADER]
  if (t > 0) lines.push(`Luận điểm: ${theses.slice(theses.length - t).map(thesisName).join(" · ")}`)
  if (t < theses.length) lines.push(`… còn ${theses.length - t} luận điểm`)
  if (l > 0) {
    const names = lessons.slice(lessons.length - l).map((x) => `#${x.id} ${escapeMemoryLine(x.title)}`)
    lines.push(`Bài học: ${names.join(" · ")}`)
  }
  if (l < lessons.length) lines.push(`… còn ${lessons.length - l} bài, tìm bằng memory_read`)
  lines.push("Đọc nội dung: memory_read")
  return lines.join("\n")
}

/**
 * Names only, by id. Over `maxChars` the longer list loses its oldest entry (lowest id, listed first) until
 * it fits, and the rest is counted: the newest entries stay in view and the core never has to cut the
 * index mid-entry.
 */
export function renderIndex(
  theses: readonly IndexThesis[],
  lessons: readonly IndexLesson[],
  maxChars: number,
): string | undefined {
  if (theses.length === 0 && lessons.length === 0) return undefined
  let t = theses.length
  let l = lessons.length
  for (;;) {
    const text = indexText(theses, lessons, t, l)
    if (text.length <= maxChars || (t === 0 && l === 0)) return text
    if (l >= t && l > 0) l--
    else t--
  }
}

export interface ThesisBlockData {
  subjectId: number
  display: string
  version: number
  text: string
  conditions: readonly string[]
  reviewBy?: string
  state: string
  validFrom: string
  detail?: string
}

// Users often start each condition with "Sai nếu"; the block's field label already says it.
const WRONG_IF = /^\s*sai\s+nếu\s*:?\s*/iu
const condition = (c: string) => c.normalize("NFC").replace(WRONG_IF, "") || c

export function renderThesisBlock(
  t: ThesisBlockData,
  opts: { sector?: { display: string; version: number }; replaces?: number; detail?: boolean },
): string {
  const replaces = opts.replaces === undefined ? "" : ` · thay cho bản ${opts.replaces} đã gửi trước đó trong phiên`
  const lines = [
    `[Memory · luận điểm · ${escapeMemoryLine(t.display)} · bản ${t.version} · ghi ${formatDate(t.validFrom)} · người dùng tự ghi${replaces}]`,
    `Trạng thái: ${stateLabel(t.state)}`,
    escapeMemoryText("Luận điểm: ", t.text),
  ]
  if (t.conditions.length > 0) {
    lines.push(escapeMemoryText("Sai nếu: ", t.conditions.map((c, i) => `(${i + 1}) ${condition(c)}`).join("; ")))
  }
  if (t.reviewBy) lines.push(`Hạn xem lại: ${formatDate(t.reviewBy)}`)
  if (opts.sector) {
    lines.push(
      `Liên quan: luận điểm ngành ${escapeMemoryLine(opts.sector.display)} (bản ${opts.sector.version}), đọc bằng memory_read`,
    )
  }
  if (opts.detail && t.detail) lines.push(escapeMemoryText("Chi tiết: ", t.detail))
  return lines.join("\n")
}

export interface LessonBlockData {
  id: number
  version: number
  title: string
  summary: string
  appliesToDisplay: readonly string[]
  exceptions?: string
  detail?: string
  tags: readonly string[]
  createdAt: string
}

export function renderLessonBlock(l: LessonBlockData): string {
  const names = (list: readonly string[]) => list.map(escapeMemoryLine).join(", ")
  const lines = [
    `[Memory · bài học · #${l.id} · bản ${l.version} · ghi ${formatDate(l.createdAt)} · người dùng tự ghi]`,
    escapeMemoryText("Tiêu đề: ", l.title),
    escapeMemoryText("Tóm tắt: ", l.summary),
  ]
  if (l.appliesToDisplay.length > 0) lines.push(`Áp dụng cho: ${names(l.appliesToDisplay)}`)
  if (l.exceptions) lines.push(escapeMemoryText("Ngoại lệ: ", l.exceptions))
  if (l.detail) lines.push(escapeMemoryText("Chi tiết: ", l.detail))
  if (l.tags.length > 0) lines.push(`Tag: ${names(l.tags)}`)
  return lines.join("\n")
}

/** The label line of a block: what proves the block reached the history. */
export const labelOf = (block: string) => block.split("\n", 1)[0]!

const NOTE = "[Memory · nhắc]"

/** One-line notes about items already sent this session, and pointers to blocks not injected. */
export const reminders = {
  lessonDeleted: (id: number) => `${NOTE} Bài học #${id} đã bị người dùng xoá; không dùng nội dung #${id} phía trên nữa.`,
  lessonNewVersion: (id: number, version: number, old: number) =>
    `${NOTE} Bài học #${id} đã có bản ${version}; bản ${old} phía trên đã cũ. Đọc bằng memory_read nếu cần.`,
  thesisDeleted: (name: string) => {
    const n = escapeMemoryLine(name)
    return `${NOTE} Luận điểm ${n} đã bị người dùng xoá; không dùng nội dung luận điểm ${n} phía trên nữa.`
  },
  thesisNewVersion: (name: string, version: number, old: number) =>
    `${NOTE} Luận điểm ${escapeMemoryLine(name)} đã có bản ${version}; bản ${old} phía trên đã cũ. Đọc bằng memory_read nếu cần.`,
  thesisState: (name: string, version: number, state: string) =>
    `${NOTE} Luận điểm ${escapeMemoryLine(name)} (bản ${version}) đã chuyển sang trạng thái: ${stateLabel(state)}.`,
  roomless: (name: string, version: number) =>
    `${NOTE} Luận điểm ${escapeMemoryLine(name)} (bản ${version}) chưa chèn ở lượt này vì hết chỗ; đọc bằng memory_read.`,
  tooLong: (name: string, version: number) =>
    `${NOTE} Luận điểm ${escapeMemoryLine(name)} (bản ${version}) dài hơn giới hạn tự chèn; đọc bằng memory_read.`,
  indexThesisAdded: (name: string) =>
    `${NOTE} Sổ có thêm luận điểm ${escapeMemoryLine(name)}, chưa có trong mục lục; đọc bằng memory_read nếu cần.`,
  indexLessonAdded: (id: number) => `${NOTE} Sổ có thêm bài học #${id}, chưa có trong mục lục; đọc bằng memory_read nếu cần.`,
  storeError: (reason: string) => `[Memory · lỗi] Kho memory không mở được: ${reason}.`,
}

/*
 * What stands in for a block in the history. `name` is the thesis name exactly as the block's label
 * printed it (already escaped), since the mask is built from the history, never from the store.
 */

/** A block of an item the store confirmed deleted: replaces it in the history for good. */
export const maskedLesson = (id: number) => `[Memory · bài học #${id} đã bị người dùng xoá]`
export const maskedThesis = (name: string) => `[Memory · luận điểm ${name} đã bị người dùng xoá]`

/**
 * A block that could not be checked against the store (no store, unreadable, or its content differs from
 * the stored version): masked only in what is sent, never in the history. It does not say "deleted",
 * which nothing proved.
 */
export const heldLesson = (id: number, version: number) =>
  `[Memory · bài học #${id} · bản ${version} tạm che: chưa đối chiếu được với kho]`
export const heldThesis = (name: string, version: number) =>
  `[Memory · luận điểm ${name} · bản ${version} tạm che: chưa đối chiếu được với kho]`

/**
 * memory_read's answer when the very version asked for is already in what the model sees at this step.
 * It points at the block by its label, not by turn: the model is never shown turn numbers.
 */
export const alreadyShown = {
  lesson: (id: number, version: number) =>
    `Bài học #${id} bản ${version} đã có phía trên trong hội thoại, ở khối có nhãn [Memory · bài học · #${id} · bản ${version} · …]; nội dung không đổi.`,
  thesis: (name: string, version: number) =>
    `Luận điểm ${name} bản ${version} đã có phía trên trong hội thoại, ở khối có nhãn [Memory · luận điểm · ${name} · bản ${version} · …]; nội dung không đổi.`,
}
