import type { Database } from "bun:sqlite"
import { MemoryStoreError } from "./errors"
import type { StoreContext } from "./open"
import { requireSubject } from "./subjects"
import { checkCount, oneOf, optionalText, requiredText, textList } from "./text"
import { parseList } from "./theses"
import {
  SOURCES,
  type DeletedEntry,
  type DeletedVersion,
  type LessonInput,
  type LessonVersion,
  type Saved,
  type Source,
} from "./types"

/** Lessons: versioned like constraints, each version with the subjects (tickers or sectors) it applies to. */

interface Row {
  id: number
  current_version: number
  deleted_at: string | null
}
interface VersionRow {
  version: number
  title: string | null
  summary: string | null
  exceptions: string | null
  detail: string | null
  tags: string | null
  source: Source
  created_at: string
}

const row = (db: Database, id: number) =>
  db.query("SELECT id, current_version, deleted_at FROM lessons WHERE id = ?").get(id) as Row | null

const versionRow = (db: Database, id: number, version: number) =>
  db.query("SELECT * FROM lesson_versions WHERE lesson_id = ? AND version = ?").get(id, version) as VersionRow | null

function toVersion(db: Database, id: number, v: VersionRow): LessonVersion {
  const appliesTo = (
    db
      .query("SELECT subject_id FROM lesson_applies WHERE lesson_id = ? AND version = ? ORDER BY position")
      .all(id, v.version) as { subject_id: number }[]
  ).map((r) => r.subject_id)
  return {
    id,
    version: v.version,
    title: v.title!,
    summary: v.summary!,
    appliesTo,
    ...(v.exceptions !== null ? { exceptions: v.exceptions } : {}),
    ...(v.detail !== null ? { detail: v.detail } : {}),
    tags: parseList(v.tags),
    source: v.source,
    createdAt: v.created_at,
  }
}

function clean(input: LessonInput) {
  // Repeats are dropped (first one kept) before the count is checked.
  const appliesTo = [...new Set(input.appliesTo ?? [])]
  checkCount("áp dụng cho", appliesTo.length, "lessonAppliesTo")
  return {
    title: requiredText("tiêu đề bài học", input.title, "lessonTitle"),
    summary: requiredText("tóm tắt bài học", input.summary, "lessonSummary"),
    exceptions: optionalText("ngoại lệ", input.exceptions, "lessonExceptions"),
    detail: optionalText("chi tiết bài học", input.detail, "lessonDetail"),
    tags: textList("tag", input.tags ?? [], "lessonTags", "lessonTag"),
    appliesTo,
    source: oneOf("nguồn", input.source ?? "manual", SOURCES),
  }
}

function insertVersion(db: Database, id: number, version: number, v: ReturnType<typeof clean>, at: string) {
  for (const subjectId of v.appliesTo) {
    const kind = requireSubject(db, subjectId).kind
    if (kind === "market") {
      throw new MemoryStoreError("invalid", "Bài học chỉ áp dụng cho chủ đề loại mã hoặc ngành.")
    }
  }
  db.query(
    `INSERT INTO lesson_versions (lesson_id, version, title, summary, exceptions, detail, tags, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, version, v.title, v.summary, v.exceptions ?? null, v.detail ?? null, JSON.stringify(v.tags), v.source, at)
  const apply = db.query("INSERT INTO lesson_applies (lesson_id, version, position, subject_id) VALUES (?, ?, ?, ?)")
  v.appliesTo.forEach((subjectId, position) => apply.run(id, version, position, subjectId))
}

function expectCurrent(db: Database, id: number, expected: number): Row {
  const r = row(db, id)
  if (!r) throw new MemoryStoreError("not_found", `Không có bài học #${id}.`)
  if (r.deleted_at) throw new MemoryStoreError("deleted", `Bài học #${id} đã bị xoá.`)
  if (r.current_version !== expected) {
    throw new MemoryStoreError(
      "conflict",
      `Bài học #${id} vừa được sửa ở nơi khác (đang ở bản ${r.current_version}, ` +
        `form đọc bản ${expected}).`,
      toVersion(db, id, versionRow(db, id, r.current_version)!),
    )
  }
  return r
}

export function lessonReads(ctx: StoreContext) {
  const { db } = ctx
  return {
    /** Active lessons at their current version, by id. */
    lessons(): LessonVersion[] {
      return ctx.read(() =>
        (
          db.query("SELECT id, current_version FROM lessons WHERE deleted_at IS NULL ORDER BY id").all() as Row[]
        ).map((r) => toVersion(db, r.id, versionRow(db, r.id, r.current_version)!)),
      )
    },
    lesson(id: number): LessonVersion | DeletedEntry | undefined {
      return ctx.read(() => {
        const r = row(db, id)
        if (!r) return undefined
        if (r.deleted_at) return { id, deleted: true, deletedAt: r.deleted_at }
        return toVersion(db, id, versionRow(db, id, r.current_version)!)
      })
    },
    lessonVersion(id: number, version: number): LessonVersion | DeletedVersion | undefined {
      return ctx.read(() => {
        const r = row(db, id)
        const v = r && versionRow(db, id, version)
        if (!r || !v) return undefined
        return r.deleted_at ? { version, deleted: true } : toVersion(db, id, v)
      })
    },
  }
}

export function lessonWrites(ctx: StoreContext) {
  const { db } = ctx
  return {
    addLesson(input: LessonInput): Saved {
      const v = clean(input)
      return ctx.write(() => {
        const at = ctx.now()
        const { id } = db.query("INSERT INTO lessons (current_version) VALUES (1) RETURNING id").get() as { id: number }
        insertVersion(db, id, 1, v, at)
        return { id, version: 1 }
      })
    },

    reviseLesson(id: number, expected: number, input: LessonInput): Saved {
      const v = clean(input)
      return ctx.write(() => {
        const r = expectCurrent(db, id, expected)
        const version = r.current_version + 1
        insertVersion(db, id, version, v, ctx.now())
        db.query("UPDATE lessons SET current_version = ? WHERE id = ?").run(version, id)
        return { id, version }
      })
    },

    /** Logical delete: every version's content and "applies to" go; the id and version numbers stay. */
    deleteLesson(id: number, expected: number): void {
      ctx.write(() => {
        expectCurrent(db, id, expected)
        db.query("UPDATE lessons SET deleted_at = ? WHERE id = ?").run(ctx.now(), id)
        db.query(
          `UPDATE lesson_versions SET title = NULL, summary = NULL, exceptions = NULL, detail = NULL, tags = NULL
           WHERE lesson_id = ?`,
        ).run(id)
        db.query("DELETE FROM lesson_applies WHERE lesson_id = ?").run(id)
      })
      ctx.flushDeleted()
    },
  }
}
