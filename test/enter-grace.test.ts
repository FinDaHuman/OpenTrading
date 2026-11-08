import { afterAll, expect, test } from "bun:test"
import { ENTER_GRACE_MS, enterGrace, setClockForTests } from "../src/tui/ui/clock"

afterAll(() => setClockForTests(undefined))

test("Enter is in its grace period until ENTER_GRACE_MS after the card was shown, on the TUI clock", () => {
  let t = 1_000
  setClockForTests(() => t)
  const inGrace = enterGrace()
  expect(inGrace()).toBe(true)
  t += ENTER_GRACE_MS - 1
  expect(inGrace()).toBe(true)
  t += 1
  expect(inGrace()).toBe(false)
  // Each card starts its own period when it mounts.
  expect(enterGrace()()).toBe(true)
  expect(enterGrace(0)()).toBe(false)
})
