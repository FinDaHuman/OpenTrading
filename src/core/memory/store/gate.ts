import type { Database } from "bun:sqlite"
import { policyRule, type MemoryAction, type MemoryKind, type MemoryRole, type PolicyContext } from "../policy"
import { constraintReads } from "./constraints"
import type { StoreContext } from "./open"
import { displayOf } from "./subjects"
import { thesisReads } from "./theses"
import { lessonReads } from "./lessons"

/**
 * The policy-checked read path: the only part of the store that model-facing code is handed.
 * It asks the policy table for each kind and returns live entries projected to the allowed fields;
 * deleted entries never come out. It has no write and no handle on the connection.
 */

export interface GateItem {
  kind: MemoryKind
  fields: Readonly<Record<string, unknown>>
}

export interface GateFilter {
  /** Theses of these subjects only (the subjects in focus). */
  subjectIds?: readonly number[]
  /** These lessons only (what memory_read asked for). */
  lessonIds?: readonly number[]
}

const KINDS: readonly MemoryKind[] = ["constraint", "style", "thesis", "lesson", "decision"]

function project(source: Record<string, unknown>, fields: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (source[f] !== undefined) out[f] = source[f]
  return Object.freeze(out)
}

export function memoryGate(ctx: StoreContext) {
  const { db } = ctx
  const constraints = constraintReads(ctx)
  const theses = thesisReads(ctx)
  const lessons = lessonReads(ctx)

  /** Every live entry of a kind with all its fields; the policy decides which of them leave. */
  function entries(kind: MemoryKind, filter: GateFilter): Record<string, unknown>[] {
    switch (kind) {
      case "constraint":
      case "style":
        return constraints
          .constraints(kind)
          .map((c) => ({ id: c.id, version: c.version, text: c.text, scope: c.scope }))
      case "thesis":
        return thesisSubjects(db, filter).flatMap(({ id, sector_id, thesis_state }) => {
          const v = theses.thesis(id)
          if (!v) return []
          return [
            {
              subjectId: id,
              display: displayOf(db, id),
              sectorId: sector_id ?? undefined,
              sectorDisplay: sector_id === null ? undefined : displayOf(db, sector_id),
              version: v.version,
              text: v.text,
              detail: v.detail,
              conditions: v.conditions,
              reviewBy: v.reviewBy,
              state: thesis_state,
              validFrom: v.validFrom,
            },
          ]
        })
      case "lesson":
        return lessons
          .lessons()
          .filter((l) => !filter.lessonIds || filter.lessonIds.includes(l.id))
          .map((l) => ({ ...l }))
      case "decision":
        // No rule lets a model role read decisions yet; listed so a future "shared" rule needs no new code path.
        return (
          db
            .query("SELECT id, subject_id, action, reason FROM decisions WHERE deleted_at IS NULL ORDER BY id")
            .all() as { id: number; subject_id: number; action: string; reason: string }[]
        ).map((d) => ({ id: d.id, subjectId: d.subject_id, action: d.action, reason: d.reason }))
    }
  }

  return {
    read(
      role: MemoryRole,
      action: MemoryAction,
      context: PolicyContext = { shared: false },
      filter: GateFilter = {},
    ): GateItem[] {
      return ctx.read(() =>
        KINDS.flatMap((kind) => {
          const rule = policyRule(role, action, kind, context)
          if (!rule || rule.fields.length === 0) return []
          return entries(kind, filter).map((e) => Object.freeze({ kind, fields: project(e, rule.fields) }))
        }),
      )
    },
    allows(
      role: MemoryRole,
      action: MemoryAction,
      kind: MemoryKind,
      context: PolicyContext = { shared: false },
    ): boolean {
      return policyRule(role, action, kind, context) !== undefined
    },
  }
}

function thesisSubjects(db: Database, filter: GateFilter) {
  const rows = db
    .query("SELECT id, sector_id, thesis_state FROM subjects WHERE current_version IS NOT NULL ORDER BY id")
    .all() as { id: number; sector_id: number | null; thesis_state: string }[]
  return filter.subjectIds ? rows.filter((r) => filter.subjectIds!.includes(r.id)) : rows
}
