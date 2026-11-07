/**
 * The one deadline and retry policy of the turn binding's two reads (INVESTOR.md and the constraint
 * store), and the words a disk error is shown with. A read that fails is never turned into "nothing
 * there": the caller gets the error and holds the turn.
 */

const DEADLINE_MS = 2000
// Windows antivirus and sync tools hold a file for a moment: retry in under a second in all.
const RETRY_WINDOW_MS = 900
const RETRY_DELAYS_MS = [100, 200, 300]

/** The deadline passed (a drive that is not ready, a network share that hangs). */
export class ReadTimeout extends Error {}

export const errorCode = (error: unknown) => String((error as { code?: unknown }).code ?? "")

const REASONS: Record<string, string> = {
  EACCES: "không có quyền đọc file",
  EPERM: "không có quyền đọc file",
  EBUSY: "file đang bị chương trình khác giữ",
  EAGAIN: "file đang bị chương trình khác giữ",
  EISDIR: "đường dẫn là thư mục, không phải file",
  // Never the raw code: retry.ts reads "ETIMEDOUT" in an error as a network failure and would retry the run.
  ETIMEDOUT: "ổ đĩa không phản hồi",
}

/** Short Vietnamese reason of a disk error; never the file's content. */
export function diskReason(error: unknown): string {
  const code = errorCode(error)
  return REASONS[code] ?? `lỗi ${code || "không rõ"}`
}

const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${ms / 1000} giây`)

export function timeoutReason(deadlineMs: number): string {
  return `đọc quá ${duration(deadlineMs)} (ổ đĩa chưa sẵn sàng?)`
}

/** Disk errors worth a retry; a reader adds its own (a busy store). */
export const isPassingCode = (error: unknown) => ["EBUSY", "EPERM", "EAGAIN"].includes(errorCode(error))

/**
 * Runs `once`, retrying it 100, 200, 300 ms apart while `passing` says the error is passing and the
 * first failure is younger than the window, all under one deadline. Throws ReadTimeout or the last error.
 */
export async function timedRead<T>(
  once: () => Promise<T>,
  opts: { passing: (error: unknown) => boolean; deadlineMs?: number; retryWindowMs?: number },
): Promise<T> {
  const retryWindowMs = opts.retryWindowMs ?? RETRY_WINDOW_MS
  const withRetries = async () => {
    let firstFailure: number | undefined
    for (let attempt = 0; ; attempt++) {
      try {
        return await once()
      } catch (error) {
        firstFailure ??= Date.now()
        const delay = RETRY_DELAYS_MS[attempt]
        if (!opts.passing(error) || delay === undefined || Date.now() - firstFailure + delay > retryWindowMs) throw error
        await Bun.sleep(delay)
      }
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReadTimeout()), opts.deadlineMs ?? DEADLINE_MS)
  })
  try {
    return await Promise.race([withRetries(), deadline])
  } finally {
    clearTimeout(timer)
  }
}

export { DEADLINE_MS }
