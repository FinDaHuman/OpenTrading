import type { Database } from "bun:sqlite"
import { MemoryStoreError } from "./errors"
import type { StoreContext } from "./open"
import { oneOf, requiredText } from "./text"
import {
  SUBJECT_KINDS,
  type AliasEntry,
  type Subject,
  type SubjectInput,
  type SubjectKind,
  type ThesisState,
} from "./types"

/**
 * Subjects have an internal id; a ticker code is only an alias with a history (a renamed code is
 * a new alias on the same subject). Lookups ignore case; the "uppercase only" flag matters only
 * when a later spec spots subjects in what the user typed.
 */

interface Row {
  id: number
  kind: SubjectKind
  sector_id: number | null
  uppercase_only: number
  last_version: number
  current_version: number | null
  thesis_state: ThesisState
  thesis_state_at: string | null
}
interface AliasRow {
  alias: string
  added_at: string
  retired_at: string | null
}

export const aliasKey = (alias: string) => alias.normalize("NFC").trim().toLocaleUpperCase("vi")

export const subjectRow = (db: Database, id: number) =>
  db
    .query(
      `SELECT id, kind, sector_id, uppercase_only, last_version, current_version, thesis_state, thesis_state_at
       FROM subjects WHERE id = ?`,
    )
    .get(id) as Row | null

/** The alias in use that was added last: after a rename, the new code. */
export const displayOf = (db: Database, id: number) =>
  (
    db
      .query("SELECT alias FROM subject_aliases WHERE subject_id = ? AND retired_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(id) as { alias: string } | null
  )?.alias ?? ""

function toSubject(db: Database, r: Row): Subject {
  const rows = db
    .query("SELECT alias, added_at, retired_at FROM subject_aliases WHERE subject_id = ? ORDER BY id")
    .all(r.id) as AliasRow[]
  const aliases = rows.map(
    (a): AliasEntry => ({ alias: a.alias, addedAt: a.added_at, ...(a.retired_at ? { retiredAt: a.retired_at } : {}) }),
  )
  return {
    id: r.id,
    kind: r.kind,
    display: displayOf(db, r.id),
    aliases,
    ...(r.sector_id !== null ? { sectorId: r.sector_id } : {}),
    uppercaseOnly: r.uppercase_only === 1,
    lastVersion: r.last_version,
    ...(r.current_version !== null ? { currentVersion: r.current_version } : {}),
    thesisState: r.thesis_state,
    ...(r.thesis_state_at ? { thesisStateAt: r.thesis_state_at } : {}),
  }
}

/** The subject or not_found. */
export function requireSubject(db: Database, id: number): Row {
  const r = subjectRow(db, id)
  if (!r) throw new MemoryStoreError("not_found", `Không có chủ đề #${id}.`)
  return r
}

function insertAlias(db: Database, subjectId: number, alias: string, at: string) {
  const text = requiredText("bí danh", alias, "alias").trim()
  const key = aliasKey(text)
  const owner = db
    .query("SELECT subject_id FROM subject_aliases WHERE alias_key = ? AND retired_at IS NULL")
    .get(key) as { subject_id: number } | null
  if (owner?.subject_id === subjectId) return
  if (owner) {
    throw new MemoryStoreError(
      "alias_taken",
      `Bí danh «${text}» đang thuộc chủ đề #${owner.subject_id} (${displayOf(db, owner.subject_id)}).`,
    )
  }
  db.query("INSERT INTO subject_aliases (subject_id, alias, alias_key, added_at) VALUES (?, ?, ?, ?)").run(
    subjectId,
    text,
    key,
    at,
  )
}

export function subjectReads(ctx: StoreContext) {
  const { db } = ctx
  return {
    subjects(): Subject[] {
      return ctx.read(() =>
        (db.query("SELECT id FROM subjects ORDER BY id").all() as { id: number }[]).map((r) =>
          toSubject(db, subjectRow(db, r.id)!),
        ),
      )
    },
    subject(id: number): Subject | undefined {
      return ctx.read(() => {
        const r = subjectRow(db, id)
        return r ? toSubject(db, r) : undefined
      })
    },
    /** Aliases in use only, case ignored: "hpg" finds HPG. */
    subjectByAlias(alias: string): Subject | undefined {
      return ctx.read(() => {
        const hit = db
          .query("SELECT subject_id FROM subject_aliases WHERE alias_key = ? AND retired_at IS NULL")
          .get(aliasKey(alias)) as { subject_id: number } | null
        return hit ? toSubject(db, subjectRow(db, hit.subject_id)!) : undefined
      })
    },
  }
}

export function subjectWrites(ctx: StoreContext) {
  const { db } = ctx
  return {
    createSubject(input: SubjectInput): { id: number } {
      const kind = oneOf("loại chủ đề", input.kind, SUBJECT_KINDS)
      return ctx.write(() => {
        if (input.sectorId !== undefined) {
          const sector = requireSubject(db, input.sectorId)
          if (kind !== "ticker" || sector.kind !== "sector") {
            throw new MemoryStoreError(
              "invalid",
              "Chỉ chủ đề loại mã mới thuộc một ngành, và ngành phải là chủ đề loại ngành.",
            )
          }
        }
        const at = ctx.now()
        const { id } = db
          .query("INSERT INTO subjects (kind, sector_id, uppercase_only, created_at) VALUES (?, ?, ?, ?) RETURNING id")
          .get(kind, input.sectorId ?? null, input.uppercaseOnly ? 1 : 0, at) as { id: number }
        insertAlias(db, id, input.alias, at)
        return { id }
      })
    },

    addAlias(subjectId: number, alias: string): void {
      ctx.write(() => {
        requireSubject(db, subjectId)
        insertAlias(db, subjectId, alias, ctx.now())
      })
    },

    retireAlias(subjectId: number, alias: string): void {
      ctx.write(() => {
        requireSubject(db, subjectId)
        const inUse = db
          .query("SELECT id, alias_key FROM subject_aliases WHERE subject_id = ? AND retired_at IS NULL")
          .all(subjectId) as { id: number; alias_key: string }[]
        const hit = inUse.find((a) => a.alias_key === aliasKey(alias))
        if (!hit) {
          // Not quoted: this text never went through the input checks, and a pasted key would come back here.
          throw new MemoryStoreError("not_found", `Chủ đề #${subjectId} không có bí danh đang dùng như vừa nhập.`)
        }
        if (inUse.length === 1) {
          throw new MemoryStoreError("invalid", "Chủ đề phải còn ít nhất một bí danh đang dùng.")
        }
        db.query("UPDATE subject_aliases SET retired_at = ? WHERE id = ?").run(ctx.now(), hit.id)
      })
    },
  }
}
