import type { Config } from "./config"

/**
 * Idle compaction (todo 33d), after Claude Code 2.1.299: a long conversation left alone is
 * summarized before the next message, so that message does not resend all of it. Claude Code
 * waits ~54 minutes because its prompt cache lives an hour; Gemini's implicit cache and
 * OpenAI's in-memory one last minutes, so 15 is the default here.
 */
export const IDLE_COMPACT_MINUTES = 15
export const IDLE_COMPACT_MIN_TOKENS = 200_000
/** What the /config row cycles through (0 = off). */
export const IDLE_COMPACT_CHOICES = [15, 30, 54, 0] as const

export interface IdleCompactSettings {
  /** 0 = off. */
  minutes: number
  minTokens: number
}

export function idleCompactSettings(config: Pick<Config, "idleCompact" | "autoCompact">): IdleCompactSettings {
  const minutes = config.idleCompact?.minutes
  const minTokens = config.idleCompact?.minTokens
  return {
    minutes: config.autoCompact === "off" ? 0 : typeof minutes === "number" && minutes >= 0 ? Math.round(minutes) : IDLE_COMPACT_MINUTES,
    minTokens: typeof minTokens === "number" && minTokens > 0 ? minTokens : IDLE_COMPACT_MIN_TOKENS,
  }
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void }

const realTimers: Timers = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    // Waiting for the user never keeps the process alive.
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** One pending "the user has been away this long" callback; the TUI decides what it does. */
export class IdleTimer {
  private handle: unknown
  private ms = 0
  private fire: (() => void) | undefined

  constructor(private timers: Timers = realTimers) {}

  get armed() {
    return this.handle !== undefined
  }

  /** Call `fire` once after `ms` of no activity; replaces any pending one. */
  arm(ms: number, fire: () => void) {
    this.disarm()
    if (!(ms > 0)) return
    this.ms = ms
    this.fire = fire
    this.handle = this.timers.set(() => {
      this.handle = undefined
      fire()
    }, ms)
  }

  /** Activity (a key press): a pending timer starts over; none is started. */
  poke() {
    if (this.handle !== undefined && this.fire) this.arm(this.ms, this.fire)
  }

  /** Run the pending callback now instead of waiting (tests); false when none is pending. */
  fireNow(): boolean {
    const fire = this.fire
    if (this.handle === undefined || !fire) return false
    this.disarm()
    fire()
    return true
  }

  disarm() {
    if (this.handle !== undefined) this.timers.clear(this.handle)
    this.handle = undefined
  }
}
