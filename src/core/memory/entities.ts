import type { InstrumentType } from "../market/tickers"

export interface Entity {
  code: string
  type: InstrumentType
  /** Turn in which the code was last mentioned (or set with focus). */
  lastTurn: number
}

export interface EntityState {
  items: Entity[]
}

export interface EntityUpdate {
  state: EntityState
  /** Codes dropped because the cap was reached, oldest mention first. */
  evicted: string[]
}

const byCode = (a: Entity, b: Entity) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)

/**
 * The instruments a session is currently about, so "so sánh tiếp với quý trước" still means VCB.
 * A code stays while it was mentioned within the last `ttlTurns` turns; at most `max` codes are kept, dropping the
 * least recently mentioned. The result is sorted by code so rendering stays stable.
 */
export function updateEntities(
  prev: EntityState,
  mentioned: readonly { code: string; type: InstrumentType }[],
  turn: number,
  opts: { ttlTurns: number; max: number },
): EntityUpdate {
  const map = new Map(prev.items.map((e) => [e.code, { ...e }]))
  for (const m of mentioned) map.set(m.code, { code: m.code, type: m.type, lastTurn: turn })
  const alive = [...map.values()].filter((e) => turn - e.lastTurn < opts.ttlTurns)
  // Most recent first; ties keep code order so eviction is deterministic.
  alive.sort((a, b) => b.lastTurn - a.lastTurn || byCode(a, b))
  const kept = alive.slice(0, opts.max)
  const evicted = alive.slice(opts.max).map((e) => e.code)
  return { state: { items: kept.sort(byCode) }, evicted }
}

export const sameEntities = (a: EntityState, b: EntityState) =>
  a.items.length === b.items.length && a.items.every((e, i) => e.code === b.items[i]!.code)
