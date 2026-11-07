import type { Database } from "bun:sqlite"
import { countChars } from "../limits"
import { MemoryStoreError } from "./errors"
import type { StoreContext } from "./open"
import { checkTotal, oneOf, requiredText } from "./text"
import {
  CONSTRAINT_KINDS,
  SOURCES,
  type ConstraintInput,
  type ConstraintKind,
  type ConstraintVersion,
  type DeletedEntry,
  type DeletedVersion,
  type Saved,
  type Source,
} from "./types"

/** Constraints and presentation style: versioned texts, plus the constraint-set counter decisions record. */

interface Row {
  id: number
  kind: ConstraintKind
  scope: string
  current_version: number
  deleted_at: string | null
}
interface VersionRow {
  version: number
  text: string | null
  source: Source
  created_at: string
}

const NAMES: Record<ConstraintKind, { one: string; total: string }> = {
  constraint: { one: "ràng buộc", total: "các ràng buộc" },
  style: { one: "cách trình bày", total: "cách trình bày" },
}

const row = (db: Database, id: number) =>
  db.query("SELECT id, kind, scope, current_version, deleted_at FROM constraints WHERE id = ?").get(id) as Row | null

const versionRow = (db: Database, id: number, version: number) =>
  db
    .query("SELECT version, text, source, created_at FROM constraint_versions WHERE constraint_id = ? AND version = ?")
    .get(id, version) as VersionRow | null

function toVersion(r: Row, v: VersionRow): ConstraintVersion {
  return {
    id: r.id,
    kind: r.kind,
    version: v.version,
    text: v.text!,
    scope: r.scope,
    source: v.source,
    createdAt: v.created_at,
  }
}

/** The constraint-set counter; read inside a decision's transaction too. */
export const readConstraintSet = (db: Database) =>
  (db.query("SELECT value FROM counters WHERE name = 'constraint_set'").get() as { value: number }).value

/** Characters of a kind's active current versions, leaving one entry out (the one being revised). */
function activeTotal(db: Database, kind: ConstraintKind, except = 0) {
  const texts = db
    .query(
      `SELECT v.text FROM constraints c
       JOIN constraint_versions v ON v.constraint_id = c.id AND v.version = c.current_version
       WHERE c.kind = ? AND c.deleted_at IS NULL AND c.id != ?`,
    )
    .all(kind, except) as { text: string }[]
  return texts.reduce((sum, r) => sum + countChars(r.text), 0)
}

function bumpIfConstraint(db: Database, kind: ConstraintKind) {
  if (kind === "constraint") db.run("UPDATE counters SET value = value + 1 WHERE name = 'constraint_set'")
}

const itemLimit = (kind: ConstraintKind) => (kind === "constraint" ? "constraintItem" : "styleTotal")
const totalLimit = (kind: ConstraintKind) => (kind === "constraint" ? "constraintTotal" : "styleTotal")

export function constraintReads(ctx: StoreContext) {
  const { db } = ctx
  return {
    /** Active entries of one kind at their current version, oldest first. */
    constraints(kind: ConstraintKind): ConstraintVersion[] {
      return ctx.read(() => {
        const rows = db
          .query(
            `SELECT id, kind, scope, current_version, deleted_at FROM constraints
             WHERE kind = ? AND deleted_at IS NULL ORDER BY id`,
          )
          .all(kind) as Row[]
        return rows.map((r) => toVersion(r, versionRow(db, r.id, r.current_version)!))
      })
    },
    constraint(id: number): ConstraintVersion | DeletedEntry | undefined {
      return ctx.read(() => {
        const r = row(db, id)
        if (!r) return undefined
        if (r.deleted_at) return { id, deleted: true, deletedAt: r.deleted_at }
        return toVersion(r, versionRow(db, id, r.current_version)!)
      })
    },
    constraintVersion(id: number, version: number): ConstraintVersion | DeletedVersion | undefined {
      return ctx.read(() => {
        const r = row(db, id)
        const v = r && versionRow(db, id, version)
        if (!r || !v) return undefined
        if (r.deleted_at || v.text === null) return { version, deleted: true }
        return toVersion(r, v)
      })
    },
    constraintSet(): number {
      return ctx.read(() => readConstraintSet(db))
    },
  }
}

/** The entry to change, checked against the version the form read; throws not_found / deleted / conflict. */
function expectCurrent(db: Database, id: number, expected: number): Row {
  const r = row(db, id)
  if (!r) throw new MemoryStoreError("not_found", `Không có ràng buộc #${id}.`)
  const name = NAMES[r.kind].one
  if (r.deleted_at) throw new MemoryStoreError("deleted", `${capitalize(name)} #${id} đã bị xoá.`)
  if (r.current_version !== expected) {
    throw new MemoryStoreError(
      "conflict",
      `${capitalize(name)} #${id} vừa được sửa ở nơi khác ` +
        `(đang ở bản ${r.current_version}, form đọc bản ${expected}).`,
      toVersion(r, versionRow(db, id, r.current_version)!),
    )
  }
  return r
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function insertVersion(db: Database, id: number, version: number, text: string, source: Source, at: string) {
  db.query(
    "INSERT INTO constraint_versions (constraint_id, version, text, source, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, version, text, source, at)
}

export function constraintWrites(ctx: StoreContext) {
  const { db } = ctx
  return {
    addConstraint(input: ConstraintInput): Saved {
      const kind = oneOf("loại ràng buộc", input.kind, CONSTRAINT_KINDS)
      const source = oneOf("nguồn", input.source ?? "manual", SOURCES)
      const text = requiredText(NAMES[kind].one, input.text, itemLimit(kind))
      return ctx.write(() => {
        checkTotal(NAMES[kind].total, activeTotal(db, kind), countChars(text), totalLimit(kind))
        const at = ctx.now()
        const { id } = db
          .query("INSERT INTO constraints (kind, current_version) VALUES (?, 1) RETURNING id")
          .get(kind) as { id: number }
        insertVersion(db, id, 1, text, source, at)
        bumpIfConstraint(db, kind)
        return { id, version: 1 }
      })
    },

    reviseConstraint(id: number, expected: number, input: { text: string; source?: Source }): Saved {
      const source = oneOf("nguồn", input.source ?? "manual", SOURCES)
      return ctx.write(() => {
        const r = expectCurrent(db, id, expected)
        const text = requiredText(NAMES[r.kind].one, input.text, itemLimit(r.kind))
        checkTotal(NAMES[r.kind].total, activeTotal(db, r.kind, id), countChars(text), totalLimit(r.kind))
        const version = r.current_version + 1
        insertVersion(db, id, version, text, source, ctx.now())
        db.query("UPDATE constraints SET current_version = ? WHERE id = ?").run(version, id)
        bumpIfConstraint(db, r.kind)
        return { id, version }
      })
    },

    /** Logical delete: every version's text goes, the id and version numbers stay. */
    deleteConstraint(id: number, expected: number): void {
      ctx.write(() => {
        const r = expectCurrent(db, id, expected)
        db.query("UPDATE constraints SET deleted_at = ? WHERE id = ?").run(ctx.now(), id)
        db.query("UPDATE constraint_versions SET text = NULL WHERE constraint_id = ?").run(id)
        bumpIfConstraint(db, r.kind)
      })
      ctx.flushDeleted()
    },
  }
}
