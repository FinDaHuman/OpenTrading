import type { LanguageModelMiddleware } from "ai"
import { isContextOverflow } from "./compact"

/**
 * Retry for model requests, by kind of failure (opencode `session/retry.ts`, Claude Code
 * `services/api/withRetry.ts`): both turn the SDK's own retry off and run their own,
 * because the SDK retries every 429 alike, waits in silence, and drops Gemini's
 * RetryInfo. Streams are created with `maxRetries: 0` and wrapped with this middleware.
 *
 * - daily quota, bad key/request, context overflow: never retried (it cannot help);
 * - per-minute rate limit: wait what the provider asks (RetryInfo, retry-after, "try again
 *   in 20s"), at most {@link MAX_WAIT_MS}, {@link RATE_RETRIES} times;
 * - overload, 5xx, network: 2s·2ⁿ⁻¹ plus up to 25% jitter, capped at 30s, {@link RETRIES} times.
 *
 * Only the request is retried, before anything streamed: a step already running is never
 * repeated, so earlier steps and tool calls do not run twice.
 */

export const RETRIES = 4
export const RATE_RETRIES = 2
/** Longer waits than this are reported instead of slept through. */
export const MAX_WAIT_MS = 60_000
const BASE_MS = 2_000
const CAP_MS = 30_000

export type FailureKind = "daily-quota" | "rate-limit" | "overloaded" | "network" | "fatal"

export interface Failure {
  kind: FailureKind
  /** Wait the provider asked for, when it said. */
  delayMs?: number
  /** Short Vietnamese reason for the UI. */
  label: string
}

export interface RetryNotice {
  /** 1-based retry number. */
  attempt: number
  max: number
  delayMs: number
  label: string
}

export interface RetryOptions {
  onRetry?: (notice: RetryNotice) => void
  /** Injected in tests. Must reject when the signal aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

interface ErrorShape {
  name?: string
  message?: string
  statusCode?: number
  responseBody?: string
  responseHeaders?: Record<string, string>
  isRetryable?: boolean
  lastError?: unknown
  cause?: unknown
}

const DAILY = /PerDay|per[ _-]?day|insufficient_quota|\b(TPD|RPD)\b|daily (limit|quota)/i
const RATE = /RESOURCE_EXHAUSTED|rate.?limit|too many requests|quota/i
const OVERLOADED = /overloaded|UNAVAILABLE|temporarily unavailable|try again later/i
const NETWORK = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|network|terminated|other side closed/i
const RETRY_STATUS = new Set([408, 409, 425, 500, 502, 503, 504, 529])

export function classifyFailure(error: unknown): Failure {
  const e = (error ?? {}) as ErrorShape
  if (e.name === "AI_RetryError" && e.lastError) return classifyFailure(e.lastError)
  if (e.name === "AbortError") return { kind: "fatal", label: "đã huỷ" }
  const status = e.statusCode
  const text = `${e.message ?? ""} ${e.responseBody ?? ""}`
  if (isContextOverflow(text)) return { kind: "fatal", label: "hội thoại quá dài cho model" }
  if (status === 429 || (status === undefined && RATE.test(text) && !NETWORK.test(text))) {
    if (DAILY.test(text)) return { kind: "daily-quota", label: "hết quota ngày" }
    return { kind: "rate-limit", delayMs: requestedDelay(e), label: "bị giới hạn tốc độ (429)" }
  }
  if (status !== undefined) {
    if (RETRY_STATUS.has(status) || (status >= 500 && status < 600)) return { kind: "overloaded", label: `provider lỗi tạm thời (${status})` }
    if (e.isRetryable === true) return { kind: "overloaded", label: `provider lỗi tạm thời (${status})` }
    return { kind: "fatal", label: `lỗi ${status}` }
  }
  if (OVERLOADED.test(text)) return { kind: "overloaded", label: "provider quá tải" }
  if (NETWORK.test(text) || NETWORK.test(String((e.cause as ErrorShape | undefined)?.message ?? ""))) return { kind: "network", label: "lỗi mạng" }
  return { kind: "fatal", label: "lỗi không thử lại được" }
}

/** RetryInfo.retryDelay (Gemini), retry-after-ms / retry-after, or "try again in 1m30s" (Groq, OpenAI). */
export function requestedDelay(e: ErrorShape): number | undefined {
  const body = e.responseBody ?? ""
  const info = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)
  if (info) return Math.round(Number(info[1]) * 1000)
  const headers = lowerKeys(e.responseHeaders)
  const ms = Number(headers["retry-after-ms"])
  if (Number.isFinite(ms) && ms >= 0 && headers["retry-after-ms"] !== undefined) return ms
  const after = headers["retry-after"]
  if (after !== undefined) {
    const seconds = Number(after)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const date = Date.parse(after)
    if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  }
  const spoken = /try again in\s*(?:(\d+)m)?\s*(\d+(?:\.\d+)?)?\s*(ms|s)?/i.exec(`${e.message ?? ""} ${body}`)
  if (spoken && (spoken[1] || spoken[2])) {
    const minutes = Number(spoken[1] ?? 0)
    const value = Number(spoken[2] ?? 0)
    return Math.round(minutes * 60_000 + (spoken[3] === "ms" ? value : value * 1000))
  }
  return undefined
}

function lowerKeys(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) out[key.toLowerCase()] = value
  return out
}

export function backoff(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1))
  return Math.min(CAP_MS, Math.round(base * (1 + 0.25 * random())))
}

function retriesFor(kind: FailureKind): number {
  if (kind === "rate-limit") return RATE_RETRIES
  if (kind === "overloaded" || kind === "network") return RETRIES
  return 0
}

/** Tests set OPENTRADING_RETRY_SCALE=0 so retries do not sleep. */
const scale = () => {
  const value = Number(process.env.OPENTRADING_RETRY_SCALE ?? "1")
  return Number.isFinite(value) && value >= 0 ? value : 1
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
    }
    if (signal?.aborted) return abort()
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }, ms * scale())
    signal?.addEventListener("abort", abort, { once: true })
  })
}

/** Run `call`, retrying what {@link classifyFailure} says may succeed later. */
export async function withRetries<T>(call: () => PromiseLike<T>, signal: AbortSignal | undefined, opts: RetryOptions = {}): Promise<T> {
  const sleep = opts.sleep ?? abortableSleep
  for (let attempt = 1; ; attempt++) {
    try {
      return await call()
    } catch (error) {
      if (signal?.aborted) throw error
      const failure = classifyFailure(error)
      const max = retriesFor(failure.kind)
      if (attempt > max) throw error
      const delayMs = failure.kind === "rate-limit" && failure.delayMs !== undefined ? failure.delayMs : backoff(attempt, opts.random)
      if (delayMs > MAX_WAIT_MS) throw error
      opts.onRetry?.({ attempt, max, delayMs, label: failure.label })
      await sleep(delayMs, signal)
    }
  }
}

/** Middleware that retries the model request (generate or stream) before anything streamed. */
export function retryMiddleware(opts: RetryOptions = {}): LanguageModelMiddleware {
  return {
    wrapGenerate: ({ doGenerate, params }) => withRetries(doGenerate, params.abortSignal, opts),
    wrapStream: ({ doStream, params }) => withRetries(doStream, params.abortSignal, opts),
  }
}

/** The wait as the UI shows it. */
export function retryText(notice: Pick<RetryNotice, "attempt" | "max" | "delayMs" | "label">): string {
  const seconds = Math.max(1, Math.round(notice.delayMs / 1000))
  return `Model ${notice.label}: thử lại sau ${seconds}s (lần ${notice.attempt}/${notice.max}). Esc để dừng.`
}

/** One line for the user when retries are exhausted or not possible. */
export function describeFailure(error: unknown): string | undefined {
  const failure = classifyFailure(error)
  if (failure.kind === "daily-quota") return "Model đã hết quota trong ngày (429). Đổi model bằng /model hoặc chờ quota reset."
  if (failure.kind === "rate-limit") {
    if (failure.delayMs === undefined) return "Hết quota hoặc bị giới hạn tốc độ (429). Thử lại sau hoặc đổi model."
    return `Model đang bị giới hạn tốc độ (429). Provider yêu cầu chờ khoảng ${Math.ceil(failure.delayMs / 1000)} giây. Thử lại sau hoặc đổi model.`
  }
  return undefined
}
