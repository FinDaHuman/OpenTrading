import { expect, test } from "bun:test"
import { IDLE_COMPACT_MIN_TOKENS, IDLE_COMPACT_MINUTES, idleCompactSettings, IdleTimer } from "../src/core/idle-compact"

/** Timers the test advances by hand. */
function fakeTimers() {
  let now = 0
  const pending = new Map<number, { at: number; fn: () => void }>()
  let next = 1
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++
        pending.set(id, { at: now + ms, fn })
        return id
      },
      clear: (id: unknown) => void pending.delete(id as number),
    },
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id)
          t.fn()
        }
      }
    },
    get count() {
      return pending.size
    },
  }
}

test("settings: defaults 15 minutes / 200k; 0 turns it off; autoCompact off turns it off", () => {
  expect(idleCompactSettings({})).toEqual({ minutes: IDLE_COMPACT_MINUTES, minTokens: IDLE_COMPACT_MIN_TOKENS })
  expect(IDLE_COMPACT_MINUTES).toBe(15)
  expect(IDLE_COMPACT_MIN_TOKENS).toBe(200_000)
  expect(idleCompactSettings({ idleCompact: { minutes: 0 } }).minutes).toBe(0)
  expect(idleCompactSettings({ idleCompact: { minutes: 30, minTokens: 120_000 } })).toEqual({ minutes: 30, minTokens: 120_000 })
  expect(idleCompactSettings({ autoCompact: "off", idleCompact: { minutes: 30 } }).minutes).toBe(0)
  // Nonsense in config.json falls back to the defaults.
  expect(idleCompactSettings({ idleCompact: { minutes: -5, minTokens: 0 } })).toEqual({ minutes: IDLE_COMPACT_MINUTES, minTokens: IDLE_COMPACT_MIN_TOKENS })
})

test("the timer fires once after the idle time; a key press starts it over; disarm cancels; 0 never arms", () => {
  const clock = fakeTimers()
  const timer = new IdleTimer(clock.timers)
  let fired = 0
  timer.arm(15 * 60_000, () => fired++)
  expect(timer.armed).toBe(true)
  clock.advance(10 * 60_000)
  timer.poke() // typing at minute 10: the 15 minutes start again
  clock.advance(10 * 60_000)
  expect(fired).toBe(0)
  clock.advance(5 * 60_000)
  expect(fired).toBe(1)
  expect(timer.armed).toBe(false)
  clock.advance(60 * 60_000)
  expect(fired).toBe(1) // once per idle spell
  timer.poke() // nothing pending: a key press does not start one
  expect(clock.count).toBe(0)

  timer.arm(60_000, () => fired++)
  timer.disarm()
  clock.advance(120_000)
  expect(fired).toBe(1)
  timer.arm(0, () => fired++)
  expect(timer.armed).toBe(false)
})
