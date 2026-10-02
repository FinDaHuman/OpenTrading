/** Injected so tests never depend on the real clock or on random ids. */
export interface Clock {
  now(): Date
}

export interface IdFactory {
  next(): string
}

export const systemClock: Clock = { now: () => new Date() }

/** UUIDv7 is time-ordered, so sorting by id keeps creation order and render output stays stable. */
export const uuidV7Ids: IdFactory = { next: () => Bun.randomUUIDv7() }

/** Calendar date (YYYY-MM-DD) in the given IANA zone. Memory dates are Vietnam dates, not UTC dates. */
export function calendarDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}
