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
