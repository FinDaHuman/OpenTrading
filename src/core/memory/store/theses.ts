import type { Database } from "bun:sqlite"
import { MemoryStoreError } from "./errors"
import type { StoreContext } from "./open"
import { requireSubject, subjectRow } from "./subjects"
import { oneOf, optionalText, requiredText, textList } from "./text"
import {
  LIVE_THESIS_STATES,
  SOURCES,
  type DeletedVersion,
  type Saved,
  type Source,
  type ThesisInput,
  type ThesisState,
  type ThesisVersion,
} from "./types"

/**
 * Thesis versions of a subject. Versions are immutable and numbered from the subject's
 * last_version, which never goes down: a thesis deleted and rewritten continues the count, so an
 * old reference ("HPG bản 2") can never point at new text.
 */

interface VersionRow {
  subject_id: number
  version: number
  text: string | null
  detail: string | null
  conditions: string | null
  review_by: string | null
  valid_from: string
  valid_to: string | null
  source: Source
  deleted_at: string | null
}

const versionRow = (db: Database, subjectId: number, version: number) =>
  db
    .query("SELECT * FROM thesis_versions WHERE subject_id = ? AND version = ?")
    .get(subjectId, version) as VersionRow | null

/** Stored by this module only; anything else in the column means the file was damaged. */
export function parseList(json: string | null): string[] {
  let value: unknown
  try {
    value = json === null ? [] : JSON.parse(json)
  } catch {
    value = undefined
  }
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new MemoryStoreError("corrupt", "Dữ liệu danh sách trong kho memory bị hỏng.")
  }
  return value
}

function toVersion(r: VersionRow): ThesisVersion {
  return {
    subjectId: r.subject_id,
    version: r.version,
    text: r.text!,
    ...(r.detail !== null ? { detail: r.detail } : {}),
    conditions: parseList(r.conditions),
    ...(r.review_by !== null ? { reviewBy: r.review_by } : {}),
    validFrom: r.valid_from,
    ...(r.valid_to !== null ? { validTo: r.valid_to } : {}),
    source: r.source,
  }
}

/** A thesis version that exists and still has its content; used by decisions for their basis. */
export const liveThesisVersion = (db: Database, subjectId: number, version: number) => {
  const r = versionRow(db, subjectId, version)
  return r && r.deleted_at === null ? r : undefined
}

/** YYYY-MM-DD that is a real calendar day ("2026-02-30" is refused). */
export function checkDate(label: string, value: string | undefined): string | undefined {
  if (value === undefined || !value.trim()) return undefined
  const day = value.trim()
  const parsed = new Date(`${day}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new MemoryStoreError("invalid", `«${label}» phải là ngày dạng YYYY-MM-DD.`)
  }
  return day
}

export function thesisReads(ctx: StoreContext) {
  const { db } = ctx
  return {
    /** The current version, or undefined when the subject has no thesis (never had one, or it was deleted). */
    thesis(subjectId: number): ThesisVersion | undefined {
      return ctx.read(() => {
        const s = subjectRow(db, subjectId)
        if (!s || s.current_version === null) return undefined
        return toVersion(versionRow(db, subjectId, s.current_version)!)
      })
    },
    thesisVersion(subjectId: number, version: number): ThesisVersion | DeletedVersion | undefined {
      return ctx.read(() => {
        const r = versionRow(db, subjectId, version)
        if (!r) return undefined
        return r.deleted_at !== null ? { version, deleted: true } : toVersion(r)
      })
    },
  }
}

/** The moment a version stops being current: the next one's valid_from, or the deletion. */
function closeVersion(db: Database, subjectId: number, version: number, at: string) {
  db.query("UPDATE thesis_versions SET valid_to = ? WHERE subject_id = ? AND version = ?").run(at, subjectId, version)
}

/** The subject, checked against the thesis version the form read (null: "no thesis yet"). */
function expectCurrent(db: Database, subjectId: number, expected: number | null) {
  const s = requireSubject(db, subjectId)
  if (s.current_version !== expected) {
    const current = s.current_version === null ? undefined : toVersion(versionRow(db, subjectId, s.current_version)!)
    const now = s.current_version === null ? "chưa có luận điểm" : `đang ở bản ${s.current_version}`
    const read = expected === null ? "chưa có luận điểm" : `bản ${expected}`
    throw new MemoryStoreError(
      "conflict",
      `Luận điểm của chủ đề #${subjectId} vừa được sửa ở nơi khác (${now}, form đọc ${read}).`,
      current,
    )
  }
  return s
}

export function thesisWrites(ctx: StoreContext) {
  const { db } = ctx
  return {
    saveThesis(subjectId: number, expected: number | null, input: ThesisInput): Saved {
      const text = requiredText("văn bản luận điểm", input.text, "thesisText")
      const detail = optionalText("chi tiết luận điểm", input.detail, "thesisDetail")
      const conditions = textList("điều kiện", input.conditions, "thesisConditions", "thesisCondition")
      const reviewBy = checkDate("hạn xem lại", input.reviewBy)
      const source = oneOf("nguồn", input.source ?? "manual", SOURCES)
      return ctx.write(() => {
        const s = expectCurrent(db, subjectId, expected)
        const at = ctx.now()
        const version = s.last_version + 1
        if (s.current_version !== null) {
          closeVersion(db, subjectId, s.current_version, at)
        }
        db.query(
          `INSERT INTO thesis_versions (subject_id, version, text, detail, conditions, review_by, valid_from, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          subjectId,
          version,
          text,
          detail ?? null,
          JSON.stringify(conditions),
          reviewBy ?? null,
          at,
          source,
        )
        // A new version puts a refuted or closed thesis back under watch; the state date moves only on a change.
        db.query(
          `UPDATE subjects SET last_version = ?, current_version = ?,
             thesis_state_at = CASE WHEN thesis_state = 'watching' THEN thesis_state_at ELSE ? END,
             thesis_state = 'watching'
           WHERE id = ?`,
        ).run(version, version, at, subjectId)
        return { id: subjectId, version }
      })
    },

    setThesisState(subjectId: number, expected: number, state: Exclude<ThesisState, "none">): void {
      // "none" means "no thesis"; a live thesis cannot be put there (the type says so, callers may not).
      oneOf("trạng thái luận điểm", state, LIVE_THESIS_STATES)
      ctx.write(() => {
        const s = expectCurrent(db, subjectId, expected)
        // The state date records a change; setting the same state again is not one.
        if (s.thesis_state === state) return
        db.query("UPDATE subjects SET thesis_state = ?, thesis_state_at = ? WHERE id = ?").run(
          state,
          ctx.now(),
          subjectId,
        )
      })
    },

    /** Logical delete of the subject's whole thesis history; the version count stays for the next one. */
    deleteThesis(subjectId: number, expected: number): void {
      ctx.write(() => {
        const s = expectCurrent(db, subjectId, expected)
        const at = ctx.now()
        closeVersion(db, subjectId, s.current_version!, at)
        db.query(
          `UPDATE thesis_versions SET text = NULL, detail = NULL, conditions = NULL, review_by = NULL, deleted_at = ?
           WHERE subject_id = ? AND deleted_at IS NULL`,
        ).run(at, subjectId)
        db.query(
          "UPDATE subjects SET current_version = NULL, thesis_state = 'none', thesis_state_at = ? WHERE id = ?",
        ).run(at, subjectId)
      })
      ctx.flushDeleted()
    },
  }
}
