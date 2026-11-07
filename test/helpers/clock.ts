import { ENTER_GRACE_MS, now, setClockForTests } from "../../src/tui/ui/clock"

/**
 * Move the TUI clock past the Enter grace of a card or prompt just shown (ui/clock.ts
 * `enterGrace`), instead of sleeping through it. The clock keeps running from there; a file
 * that calls this puts it back with {@link realClock} after each test.
 */
export function pastEnterGrace() {
  const ahead = now() + ENTER_GRACE_MS
  const from = Date.now()
  setClockForTests(() => ahead + (Date.now() - from))
}

export const realClock = () => setClockForTests(undefined)
