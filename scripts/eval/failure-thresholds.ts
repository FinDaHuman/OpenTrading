import { FAILURE_STREAK_NUDGE, FAILURE_STREAK_STOP, type FailureThresholds } from "../../src/core/loop/failures"
import { BREAKER_THRESHOLD } from "../../src/core/mcp/breaker"

export function parseFailureThresholds(streak?: string, breaker?: string): FailureThresholds & { breaker: number } {
  const match = streak?.match(/^nudge=(\d+),stop=(\d+)$/)
  if (streak !== undefined && !match) throw new Error("--failure-streak cần dạng nudge=2,stop=4")
  const nudge = match ? Number(match[1]) : FAILURE_STREAK_NUDGE
  const stop = match ? Number(match[2]) : FAILURE_STREAK_STOP
  const threshold = breaker === undefined ? BREAKER_THRESHOLD : /^\d+$/.test(breaker) ? Number(breaker) : NaN
  if (![nudge, stop, threshold].every((n) => Number.isSafeInteger(n) && n > 0) || nudge >= stop) {
    throw new Error("Ngưỡng phải là số nguyên dương và nudge phải nhỏ hơn stop")
  }
  return { nudge, stop, breaker: threshold }
}
