/**
 * Stops calling a server that keeps failing at the connection level. During an outage the model
 * repeats its calls and moves on to the same server's other tools, and each call waits out its
 * retries and costs quota. After {@link BREAKER_THRESHOLD} failures in a row calls are refused
 * without being sent; once {@link BREAKER_OPEN_MS} has passed, one call goes through to test it.
 *
 * Only the connection counts. A data source that failed, a tool error, a timeout or a rate limit
 * come from a server that is up: one bad source must not cut off its healthy tools.
 */

export const BREAKER_THRESHOLD = 3
export const BREAKER_OPEN_MS = 60_000

export class ServerBreaker {
  private failures = 0
  private openUntil = 0

  constructor(
    private readonly openMs = BREAKER_OPEN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private get open() {
    return this.failures >= BREAKER_THRESHOLD
  }

  /**
   * Undefined when the call may go; otherwise the ms left before one will. A call let through
   * while open is the test: others wait a full period more, so a test that ends without a
   * verdict (cancelled, rate limited) just delays the next one.
   */
  admit(): number | undefined {
    if (!this.open) return undefined
    const left = this.openUntil - this.now()
    if (left > 0) return left
    this.openUntil = this.now() + this.openMs
    return undefined
  }

  /** The server answered, whatever the answer. */
  success() {
    this.failures = 0
    this.openUntil = 0
  }

  failure() {
    this.failures++
    if (this.open) this.openUntil = this.now() + this.openMs
  }

  /** The connection came back: the next call tests it without waiting out the period. */
  reconnected() {
    this.openUntil = 0
  }
}
