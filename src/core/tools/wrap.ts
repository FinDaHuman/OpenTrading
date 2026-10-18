import { deniedMessage, type PermissionGate } from "../permission"
import { loopDef, loopDenied } from "./loop-guard"
import { normalizeNetDates } from "./net-dates"
import { hasDataArray, parseResult, REF_PREFIX, rememberResult } from "./refs"
import { DEFAULT_MAX_OUTPUT_CHARS, DEFAULT_TIMEOUT_MS, type ToolContext, type ToolDef, type ToolResult } from "./types"

/**
 * An MCP result holding a data array gets `[ref rN]` up front, and its full text is kept
 * (refs.ts) before the output cap: charts read the numbers by ref, the model never re-types them.
 * ASP.NET dates (/Date(ms)/) in MCP results become ISO first (net-dates.ts).
 */
function stampRef(def: ToolDef, raw: string) {
  if (!def.source?.startsWith("mcp:")) return raw
  // Before the ref is kept, so charts read the same dates as the model.
  const output = normalizeNetDates(raw)
  if (output.length > 5_000_000) return output
  const parsed = parseResult(output)
  if (parsed === undefined || !hasDataArray(parsed)) return output
  return `${REF_PREFIX}${rememberResult(def.name, output)}] ${output}`
}

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

/** Tool error messages longer than this are cut before the model sees them. */
export const MAX_ERROR_CHARS = 2000

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
export async function runTool(def: ToolDef, input: unknown, ctx: ToolContext, lock: RwLock, gate?: PermissionGate): Promise<ToolResult> {
  // Waiting on the user (a question, then approval) is not tool runtime, and nobody holds
  // the lock meanwhile.
  if (def.prepare) ctx = { ...ctx, prepared: await def.prepare(input, ctx) }
  if (gate) {
    const repeats = ctx.loop?.note(def.name, input)
    if (repeats !== undefined) {
      const decision = await gate.check(loopDef(def, repeats), input, ctx.signal, def.displayName, ctx.callId, ctx.agent)
      // Headless runs stop the loop too: nobody can say "go on".
      if (!decision.allow) throw new Error(decision.reason === "cancelled" ? deniedMessage(decision) : loopDenied(def, repeats, decision.message))
    }
    const decision = await gate.check(def, input, ctx.signal, def.displayName, ctx.callId, ctx.agent)
    if (!decision.allow) throw new Error(deniedMessage(decision))
  }
  const release = def.unlocked ? () => {} : await lock.acquire(!def.readOnly)
  const ms = def.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeout = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const signal = AbortSignal.any([ctx.signal, timeout.signal])
    // Race as well as signal: a tool that ignores its signal must still not hang the loop.
    const expired = new Promise<never>((_, reject) => {
      if (ms <= 0) return
      timer = setTimeout(() => {
        timeout.abort()
        reject(new ToolTimeoutError(def.name, ms))
      }, ms)
    })
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Đã huỷ."))
      if (ctx.signal.aborted) onAbort()
      else ctx.signal.addEventListener("abort", onAbort, { once: true })
    })
    const result = await Promise.race([def.execute(input, { ...ctx, signal }), expired, aborted])
    const output = stampRef(def, typeof result === "string" ? result : result.output)
    const images = typeof result === "string" ? undefined : result.images
    const chart = typeof result === "string" ? undefined : result.chart
    return {
      output: truncate(output, def.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS),
      ...(images?.length ? { images } : {}),
      ...(chart ? { chart } : {}),
    }
  } catch (error) {
    // Errors go back to the model too: an HTML 502 page or a stack trace must not fill
    // the context. Keep the head and tail.
    const message = error instanceof Error ? error.message : String(error)
    if (message.length <= MAX_ERROR_CHARS && error instanceof Error) throw error
    throw new Error(truncate(message, MAX_ERROR_CHARS))
  } finally {
    clearTimeout(timer)
    // The turn's signal outlives this call; don't leave one listener behind per tool call.
    if (onAbort) ctx.signal.removeEventListener("abort", onAbort)
    release()
  }
}
