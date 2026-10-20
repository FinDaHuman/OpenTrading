import { afterEach, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { SPINNER, SPINNER_MS, setClockForTests, useNow, useSpinner } from "../src/tui/ui/clock"

afterEach(() => setClockForTests(undefined))

test("tests can step the clock: every subscriber sees the new time at once", () => {
  let t = 1_000_000
  setClockForTests(() => t)
  createRoot((dispose) => {
    const a = useNow(1000)
    const b = useNow(1000)
    expect(a()).toBe(1_000_000)
    t += 3000
    setClockForTests(() => t)
    expect([a(), b()]).toEqual([1_003_000, 1_003_000])
    dispose()
  })
})

test("a spinner advances with the clock and is a fixed frame when inactive", () => {
  let t = 0
  setClockForTests(() => t)
  createRoot((dispose) => {
    const [running, setRunning] = createSignal(true)
    const frame = useSpinner(running)
    expect(frame()).toBe(SPINNER[0]!)
    t = SPINNER_MS * 3
    setClockForTests(() => t)
    expect(frame()).toBe(SPINNER[3]!)
    setRunning(false)
    dispose()
  })
})

test("a subscribed ticker refreshes the time on its interval", async () => {
  let fired = 0
  createRoot((dispose) => {
    const now = useNow(5)
    const seen = now()
    setTimeout(() => {
      if (now() !== seen) fired++
      dispose()
    }, 30)
  })
  await new Promise((r) => setTimeout(r, 50))
  expect(fired).toBe(1)
})
