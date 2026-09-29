import { DEFAULT_MAX_OUTPUT_CHARS, DEFAULT_TIMEOUT_MS, type ToolContext, type ToolDef } from "./types"

/**
 * Read/write lock: read-only tools share it, everything else takes it exclusively.
 * Writers are queued FIFO and block new readers so they cannot starve.
 */
export class RwLock {
  private readers = 0
  private writer = false
  private queue: { write: boolean; wake: () => void }[] = []

  async acquire(write: boolean): Promise<() => void> {
    if (this.canEnter(write) && this.queue.length === 0) this.enter(write)
    else await new Promise<void>((wake) => this.queue.push({ write, wake }))
    let released = false
    return () => {
      if (released) return
      released = true
      if (write) this.writer = false
      else this.readers--
      this.drain()
    }
  }

  private canEnter(write: boolean) {
    return write ? !this.writer && this.readers === 0 : !this.writer
  }

  private enter(write: boolean) {
    if (write) this.writer = true
    else this.readers++
  }

  private drain() {
    while (this.queue.length > 0 && this.canEnter(this.queue[0]!.write)) {
      const next = this.queue.shift()!
      this.enter(next.write)
      next.wake()
      if (next.write) break
    }
  }
}

/** Keep the head and tail of long output so both the start and the conclusion survive. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.7)
  const tail = max - head
  const omitted = text.length - head - tail
  return `${text.slice(0, head)}\n\n[... đã lược ${omitted} ký tự ...]\n\n${text.slice(text.length - tail)}`
}

export class ToolTimeoutError extends Error {
  constructor(name: string, ms: number) {
    super(`Tool ${name} quá thời gian (${Math.round(ms / 1000)}s).`)
  }
}

/**
 * Run one tool call with locking, timeout and output limits.
 * Errors are rethrown with a readable message; the AI SDK turns them into `tool-error`
 * results that go back to the model instead of crashing the loop.
 */
export async function runTool(def: ToolDef, input: unknown, ctx: ToolContext, lock: RwLock): Promise<string> {
  const release = await lock.acquire(!def.readOnly)
  const ms = def.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeout = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const signal = AbortSignal.any([ctx.signal, timeout.signal])
    // Race as well as signal: a tool that ignores its signal must still not hang the loop.
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timeout.abort()
        reject(new ToolTimeoutError(def.name, ms))
      }, ms)
    })
    const aborted = new Promise<never>((_, reject) => {
      if (ctx.signal.aborted) reject(new Error("Đã huỷ."))
      ctx.signal.addEventListener("abort", () => reject(new Error("Đã huỷ.")), { once: true })
    })
    const result = await Promise.race([def.execute(input, { ...ctx, signal }), expired, aborted])
    const output = typeof result === "string" ? result : result.output
    return truncate(output, def.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS)
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error(String(error))
  } finally {
    clearTimeout(timer)
    release()
  }
}
