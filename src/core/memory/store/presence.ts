import type { Database } from "bun:sqlite"
import { escapeMemoryLine } from "../notebook/escape"
import { parseList } from "./theses"

/**
 * Which versions a block in a session's history still has in the store, for the redaction check only:
 * it decides whether a block is masked, and nothing it reads goes to a model or a file. It reads what the
 * policy gate never returns (older thesis versions, retired aliases), because a block in the history may
 * be any version and a thesis label carries the name the subject had when it was sent. Decisions are
 * never read.
 */

export type PresenceRef =
  | { kind: "lesson"; id: number; version: number }
  /** `name` exactly as the block's label printed it (escaped). */
  | { kind: "thesis"; name: string; version: number }

export type PresenceVersion =
  | {
      kind: "lesson"
      id: number
      version: number
      title: string
      summary: string
      exceptions?: string
      detail?: string
      tags: string[]
    }
  | {
      kind: "thesis"
      name: string
      subjectId: number
      version: number
      text: string
      conditions: string[]
      reviewBy?: string
      detail?: string
    }

/** Every alias ever used, retired included, keyed as a label prints it; read once, on first use. */
function aliasIndex(db: Database): (name: string) => number[] {
  let names: Map<string, number[]> | undefined
  return (name) => {
    if (!names) {
      names = new Map()
      const rows = db.query("SELECT subject_id, alias FROM subject_aliases ORDER BY subject_id, id").all() as {
        subject_id: number
        alias: string
      }[]
      for (const r of rows) {
        const key = escapeMemoryLine(r.alias)
        const list = names.get(key) ?? []
        if (!list.includes(r.subject_id)) list.push(r.subject_id)
        names.set(key, list)
      }
    }
    return names.get(name) ?? []
  }
}

/**
 * The refs whose deletion this store recorded: the version's row is still there (deletes are logical, ids
 * and version numbers are never reused) and carries the delete. A ref the store has no row for is not here:
 * the store may simply not be the one that wrote it (re-created empty, restored from an older backup).
 */
export function readTombstones(db: Database, refs: readonly PresenceRef[]): PresenceRef[] {
  const lesson = db.query(
    `SELECT 1 FROM lessons l JOIN lesson_versions v ON v.lesson_id = l.id
     WHERE l.id = ? AND v.version = ? AND l.deleted_at IS NOT NULL`,
  )
  const thesis = db.query("SELECT 1 FROM thesis_versions WHERE subject_id = ? AND version = ? AND deleted_at IS NOT NULL")
  const subjectsNamed = aliasIndex(db)
  return refs.filter((ref) =>
    ref.kind === "lesson"
      ? lesson.get(ref.id, ref.version) !== null
      : subjectsNamed(ref.name).some((id) => thesis.get(id, ref.version) !== null),
  )
}

const optional =<K extends string>(key: K, value: string | null) =>
  (value === null ? {} : { [key]: value }) as Partial<Record<K, string>>

/** Live versions matching `refs`, in the order of `refs`; a thesis name used by several subjects gives each. */
export function readPresence(db: Database, refs: readonly PresenceRef[]): PresenceVersion[] {
  const lesson = db.query(
    `SELECT v.title, v.summary, v.exceptions, v.detail, v.tags FROM lessons l
     JOIN lesson_versions v ON v.lesson_id = l.id
     WHERE l.id = ? AND v.version = ? AND l.deleted_at IS NULL`,
  )
  const thesis = db.query(
    `SELECT text, conditions, review_by, detail FROM thesis_versions
     WHERE subject_id = ? AND version = ? AND deleted_at IS NULL`,
  )
  const subjectsNamed = aliasIndex(db)

  const out: PresenceVersion[] = []
  for (const ref of refs) {
    if (ref.kind === "lesson") {
      const r = lesson.get(ref.id, ref.version) as {
        title: string
        summary: string
        exceptions: string | null
        detail: string | null
        tags: string | null
      } | null
      if (!r) continue
      out.push({
        kind: "lesson",
        id: ref.id,
        version: ref.version,
        title: r.title,
        summary: r.summary,
        ...optional("exceptions", r.exceptions),
        ...optional("detail", r.detail),
        tags: parseList(r.tags),
      })
      continue
    }
    for (const subjectId of subjectsNamed(ref.name)) {
      const r = thesis.get(subjectId, ref.version) as {
        text: string
        conditions: string | null
        review_by: string | null
        detail: string | null
      } | null
      if (!r) continue
      out.push({
        kind: "thesis",
        name: ref.name,
        subjectId,
        version: ref.version,
        text: r.text,
        conditions: parseList(r.conditions),
        ...optional("reviewBy", r.review_by),
        ...optional("detail", r.detail),
      })
    }
  }
  return out
}
