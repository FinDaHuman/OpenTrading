import type { Database } from "bun:sqlite"
import { readConstraintSet } from "./constraints"
import { MemoryStoreError } from "./errors"
import type { StoreContext } from "./open"
import { requireSubject } from "./subjects"
import { oneOf, optionalText, requiredText } from "./text"
import { checkDate, liveThesisVersion } from "./theses"
import {
  CONFIDENCES,
  SOURCES,
  type Confidence,
  type Decision,
  type DecisionInput,
  type DeletedEntry,
  type Source,
} from "./types"

/**
 * The decision log: append-only, on this machine only. A decision records the thesis version the
 * user was looking at (given by the form, not looked up at write time) and the constraint-set
 * counter, both inside the same transaction as the insert. There is deliberately no update.
 */

interface Row {
  id: number
  subject_id: number
  thesis_version: number | null
  constraint_set: number
  action: string | null
  reason: string | null
  expectation: string | null
  confidence: Confidence | null
  review_on: string | null
  change_mind: string | null
  source: Source
  created_at: string
  deleted_at: string | null
}

const row = (db: Database, id: number) => db.query("SELECT * FROM decisions WHERE id = ?").get(id) as Row | null

function toDecision(db: Database, r: Row): Decision | DeletedEntry {
  if (r.deleted_at) return { id: r.id, deleted: true, deletedAt: r.deleted_at }
  // The basis is a reference only: when the thesis was deleted, it reads as deleted instead of keeping the text.
  const basis =
    r.thesis_version === null
      ? ("none" as const)
      : liveThesisVersion(db, r.subject_id, r.thesis_version)
        ? { version: r.thesis_version }
        : { version: r.thesis_version, deleted: true as const }
  return {
    id: r.id,
    subjectId: r.subject_id,
    basis,
    constraintSet: r.constraint_set,
    action: r.action!,
    reason: r.reason!,
    ...(r.expectation !== null ? { expectation: r.expectation } : {}),
    ...(r.confidence !== null ? { confidence: r.confidence } : {}),
    ...(r.review_on !== null ? { reviewOn: r.review_on } : {}),
    ...(r.change_mind !== null ? { changeMind: r.change_mind } : {}),
    source: r.source,
    createdAt: r.created_at,
  }
}

export function decisionReads(ctx: StoreContext) {
  const { db } = ctx
  return {
    /** Every decision, deleted ones as bare ids: the user's own log in /memory. Never for the model. */
    decisions(): (Decision | DeletedEntry)[] {
      return ctx.read(() =>
        (db.query("SELECT * FROM decisions ORDER BY id").all() as Row[]).map((r) => toDecision(db, r)),
      )
    },
    decision(id: number): Decision | DeletedEntry | undefined {
      return ctx.read(() => {
        const r = row(db, id)
        return r ? toDecision(db, r) : undefined
      })
    },
  }
}

export function decisionWrites(ctx: StoreContext) {
  const { db } = ctx
  return {
    addDecision(input: DecisionInput): { id: number } {
      const action = requiredText("việc", input.action, "decisionAction")
      const reason = requiredText("lý do", input.reason, "decisionReason")
      const expectation = optionalText("kỳ vọng", input.expectation, "decisionExpectation")
      const changeMind = optionalText("điều gì làm đổi ý", input.changeMind, "decisionChangeMind")
      const reviewOn = checkDate("ngày xem lại", input.reviewOn)
      const confidence = input.confidence === undefined ? undefined : oneOf("mức tự tin", input.confidence, CONFIDENCES)
      const source = oneOf("nguồn", input.source ?? "manual", SOURCES)
      return ctx.write(() => {
        requireSubject(db, input.subjectId)
        if (input.thesisVersion !== undefined) {
          const exists = db
            .query("SELECT deleted_at FROM thesis_versions WHERE subject_id = ? AND version = ?")
            .get(input.subjectId, input.thesisVersion) as { deleted_at: string | null } | null
          if (!exists) {
            throw new MemoryStoreError(
              "not_found",
              `Chủ đề #${input.subjectId} không có luận điểm bản ${input.thesisVersion}.`,
            )
          }
          if (exists.deleted_at) {
            throw new MemoryStoreError(
              "deleted",
              `Luận điểm bản ${input.thesisVersion} của chủ đề #${input.subjectId} đã bị xoá.`,
            )
          }
        }
        const { id } = db
          .query(
            `INSERT INTO decisions (subject_id, thesis_version, constraint_set, action, reason, expectation, confidence,
               review_on, change_mind, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          )
          .get(
            input.subjectId,
            input.thesisVersion ?? null,
            readConstraintSet(db),
            action,
            reason,
            expectation ?? null,
            confidence ?? null,
            reviewOn ?? null,
            changeMind ?? null,
            source,
            ctx.now(),
          ) as { id: number }
        return { id }
      })
    },

    /** Logical delete: the content goes, the id stays. Decisions have no versions, so no version mark. */
    deleteDecision(id: number): void {
      ctx.write(() => {
        const r = row(db, id)
        if (!r) throw new MemoryStoreError("not_found", `Không có quyết định #${id}.`)
        if (r.deleted_at) throw new MemoryStoreError("deleted", `Quyết định #${id} đã bị xoá.`)
        db.query(
          `UPDATE decisions SET action = NULL, reason = NULL, expectation = NULL, confidence = NULL, review_on = NULL,
             change_mind = NULL, deleted_at = ? WHERE id = ?`,
        ).run(ctx.now(), id)
      })
      ctx.flushDeleted()
    },
  }
}
