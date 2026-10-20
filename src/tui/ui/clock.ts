import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

/**
 * One timer per interval for every animation and countdown in the TUI (spinners, elapsed
 * time, the retry countdown), instead of one setInterval per row. A ticker runs only while
 * something on screen subscribes to it and never keeps the process alive (unref).
 */

let read: () => number = Date.now

/** The time the TUI shows; tests replace it with {@link setClockForTests}. */
export const now = () => read()

interface Ticker {
  value: Accessor<number>
  set: (n: number) => void
  users: number
  timer?: ReturnType<typeof setInterval>
}

const tickers = new Map<number, Ticker>()

function ticker(ms: number): Ticker {
  let t = tickers.get(ms)
  if (!t) {
    const [value, set] = createSignal(read())
    t = { value, set, users: 0 }
    tickers.set(ms, t)
  }
  return t
}

function subscribe(t: Ticker, ms: number) {
  if (t.users++ === 0) {
    t.set(read())
    t.timer = setInterval(() => t.set(read()), ms)
    // Bun and Node both have unref; a running spinner must not hold `bun test` open.
    ;(t.timer as { unref?: () => void }).unref?.()
  }
}

function unsubscribe(t: Ticker) {
  if (--t.users === 0) {
    clearInterval(t.timer)
    t.timer = undefined
  }
}

/**
 * The current time, refreshed every `ms` while `active()` is true (default: always, while the
 * calling component is mounted). Must be called inside a component or another owner.
 */
export function useNow(ms: number, active: () => boolean = () => true): Accessor<number> {
  const t = ticker(ms)
  let subscribed = false
  createEffect(() => {
    const on = active()
    if (on && !subscribed) subscribe(t, ms)
    else if (!on && subscribed) unsubscribe(t)
    subscribed = on
  })
  onCleanup(() => {
    if (subscribed) unsubscribe(t)
    subscribed = false
  })
  return t.value
}

/** Braille frames for a working row (tools, subagents). */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
export const SPINNER_MS = 90

/** A spinner frame that advances only while `active()`. */
export function useSpinner(active: () => boolean): Accessor<string> {
  const t = useNow(SPINNER_MS, active)
  return () => SPINNER[Math.floor(t() / SPINNER_MS) % SPINNER.length]!
}

/**
 * Tests: read the time from `fn` (undefined restores Date.now) and push it to every ticker
 * at once, so a countdown can be stepped without waiting.
 */
export function setClockForTests(fn: (() => number) | undefined) {
  read = fn ?? Date.now
  for (const t of tickers.values()) t.set(read())
}
