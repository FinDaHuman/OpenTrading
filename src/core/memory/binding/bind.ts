import { ChatSetupError } from "../../chat"
import { readProfile, type ProfileRead } from "../../profile"
import { identityLayer } from "../../prompt/assemble"
import { estimateTokens } from "../../prompt/budget"
import type { ConstraintRead, ConstraintReader, SourceFailure } from "./constraints"
import { holdMessage, renderConstraints, unreadableLine, unreadNote, type BoundSource, type TurnHold } from "./render"

/**
 * The binding of one turn, run before the model is resolved, before any hook and before the first
 * request: the investor profile (main agent only) and the user's constraints (every agent). A source
 * that failed to read holds the turn unless the user chose, for this turn, to run without it; a source
 * that read is always sent. Nothing here can grant that choice but the caller passing `waive`.
 */

export type { BoundSource, TurnHold } from "./render"

/** The user's choice for one turn: run without the sources that failed. Never stored. */
export interface Waiver {
  profile?: boolean
  constraints?: boolean
}

/** A turn not sent. A ChatSetupError, so every caller's "failed before sending" path already handles it. */
export class TurnHeldError extends ChatSetupError {
  override readonly name = "TurnHeldError"

  constructor(
    readonly hold: TurnHold,
    readonly role: "main" | "subagent",
  ) {
    super(holdMessage(hold, role))
  }
}

export interface Bound {
  /** The filtered profile (main agent only); assemble escapes it. */
  profile?: string
  /** The rendered constraint block; undefined when there is no constraint. */
  constraints?: string
  /** The note naming the failed sources the user chose to run without. */
  unread?: string
  /** bindLenient only: one line per source that failed (left out of the request), for /context. */
  unreadable?: string[]
}

type Role = "main" | "subagent"

interface Reads {
  profile: ProfileRead
  constraints: ConstraintRead
}

async function readBoth(role: Role, reader: ConstraintReader | undefined): Promise<Reads> {
  const [profile, constraints] = await Promise.all([
    // A sub-agent works for the main agent: it never gets the investor profile, so it is not read.
    role === "main" ? readProfile() : Promise.resolve<ProfileRead>({ state: "none" }),
    reader ? reader.read(role === "main" ? "main_agent" : "subagent") : Promise.resolve<ConstraintRead>({ state: "none" }),
  ])
  return { profile, constraints }
}

function profileFailure(read: ProfileRead): SourceFailure | undefined {
  return read.state === "failed" ? { file: read.file, reason: read.reason, lasting: false, newerSchema: false } : undefined
}

function bound(reads: Reads, unread: BoundSource[]): Bound {
  const out: Bound = {}
  if (reads.profile.state === "loaded") out.profile = reads.profile.text
  if (reads.constraints.state === "loaded") {
    const block = renderConstraints(reads.constraints.lines)
    if (block) out.constraints = block
  }
  if (unread.length > 0) out.unread = unreadNote(unread)
  return out
}

/** Reads both sources for a turn; throws TurnHeldError when a source failed and was not waived. */
export async function bindTurn(input: { role: Role; constraints?: ConstraintReader; waive?: Waiver }): Promise<Bound> {
  const reads = await readBoth(input.role, input.constraints)
  const profile = profileFailure(reads.profile)
  const constraints = reads.constraints.state === "failed" ? reads.constraints.failure : undefined
  const waived = (input.waive?.profile || !profile) && (input.waive?.constraints || !constraints)
  // Held: the message and the run-anyway button name every failed source, so one choice covers the turn.
  if (!waived) {
    throw new TurnHeldError(
      { kind: "unreadable", ...(profile ? { profile } : {}), ...(constraints ? { constraints } : {}) },
      input.role,
    )
  }
  const unread: BoundSource[] = []
  if (profile) unread.push("profile")
  if (constraints) unread.push("constraints")
  return bound(reads, unread)
}

/**
 * Compaction and /context: not an answer turn, and idle compaction runs while the user is away, so
 * nobody could answer a hold. A failed source is left out, never held.
 */
export async function bindLenient(input: { role: Role; constraints?: ConstraintReader }): Promise<Bound> {
  const reads = await readBoth(input.role, input.constraints)
  const out = bound(reads, [])
  const unreadable: string[] = []
  if (reads.profile.state === "failed") unreadable.push(unreadableLine("profile", reads.profile.reason))
  if (reads.constraints.state === "failed") unreadable.push(unreadableLine("constraints", reads.constraints.failure.reason))
  if (unreadable.length > 0) out.unreadable = unreadable
  return out
}

/** What checkFits needs of a target: the model and its context size. */
export interface FitTarget {
  model: string
  provider: { models: Record<string, { limit?: { context?: number; output?: number } } | undefined> }
}

/** Room kept for the answer: a model that can only just read the rules but not reply is no use. */
const ANSWER_ROOM_TOKENS = 4096

/**
 * Throws TurnHeldError("too-large") when the role's identity layer plus the whole constraint block plus
 * room to answer cannot fit the model. Only with at least one constraint and a known context size: the
 * message says "your constraints do not fit", which is only true then.
 */
export function checkFits(bound: Bound, role: Role, target: FitTarget, promptsDir?: string): void {
  if (!bound.constraints) return
  const limit = target.provider.models[target.model]?.limit
  if (!limit?.context) return
  const answer = Math.min(limit.output ?? ANSWER_ROOM_TOKENS, ANSWER_ROOM_TOKENS)
  const needed = estimateTokens(identityLayer(role, promptsDir) ?? "") + estimateTokens(bound.constraints) + answer
  if (needed >= limit.context) throw new TurnHeldError({ kind: "too-large", model: target.model }, role)
}
