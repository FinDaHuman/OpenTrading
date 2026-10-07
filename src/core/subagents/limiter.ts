/**
 * How many subagents run at once (config subagents.maxConcurrent). Over the limit a new one
 * waits in FIFO order instead of failing (Codex and Claude Code reject; the user chose to
 * queue). Foreground and background subagents share one limiter.
 */
export class Limiter {
  private running = 0
  private waiters: { resolve: (release: () => void) => void; cleanup: () => void }[] = []
  private listeners = new Set<() => void>()

  constructor(private max: () => number) {}

  stats() {
    return { running: this.running, waiting: this.waiters.length, max: this.limit() }
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Resolves with a release function once a slot is free; rejects if `signal` aborts first. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error("Đã huỷ."))
    if (this.waiters.length === 0 && this.running < this.limit()) return Promise.resolve(this.take())
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.waiters = this.waiters.filter((w) => w !== waiter)
        reject(new Error("Đã huỷ."))
        this.emit()
      }
      const waiter = { resolve, cleanup: () => signal?.removeEventListener("abort", onAbort) }
      signal?.addEventListener("abort", onAbort, { once: true })
      this.waiters.push(waiter)
      this.emit()
    })
  }

  /** Start waiters while slots are free. Call after the limit changes; lowering it never stops running agents. */
  drain() {
    while (this.waiters.length > 0 && this.running < this.limit()) {
      const waiter = this.waiters.shift()!
      waiter.cleanup()
      waiter.resolve(this.take())
    }
    this.emit()
  }

  private limit() {
    const n = Math.floor(this.max())
    return Number.isFinite(n) && n >= 1 ? n : 1
  }

  private take() {
    this.running++
    let released = false
    this.emit()
    return () => {
      if (released) return
      released = true
      this.running--
      this.drain()
    }
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
