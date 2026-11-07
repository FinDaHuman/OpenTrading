import path from "node:path"
import { countChars } from "../limits"
import { MemoryStoreError } from "../store/errors"
import type { MemoryReader, MemoryWriter } from "../store/open"
import { aliasKey } from "../store/subjects"
import { checkCount, optionalText, requiredText, textList } from "../store/text"
import type {
  ConstraintKind,
  ConstraintVersion,
  DecisionInput,
  LessonInput,
  LessonVersion,
  Source,
  Subject,
  ThesisInput,
  ThesisVersion,
} from "../store/types"
import type { MemoryProvider } from "../types"
import {
  constraintToDraft,
  lessonToDraft,
  thesisToDraft,
  toStoreDay,
  type AnyDraft,
  type ConstraintDraft,
  type DecisionDraft,
  type LessonDraft,
  type NewSubjectDraft,
  type ThesisDraft,
} from "./drafts"
import { renderNotebookMarkdown, writeNotebookExport } from "./export"
import { formatDate, THESIS_STATE_LABEL } from "./render"

/**
 * The user's handle on the notebook, for the /memory screen and the notebook forms: the user's own read
 * (every kind, decisions included), the reads that fill a form, and every write, each checked against the
 * version on screen. It is an object capability: the provider handed to the agent loop holds no reference
 * to it, and only code that imports this module can look it up (a test checks that only the /memory dialogs
 * and the forms do, outside this folder). Store errors become what the screen says here, and only here.
 */

export type NotebookGroup = "constraint" | "style" | "thesis" | "lesson" | "decision"

export interface NotebookEntry {
  group: NotebookGroup
  /** Thesis: the subject's id. */
  id: number
  /** Absent for decisions (they are appended, never revised). */
  version?: number
  /** One line for the list. */
  title: string
  /** Everything stored, for the detail view (plain text: a screen, not a prompt). */
  detail: string
  state?: string
  createdAt: string
  /** What duplicates are checked on: a constraint's or style's whole text, a lesson's title. */
  text?: string
}

export type RemoveResult =
  | { ok: true; message: string }
  | { ok: false; reason: "conflict" | "busy" | "deleted" | "failed"; message: string; currentVersion?: number }

/** A read that fills a form: a failed read says why, it never comes back empty ("nothing there yet"). */
export type Read<T> = { ok: true; value: T } | { ok: false; message: string }

export interface SubjectLookup {
  found?: Subject
  /** The current thesis of `found`, if it has one. */
  thesis?: ThesisVersion
  /** `found` had a thesis that was deleted: its last version number, so the rewrite says "bản trước đã xoá". */
  deletedUpTo?: number
  /** Not found, but the code was once an alias of this subject (a renamed ticker). */
  retired?: { subjectId: number; display: string; retiredAt: string }
}

/** A subject made during one save, before a later step of that save failed. */
export interface CreatedSubject {
  /** Which field of the form asked for it: the main subject, its new sector, or one "áp dụng cho" entry. */
  role: "subject" | "sector" | "applies_to"
  /** For "applies_to": the index of the entry in LessonDraft.appliesTo. */
  index?: number
  id: number
  display: string
  /**
   * For "subject": every alias it must end up with, the main code last (the store names a subject by its
   * newest alias). A later step may have failed before all were added; sending them back adds the missing ones.
   */
  aliases?: string[]
}

/** An existing subject; `aliases` (from a partial result) are added if missing. */
export type SubjectTarget = { id: number; aliases?: readonly string[] }

export type SaveFailure = "deleted" | "busy" | "invalid" | "limit" | "secret" | "alias_taken" | "failed"

export type SaveResult =
  | { ok: true; message: string; saved: { id: number; version?: number } }
  | { ok: false; reason: "conflict"; message: string; current: AnyDraft & { version: number; id?: number } }
  | {
      ok: false
      reason: SaveFailure
      message: string
      /** The field the store named, when it named one. */
      field?: string
      /** Some subjects were created before the failing step: the form now treats them as existing ones. */
      partial?: { message: string; created: CreatedSubject[] }
    }

export type ThesisStateChoice = "watching" | "refuted" | "closed"

export interface NotebookAdmin {
  readonly path: string
  /** Why the notebook cannot be read or changed now, if it cannot. */
  problem(): string | undefined
  entries(): NotebookEntry[]
  remove(group: NotebookGroup, key: { id: number; version?: number }): RemoveResult

  lookupSubject(alias: string): Read<SubjectLookup>
  subject(id: number): Read<SubjectLookup>
  sectors(): Read<{ id: number; display: string }[]>
  constraintDraft(id: number): Read<{ id: number; version: number; kind: ConstraintKind; text: string }>
  lessonDraft(id: number): Read<LessonDraft & { id: number; version: number }>
  /** Characters of a kind's active entries, leaving out the one being edited. */
  activeConstraintChars(kind: ConstraintKind, except?: number): Read<number>

  saveConstraint(draft: ConstraintDraft, edit?: { id: number; expected: number }): SaveResult
  /** `expected`: the thesis version the form opened on, null when it opened on "no thesis". */
  saveThesis(subject: SubjectTarget | NewSubjectDraft, expected: number | null, draft: ThesisDraft): SaveResult
  saveLesson(draft: LessonDraft, edit?: { id: number; expected: number }): SaveResult
  saveDecision(subject: SubjectTarget | NewSubjectDraft, draft: DecisionDraft): SaveResult
  setThesisState(subjectId: number, expected: number, state: ThesisStateChoice): SaveResult
  /** A Markdown copy of the notebook in the exports folder; decisions only when asked for this once. */
  exportMarkdown(opts: { decisions: boolean }): Promise<{ ok: true; file: string } | { ok: false; message: string }>
}

/** What lifecycle.ts hands over: the store's user side, while it is open. */
export interface AdminSide {
  readonly path: string
  reader(): MemoryReader | undefined
  writer(): MemoryWriter | undefined
  problem(): MemoryStoreError | undefined
  closed(): boolean
}

const admins = new WeakMap<object, NotebookAdmin>()

/** Called by lifecycle.ts when it opens a notebook; once per provider. */
export function grantNotebookAdmin(provider: MemoryProvider, admin: NotebookAdmin): void {
  if (admins.has(provider)) throw new Error("This notebook already has an admin handle")
  admins.set(provider, admin)
}

/** The handle for a notebook provider; undefined for any other memory (off, the legacy file memory). */
export function notebookAdmin(memory: MemoryProvider): NotebookAdmin | undefined {
  return admins.get(memory)
}

const SOURCE: Record<Source, string> = {
  manual: "tự ghi",
  card: "từ thẻ gợi ý",
  investor_import: "nhập từ INVESTOR.md",
}
const saved = (version: number | undefined, at: string, source: Source) =>
  `${version === undefined ? "" : `Bản ${version} · `}lưu ${formatDate(at)} · nguồn: ${SOURCE[source]}`
const firstLine = (text: string) => text.split(/\r?\n/, 1)[0]!
const lines = (...parts: (string | false | undefined)[]) => parts.filter((p): p is string => !!p).join("\n")

function readEntries(r: MemoryReader): NotebookEntry[] {
  const out: NotebookEntry[] = []
  for (const kind of ["constraint", "style"] as const) {
    for (const c of r.constraints(kind)) {
      out.push({
        group: kind,
        id: c.id,
        version: c.version,
        title: firstLine(c.text),
        text: c.text,
        detail: lines(c.text, "", saved(c.version, c.createdAt, c.source)),
        createdAt: c.createdAt,
      })
    }
  }
  const subjects = r.subjects()
  const name = (id: number) => subjects.find((s) => s.id === id)?.display ?? `#${id}`
  for (const s of subjects) {
    const t = s.currentVersion === undefined ? undefined : r.thesis(s.id)
    if (!t) continue
    const state = THESIS_STATE_LABEL[s.thesisState] ?? s.thesisState
    out.push({
      group: "thesis",
      id: s.id,
      version: t.version,
      title: s.display,
      state,
      detail: lines(
        `Trạng thái: ${state}`,
        `Luận điểm: ${t.text}`,
        t.conditions.length > 0 && `Sai nếu:\n${t.conditions.map((c, i) => `  (${i + 1}) ${c}`).join("\n")}`,
        t.reviewBy && `Hạn xem lại: ${formatDate(t.reviewBy)}`,
        t.detail && `Chi tiết: ${t.detail}`,
        s.sectorId !== undefined && `Ngành: ${name(s.sectorId)}`,
        `Bí danh: ${s.aliases.filter((a) => !a.retiredAt).map((a) => a.alias).join(", ")}`,
        "",
        saved(t.version, t.validFrom, t.source),
      ),
      createdAt: t.validFrom,
    })
  }
  for (const l of r.lessons()) {
    out.push({
      group: "lesson",
      id: l.id,
      version: l.version,
      title: l.title,
      text: l.title,
      detail: lines(
        `Tiêu đề: ${l.title}`,
        `Tóm tắt: ${l.summary}`,
        l.appliesTo.length > 0 && `Áp dụng cho: ${l.appliesTo.map(name).join(", ")}`,
        l.exceptions && `Ngoại lệ: ${l.exceptions}`,
        l.detail && `Chi tiết: ${l.detail}`,
        l.tags.length > 0 && `Tag: ${l.tags.join(", ")}`,
        "",
        saved(l.version, l.createdAt, l.source),
      ),
      createdAt: l.createdAt,
    })
  }
  for (const d of r.decisions()) {
    if ("deleted" in d) continue
    out.push({
      group: "decision",
      id: d.id,
      title: `D${d.id} ${firstLine(d.action)}`,
      detail: lines(
        `Mã: ${name(d.subjectId)}`,
        `Hành động: ${d.action}`,
        `Lý do: ${d.reason}`,
        d.expectation && `Kỳ vọng: ${d.expectation}`,
        d.confidence && `Độ tin: ${d.confidence}`,
        d.reviewOn && `Xem lại ngày: ${formatDate(d.reviewOn)}`,
        d.changeMind && `Đổi ý khi: ${d.changeMind}`,
        d.basis !== "none" && `Dựa trên luận điểm bản ${d.basis.version}${d.basis.deleted ? " (đã xoá)" : ""}`,
        "",
        saved(undefined, d.createdAt, d.source),
        "Quyết định chỉ nằm trên máy này; không bao giờ được gửi cho model.",
      ),
      createdAt: d.createdAt,
    })
  }
  return out
}

/**
 * What a delete of an item that can sit in a session's history says. Its blocks are masked in the open
 * conversation and on every read of a session; nothing is promised about the disk or the provider's copy.
 */
const deletedFromHistory = (what: string) =>
  `Đã xoá ${what} khỏi ứng dụng. Từ lượt sau, model không còn nhận nội dung này, kể cả trong lịch sử hội thoại và khi mở lại phiên cũ. Câu trả lời trước đó của model có thể đã nhắc lại nội dung này. Bản đã gửi provider không thu hồi được.`
/** Constraints and style only go in the system part, never in the history. */
const deletedFromSystem = (what: string, kind: string) =>
  `Đã xoá ${what} khỏi ứng dụng. Từ lượt sau, model không còn nhận ${kind} này. Bản đã gửi provider không thu hồi được.`

export function createNotebookAdmin(side: AdminSide): NotebookAdmin {
  let readProblem: string | undefined
  const unavailable = () =>
    side.closed()
      ? "Sổ ghi nhớ đã tắt."
      : side.problem()
        ? `Sổ ghi nhớ chưa mở được: ${side.problem()!.message}`
        : undefined

  const reading = <T>(fn: (r: MemoryReader) => T): Read<T> => {
    const reader = side.closed() ? undefined : side.reader()
    if (!reader) return { ok: false, message: unavailable() ?? "Sổ ghi nhớ chưa mở được." }
    try {
      return { ok: true, value: fn(reader) }
    } catch (error) {
      if (!(error instanceof MemoryStoreError)) throw error
      return { ok: false, message: error.message }
    }
  }
  // Writes run only on a confirm key press, never while a screen is drawn or a request is built.
  const writing = (fn: (w: MemoryWriter, r: MemoryReader) => SaveResult): SaveResult => {
    const writer = side.closed() ? undefined : side.writer()
    const reader = side.closed() ? undefined : side.reader()
    if (!writer || !reader) {
      const message = side.closed()
        ? "Sổ ghi nhớ đã tắt; chưa lưu."
        : (unavailable() ?? "Sổ ghi nhớ chưa mở được.") + " Chưa lưu."
      return { ok: false, reason: "failed", message }
    }
    return fn(writer, reader)
  }

  return Object.freeze({
    path: side.path,
    problem: () => unavailable() ?? readProblem,
    entries(): NotebookEntry[] {
      const reader = side.closed() ? undefined : side.reader()
      if (!reader) return []
      try {
        const out = readEntries(reader)
        readProblem = undefined
        return out
      } catch (error) {
        if (!(error instanceof MemoryStoreError)) throw error
        readProblem = error.message
        return []
      }
    },
    remove(group: NotebookGroup, key: { id: number; version?: number }): RemoveResult {
      const writer = side.closed() ? undefined : side.writer()
      const reader = side.reader()
      if (!writer || !reader) {
        return { ok: false, reason: "failed", message: unavailable() ?? "Sổ ghi nhớ chưa mở được." }
      }
      try {
        // Decisions have no version: they are appended, never revised.
        const version = key.version ?? 0
        let message: string
        switch (group) {
          case "constraint":
            writer.deleteConstraint(key.id, version)
            message = deletedFromSystem(`ràng buộc #${key.id}`, "ràng buộc")
            break
          case "style":
            writer.deleteConstraint(key.id, version)
            message = deletedFromSystem(`cách trình bày #${key.id}`, "cách trình bày")
            break
          case "thesis": {
            const display = reader.subject(key.id)?.display ?? `#${key.id}`
            writer.deleteThesis(key.id, version)
            message = deletedFromHistory(`luận điểm ${display}`)
            break
          }
          case "lesson":
            writer.deleteLesson(key.id, version)
            message = deletedFromHistory(`bài học #${key.id}`)
            break
          case "decision":
            writer.deleteDecision(key.id)
            message = `Đã xoá quyết định D${key.id} khỏi ứng dụng. Quyết định chưa bao giờ được gửi cho model.`
            break
        }
        return { ok: true, message }
      } catch (error) {
        // The one place store errors become what the screen says.
        if (!(error instanceof MemoryStoreError)) throw error
        const current = (error.current as { version?: number } | undefined)?.version
        if (error.kind === "conflict" && current !== undefined) {
          return {
            ok: false,
            reason: "conflict",
            currentVersion: current,
            message: `Mục này vừa được sửa ở nơi khác (đang là bản ${current}). Mở lại để xem bản mới.`,
          }
        }
        // A thesis deleted elsewhere shows up as a conflict with nothing current.
        if (error.kind === "conflict" || error.kind === "deleted" || error.kind === "not_found") {
          return { ok: false, reason: "deleted", message: "Mục này đã bị xoá ở nơi khác. Mở lại để xem danh sách mới." }
        }
        if (error.kind === "busy") {
          return { ok: false, reason: "busy", message: "Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại." }
        }
        return { ok: false, reason: "failed", message: error.message }
      }
    },

    lookupSubject(alias: string): Read<SubjectLookup> {
      return reading((r) => {
        const key = aliasKey(alias)
        if (!key) return {}
        const found = r.subjectByAlias(alias)
        if (found) return describe(r, found)
        for (const s of r.subjects()) {
          const old = s.aliases.find((a) => a.retiredAt && aliasKey(a.alias) === key)
          if (old) return { retired: { subjectId: s.id, display: s.display, retiredAt: old.retiredAt! } }
        }
        return {}
      })
    },

    subject(id: number): Read<SubjectLookup> {
      return reading((r) => {
        const found = r.subject(id)
        if (!found) throw new MemoryStoreError("not_found", `Không có chủ đề #${id}.`)
        return describe(r, found)
      })
    },

    sectors() {
      return reading((r) =>
        r
          .subjects()
          .filter((s) => s.kind === "sector")
          .map((s) => ({ id: s.id, display: s.display })),
      )
    },

    constraintDraft(id: number) {
      return reading((r) => {
        const c = r.constraint(id)
        if (!c) throw new MemoryStoreError("not_found", `Không có mục #${id}.`)
        if ("deleted" in c) throw new MemoryStoreError("deleted", `Mục #${id} đã bị xoá.`)
        return constraintToDraft(c)
      })
    },

    lessonDraft(id: number) {
      return reading((r) => {
        const l = r.lesson(id)
        if (!l) throw new MemoryStoreError("not_found", `Không có bài học #${id}.`)
        if ("deleted" in l) throw new MemoryStoreError("deleted", `Bài học #${id} đã bị xoá.`)
        return lessonToDraft(l, nameOf(r))
      })
    },

    activeConstraintChars(kind: ConstraintKind, except?: number) {
      return reading((r) =>
        r
          .constraints(kind)
          .filter((c) => c.id !== except)
          .reduce((sum, c) => sum + countChars(c.text), 0),
      )
    },

    saveConstraint(draft: ConstraintDraft, edit?: { id: number; expected: number }): SaveResult {
      const kind = draft.kind
      if (!kind) {
        return { ok: false, reason: "invalid", field: "ngăn", message: "Chọn ngăn: Ràng buộc hoặc Cách trình bày." }
      }
      return writing((w) => {
        try {
          const saved = edit
            ? w.reviseConstraint(edit.id, edit.expected, { text: draft.text })
            : w.addConstraint({ kind, text: draft.text })
          const what = kind === "constraint" ? "ràng buộc" : "cách trình bày"
          return {
            ok: true,
            message: `Đã lưu ${what} #${saved.id} (bản ${saved.version}). Có hiệu lực từ lượt hỏi kế tiếp.`,
            saved,
          }
        } catch (error) {
          return failure(error, { current: (c) => constraintToDraft(c as ConstraintVersion) })
        }
      })
    },

    saveThesis(subject: SubjectTarget | NewSubjectDraft, expected: number | null, draft: ThesisDraft): SaveResult {
      return writing((w, r) => {
        const created: CreatedSubject[] = []
        try {
          const input = thesisInput(draft)
          if (!("id" in subject)) checkNewSubject(r, subject)
          const id = "id" in subject ? ensureAliases(w, subject) : createSubject(w, subject, created)
          const saved = w.saveThesis(id, expected, input)
          return {
            ok: true,
            message: `Đã lưu luận điểm ${r.subject(id)?.display ?? `#${id}`} bản ${saved.version}.`,
            saved,
          }
        } catch (error) {
          return failure(error, {
            current: (t) => thesisToDraft(t as ThesisVersion),
            created,
            reader: r,
            unsaved: "luận điểm chưa lưu",
          })
        }
      })
    },

    saveLesson(draft: LessonDraft, edit?: { id: number; expected: number }): SaveResult {
      return writing((w, r) => {
        const created: CreatedSubject[] = []
        try {
          const input = lessonInput(draft)
          checkAppliesTo(r, draft)
          // The same new name twice is one subject, created once.
          const made = new Map<string, number>()
          const appliesTo = draft.appliesTo.map((ref, index) => {
            if ("id" in ref) return ref.id
            const alias = refAlias(ref)
            const again = made.get(aliasKey(alias))
            if (again !== undefined) return again
            const { id } = w.createSubject({ kind: ref.kind, alias })
            made.set(aliasKey(alias), id)
            created.push({ role: "applies_to", index, id, display: alias })
            return id
          })
          const saved = edit
            ? w.reviseLesson(edit.id, edit.expected, { ...input, appliesTo })
            : w.addLesson({ ...input, appliesTo })
          return { ok: true, message: `Đã lưu bài học #${saved.id} (bản ${saved.version}).`, saved }
        } catch (error) {
          return failure(error, {
            current: (l) => lessonToDraft(l as LessonVersion, nameOf(r)),
            created,
            reader: r,
            unsaved: "bài học chưa lưu",
          })
        }
      })
    },

    saveDecision(subject: SubjectTarget | NewSubjectDraft, draft: DecisionDraft): SaveResult {
      return writing((w, r) => {
        const created: CreatedSubject[] = []
        const basis = draft.basis === "none" ? undefined : draft.basis.version
        let id = "id" in subject ? subject.id : undefined
        try {
          const input = decisionInput(draft)
          if ("id" in subject) ensureAliases(w, subject)
          else {
            checkNewSubject(r, subject)
            id = createSubject(w, subject, created)
          }
          const saved = w.addDecision({ ...input, subjectId: id!, thesisVersion: basis })
          const display = r.subject(id!)?.display ?? `#${id}`
          const rest = basis === undefined ? "không có luận điểm" : `luận điểm ${display} bản ${basis}`
          return { ok: true, message: `Đã ghi quyết định D${saved.id} (căn cứ: ${rest}).`, saved }
        } catch (error) {
          // The thesis version the form showed went away: say which, and offer the no-thesis choice.
          if (
            error instanceof MemoryStoreError &&
            basis !== undefined &&
            id !== undefined &&
            created.length === 0 &&
            (error.kind === "deleted" || error.kind === "not_found")
          ) {
            const display = r.subject(id)?.display ?? `#${id}`
            return {
              ok: false,
              reason: "deleted",
              message: `Luận điểm ${display} bản ${basis} vừa bị xoá. Ghi quyết định không gắn luận điểm, hoặc huỷ.`,
            }
          }
          return failure(error, { created, reader: r, unsaved: "quyết định chưa ghi" })
        }
      })
    },

    async exportMarkdown(opts: { decisions: boolean }) {
      const reader = side.closed() ? undefined : side.reader()
      if (!reader) return { ok: false as const, message: unavailable() ?? "Sổ ghi nhớ chưa mở được." }
      let entries: NotebookEntry[]
      try {
        entries = readEntries(reader)
      } catch (error) {
        if (!(error instanceof MemoryStoreError)) throw error
        return { ok: false as const, message: error.message }
      }
      const at = new Date()
      // Next to the store: in the app that is the data folder (the same exports/ as /export), never a
      // workspace; in tests, the temp folder.
      const dir = path.join(path.dirname(side.path), "exports")
      try {
        const file = await writeNotebookExport(dir, renderNotebookMarkdown(entries, { decisions: opts.decisions, at }), at)
        return { ok: true as const, file }
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        return { ok: false as const, message: `Không xuất được sổ ghi nhớ: ${why}` }
      }
    },

    setThesisState(subjectId: number, expected: number, state: ThesisStateChoice): SaveResult {
      return writing((w, r) => {
        try {
          w.setThesisState(subjectId, expected, state)
          const display = r.subject(subjectId)?.display ?? `#${subjectId}`
          return {
            ok: true,
            message: `Đã đổi trạng thái luận điểm ${display} thành «${THESIS_STATE_LABEL[state]}».`,
            saved: { id: subjectId, version: expected },
          }
        } catch (error) {
          return failure(error, { current: (t) => thesisToDraft(t as ThesisVersion) })
        }
      })
    },
  })
}

const BUSY = "Kho memory đang bận (cửa sổ OpenTrading khác đang ghi). Thử lại."
const GONE = "Mục này đã bị xoá ở nơi khác."

const nameOf = (r: MemoryReader) => {
  const subjects = r.subjects()
  return (id: number) => subjects.find((s) => s.id === id)?.display ?? `#${id}`
}

function describe(r: MemoryReader, found: Subject): SubjectLookup {
  const thesis = r.thesis(found.id)
  if (thesis) return { found, thesis }
  return found.lastVersion > 0 ? { found, deletedUpTo: found.lastVersion } : { found }
}

// A ticker's code is stored as the store keys aliases: NFC, trimmed, capitals ("hpg" is HPG).
const refAlias = (ref: { newName: string; kind: "ticker" | "sector" }) =>
  ref.kind === "ticker" ? aliasKey(ref.newName) : ref.newName.trim()

function day(label: string, text: string | undefined) {
  const value = toStoreDay(text)
  if (value === "invalid") throw new MemoryStoreError("invalid", `«${label}» phải là ngày dạng DD/MM/YYYY.`)
  return value
}

/*
 * The content checks below are the store's own functions, run before any subject is created: a save that
 * creates a subject and then its content is several transactions, so the content must not fail on input
 * once the subject exists. What can still fail after that (the store busy, an alias taken meanwhile) is
 * reported as `partial`.
 */

function thesisInput(d: ThesisDraft): ThesisInput {
  return {
    text: requiredText("văn bản luận điểm", d.text, "thesisText"),
    detail: optionalText("chi tiết luận điểm", d.detail, "thesisDetail"),
    conditions: textList("điều kiện", d.conditions, "thesisConditions", "thesisCondition"),
    reviewBy: day("hạn xem lại", d.reviewBy),
  }
}

function lessonInput(d: LessonDraft): Omit<LessonInput, "appliesTo"> {
  checkCount("áp dụng cho", d.appliesTo.length, "lessonAppliesTo")
  return {
    title: requiredText("tiêu đề bài học", d.title, "lessonTitle"),
    summary: requiredText("tóm tắt bài học", d.summary, "lessonSummary"),
    exceptions: optionalText("ngoại lệ", d.exceptions, "lessonExceptions"),
    detail: optionalText("chi tiết bài học", d.detail, "lessonDetail"),
    tags: textList("tag", d.tags, "lessonTags", "lessonTag"),
  }
}

function decisionInput(d: DecisionDraft): Omit<DecisionInput, "subjectId" | "thesisVersion"> {
  return {
    action: requiredText("việc", d.action, "decisionAction"),
    reason: requiredText("lý do", d.reason, "decisionReason"),
    expectation: optionalText("kỳ vọng", d.expectation, "decisionExpectation"),
    confidence: d.confidence,
    reviewOn: day("ngày xem lại", d.reviewOn),
    changeMind: optionalText("điều gì làm đổi ý", d.changeMind, "decisionChangeMind"),
  }
}

/** Refused before anything is created; the alias is quoted only after it passed the store's text checks. */
function checkFreeAlias(r: MemoryReader, alias: string) {
  const text = requiredText("bí danh", alias, "alias")
  const owner = r.subjectByAlias(text)
  if (owner) throw new MemoryStoreError("alias_taken", `Bí danh «${text}» đang thuộc chủ đề ${owner.display}.`)
}

const mainAlias = (s: NewSubjectDraft) => (s.kind === "ticker" ? aliasKey(s.alias) : s.alias.trim())

/** What the store would refuse in a lesson's subjects, refused before a new one is created. */
function checkAppliesTo(r: MemoryReader, d: LessonDraft) {
  for (const ref of d.appliesTo) {
    if ("newName" in ref) {
      checkFreeAlias(r, refAlias(ref))
      continue
    }
    const subject = r.subject(ref.id)
    if (!subject) throw new MemoryStoreError("not_found", `Không có chủ đề #${ref.id}.`)
    if (subject.kind === "market") {
      throw new MemoryStoreError("invalid", "Bài học chỉ áp dụng cho chủ đề loại mã hoặc ngành.")
    }
  }
}

/** Adds the aliases a partial save left out; one already on this subject is a no-op in the store. */
function ensureAliases(w: MemoryWriter, target: SubjectTarget): number {
  for (const alias of target.aliases ?? []) w.addAlias(target.id, alias)
  return target.id
}

function checkNewSubject(r: MemoryReader, s: NewSubjectDraft) {
  checkFreeAlias(r, mainAlias(s))
  for (const a of s.otherAliases) checkFreeAlias(r, a)
  if (s.sector && "newName" in s.sector) checkFreeAlias(r, s.sector.newName)
}

/**
 * The subject (and its new sector) for a save; each step is one store transaction and is recorded in
 * `created` as soon as it commits. The main alias is added last: the store shows a subject by the alias
 * added last, so "FPT" (not "FPT Corp") is its name.
 */
function createSubject(w: MemoryWriter, s: NewSubjectDraft, created: CreatedSubject[]): number {
  let sectorId = s.sector && "id" in s.sector ? s.sector.id : undefined
  if (s.sector && "newName" in s.sector) {
    const alias = s.sector.newName.trim()
    sectorId = w.createSubject({ kind: "sector", alias }).id
    created.push({ role: "sector", id: sectorId, display: alias })
  }
  const main = mainAlias(s)
  const others = s.otherAliases.map((a) => a.trim()).filter((a) => a && aliasKey(a) !== aliasKey(main))
  const aliases = [...others, main]
  const { id } = w.createSubject({
    kind: s.kind,
    alias: aliases[0]!,
    sectorId: s.kind === "ticker" ? sectorId : undefined,
    uppercaseOnly: s.uppercaseOnly,
  })
  created.push({ role: "subject", id, display: main, aliases })
  ensureAliases(w, { id, aliases: aliases.slice(1) })
  return id
}

interface FailureContext {
  /** The store's current record on a conflict, as a draft. */
  current?: (record: unknown) => AnyDraft & { version: number; id?: number }
  created?: CreatedSubject[]
  reader?: MemoryReader
  /** "luận điểm chưa lưu": what the partial message says is missing. */
  unsaved?: string
}

/**
 * The one place a store error becomes a form's result. Messages are the store's (which name the field and
 * never quote unchecked text) or fixed ones here; nothing the user typed is added.
 */
function failure(error: unknown, ctx: FailureContext): SaveResult {
  if (!(error instanceof MemoryStoreError)) throw error
  let result: SaveResult
  switch (error.kind) {
    case "conflict": {
      // A thesis deleted elsewhere shows up as a conflict with nothing current.
      const current = error.current === undefined ? undefined : ctx.current?.(error.current)
      result = current
        ? {
            ok: false,
            reason: "conflict",
            message: `Mục này vừa được sửa ở nơi khác (đang là bản ${current.version}).`,
            current,
          }
        : { ok: false, reason: "deleted", message: GONE }
      break
    }
    case "deleted":
    case "not_found":
      result = { ok: false, reason: "deleted", message: GONE }
      break
    case "busy":
      result = { ok: false, reason: "busy", message: BUSY }
      break
    case "alias_taken":
      result = { ok: false, reason: "alias_taken", field: "bí danh", message: error.message }
      break
    case "invalid":
    case "limit":
    case "secret":
      result = { ok: false, reason: error.kind, field: /«([^»]+)»/.exec(error.message)?.[1], message: error.message }
      break
    default:
      result = { ok: false, reason: "failed", message: error.message }
  }
  const created = ctx.created ?? []
  if (created.length === 0) return result
  // The subjects stay (they hold nothing private beyond an alias); the form switches to them by id.
  const shown = created.map((c) => ({ ...c, display: ctx.reader?.subject(c.id)?.display || c.display }))
  return {
    ok: false,
    reason: result.reason === "conflict" ? "failed" : result.reason,
    message: result.message,
    partial: {
      message: `Đã tạo chủ đề ${shown.map((c) => c.display).join(", ")}; ${ctx.unsaved}: ${result.message}`,
      created: shown,
    },
  }
}
