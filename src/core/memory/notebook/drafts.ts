import type {
  Confidence,
  ConstraintKind,
  ConstraintVersion,
  LessonVersion,
  SubjectKind,
  ThesisVersion,
} from "../store/types"
import { formatDate } from "./render"

/**
 * What a notebook form holds while the user types: plain values, in RAM only, never written to disk.
 * Dates are kept as the user reads them (DD/MM/YYYY); the admin handle turns them into the store's
 * YYYY-MM-DD when saving. A draft read from the store carries the version the form opened on, which is
 * what an edit sends back so a save never overwrites a version the user did not see.
 */

export interface ConstraintDraft {
  /** Not chosen until the user picks one: no default promotes every remark to a hard rule. */
  kind?: ConstraintKind
  text: string
}

export interface NewSubjectDraft {
  kind: SubjectKind
  /** A ticker's code is stored in capitals. */
  alias: string
  sector?: { id: number } | { newName: string }
  otherAliases: string[]
  uppercaseOnly: boolean
}

export interface ThesisDraft {
  text: string
  detail?: string
  conditions: string[]
  reviewBy?: string
}

/** A subject a lesson applies to: one already in the notebook, or a name to create on save. */
export type SubjectRef = { id: number; display: string } | { newName: string; kind: "ticker" | "sector" }

export interface LessonDraft {
  title: string
  summary: string
  appliesTo: SubjectRef[]
  exceptions?: string
  detail?: string
  tags: string[]
}

export interface DecisionDraft {
  action: string
  reason: string
  expectation?: string
  confidence?: Confidence
  reviewOn?: string
  changeMind?: string
  /** The thesis version the form showed, never one looked up at save time. */
  basis: { version: number } | "none"
}

export type AnyDraft = ConstraintDraft | ThesisDraft | LessonDraft | DecisionDraft

export const refName = (ref: SubjectRef) => ("id" in ref ? ref.display : ref.newName)

/**
 * The kind of an unknown "applies to" name, created on save after the user agrees. Exactly three ASCII
 * letters or digits, any case, is a ticker code (fpt, HPG); four or five only in capitals (VN30), since a
 * lowercase word that short is more often a sector's short name; anything else is a sector.
 */
export function guessKind(name: string): "ticker" | "sector" {
  const n = name.trim()
  return /^[A-Za-z0-9]{3}$/.test(n) || /^[A-Z0-9]{4,5}$/.test(n) ? "ticker" : "sector"
}

/** "2026-12-31" → "31/12/2026". */
export const fromStoreDay = (day: string | undefined) => (day ? formatDate(day) : undefined)

/**
 * A typed day ("31/12/2026", "1/2/2027", or ISO) as the store's YYYY-MM-DD; undefined when blank,
 * "invalid" when it is not a real calendar day.
 */
export function toStoreDay(text: string | undefined): string | undefined | "invalid" {
  const value = text?.trim()
  if (!value) return undefined
  const vn = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const day = vn ? `${vn[3]}-${vn[2]!.padStart(2, "0")}-${vn[1]!.padStart(2, "0")}` : value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "invalid"
  const parsed = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : "invalid"
}

export function constraintToDraft(c: ConstraintVersion): { id: number; version: number; kind: ConstraintKind; text: string } {
  return { id: c.id, version: c.version, kind: c.kind, text: c.text }
}

export function thesisToDraft(t: ThesisVersion): ThesisDraft & { version: number } {
  return {
    version: t.version,
    text: t.text,
    detail: t.detail,
    conditions: [...t.conditions],
    reviewBy: fromStoreDay(t.reviewBy),
  }
}

export function lessonToDraft(
  l: LessonVersion,
  name: (subjectId: number) => string,
): LessonDraft & { id: number; version: number } {
  return {
    id: l.id,
    version: l.version,
    title: l.title,
    summary: l.summary,
    appliesTo: l.appliesTo.map((id) => ({ id, display: name(id) })),
    exceptions: l.exceptions,
    detail: l.detail,
    tags: [...l.tags],
  }
}
