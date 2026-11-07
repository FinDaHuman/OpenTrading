/** Public shapes of the v5.1 memory store. Times are ISO 8601 UTC strings; dates are YYYY-MM-DD. */

/** How an entry got into the store. Only "manual" is written before the card (007) and import specs. */
export const SOURCES = ["manual", "card", "investor_import"] as const
export type Source = (typeof SOURCES)[number]

export const CONSTRAINT_KINDS = ["constraint", "style"] as const
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number]
export const SUBJECT_KINDS = ["ticker", "sector", "market"] as const
export type SubjectKind = (typeof SUBJECT_KINDS)[number]
/** States a live thesis can be set to; "none" only means "no thesis". */
export const LIVE_THESIS_STATES = ["watching", "refuted", "closed"] as const
export type ThesisState = "none" | (typeof LIVE_THESIS_STATES)[number]
export const CONFIDENCES = ["low", "medium", "high"] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** What reads return for an entry, or a version of it, whose content was deleted. */
export interface DeletedEntry {
  id: number
  deleted: true
  deletedAt: string
}
export interface DeletedVersion {
  version: number
  deleted: true
}

export interface ConstraintVersion {
  id: number
  kind: ConstraintKind
  version: number
  text: string
  scope: string
  source: Source
  createdAt: string
}

export interface AliasEntry {
  alias: string
  addedAt: string
  retiredAt?: string
}

export interface Subject {
  id: number
  kind: SubjectKind
  /** The alias in use that was added last: a renamed ticker shows its new code. */
  display: string
  aliases: AliasEntry[]
  sectorId?: number
  uppercaseOnly: boolean
  /** Highest thesis version ever issued; never goes down, so a rewritten thesis continues the count. */
  lastVersion: number
  currentVersion?: number
  thesisState: ThesisState
  thesisStateAt?: string
}

export interface ThesisVersion {
  subjectId: number
  version: number
  text: string
  detail?: string
  conditions: string[]
  reviewBy?: string
  validFrom: string
  validTo?: string
  source: Source
}

export interface LessonVersion {
  id: number
  version: number
  title: string
  summary: string
  appliesTo: number[]
  exceptions?: string
  detail?: string
  tags: string[]
  source: Source
  createdAt: string
}

/** The thesis version a decision rested on, as the user saw it; "none" when there was no thesis. */
export type DecisionBasis = { version: number; deleted?: true } | "none"

export interface Decision {
  id: number
  subjectId: number
  basis: DecisionBasis
  /** The constraint-set counter at the moment the decision was written. */
  constraintSet: number
  action: string
  reason: string
  expectation?: string
  confidence?: Confidence
  reviewOn?: string
  changeMind?: string
  source: Source
  createdAt: string
}

export interface Saved {
  id: number
  version: number
}

export interface ConstraintInput {
  kind: ConstraintKind
  text: string
  source?: Source
}

export interface SubjectInput {
  kind: SubjectKind
  alias: string
  sectorId?: number
  uppercaseOnly?: boolean
}

export interface ThesisInput {
  text: string
  detail?: string
  conditions: string[]
  reviewBy?: string
  source?: Source
}

export interface LessonInput {
  title: string
  summary: string
  appliesTo?: number[]
  exceptions?: string
  detail?: string
  tags?: string[]
  source?: Source
}

export interface DecisionInput {
  subjectId: number
  /** Optional: a decision may have no thesis behind it ("Bán VNM để cơ cấu"). */
  thesisVersion?: number
  action: string
  reason: string
  expectation?: string
  confidence?: Confidence
  reviewOn?: string
  changeMind?: string
  source?: Source
}
