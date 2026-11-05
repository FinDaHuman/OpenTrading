import { stat } from "node:fs/promises"
import type { MemoryRole } from "../policy"
import { MemoryStoreError } from "../store/errors"
import { openStoreReadOnly } from "../store/read-only"
import { DEADLINE_MS, diskReason, isPassingCode, ReadTimeout, timedRead, timeoutReason } from "./timed-read"

/**
 * The user's constraints as the host sends them to the main agent and every sub-agent, whatever /config
 * chose for memory. Each read opens memory.db read-only and closes it at once: no handle is ever kept,
 * so Windows never sees the file held, and switching memory in /config needs nothing closed here.
 */

export interface ConstraintLine {
  id: number
  version: number
  text: string
}

/** Why a source could not be read: shown to the user, and in short to the model or the main agent. */
export interface SourceFailure {
  file: string
  /** Short Vietnamese reason, never the file's content. */
  reason: string
  /** Will not pass on its own (newer schema, foreign file, damaged data): the message then shows a way out. */
  lasting: boolean
  newerSchema: boolean
}

export type ConstraintRead =
  | { state: "none" }
  | { state: "loaded"; lines: ConstraintLine[] }
  | { state: "failed"; failure: SourceFailure }

export interface ConstraintReader {
  readonly file: string
  read(role: Extract<MemoryRole, "main_agent" | "subagent">): Promise<ConstraintRead>
}

export interface ConstraintReaderOptions {
  /** The whole read, retries included. */
  deadlineMs?: number
  /** Passing errors are retried while the first one is younger than this. */
  retryWindowMs?: number
  /** How long one open waits for another window's lock. */
  busyTimeoutMs?: number
}

/**
 * Test seam (spyOn). bun:sqlite is synchronous and cannot be cut short, so an asynchronous look at the
 * file comes first: a drive that is not ready hangs here, where the deadline applies.
 */
export const constraintDisk = {
  async probe(file: string): Promise<"missing" | "present"> {
    try {
      await stat(file)
      return "present"
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code === "ENOENT" || code === "ENOTDIR") return "missing"
      throw error
    }
  },
}

const BUSY_TIMEOUT_MS = 100

const LASTING_KINDS = new Set(["newer_schema", "not_a_store", "corrupt"])

/** Same words the notebook uses for the model. */
const STORE_REASON: Record<string, string> = {
  newer_schema: "kho do phiên bản OpenTrading mới hơn tạo",
  not_a_store: "file không phải kho memory của OpenTrading",
  corrupt: "dữ liệu trong kho bị hỏng",
  busy: "một cửa sổ OpenTrading khác đang nâng cấp kho",
  open_failed: "không mở được file kho",
}

/** A disk error worth a retry, or the store busy with another window's write. */
const isPassing = (error: unknown) => (error instanceof MemoryStoreError ? error.kind === "busy" : isPassingCode(error))

function failureOf(file: string, error: unknown, deadlineMs: number): SourceFailure {
  if (error instanceof MemoryStoreError) {
    return {
      file,
      reason: STORE_REASON[error.kind] ?? "kho báo lỗi khi đọc",
      lasting: LASTING_KINDS.has(error.kind),
      newerSchema: error.kind === "newer_schema",
    }
  }
  const reason = error instanceof ReadTimeout ? timeoutReason(deadlineMs) : diskReason(error)
  return { file, reason, lasting: false, newerSchema: false }
}

export function createConstraintReader(file: string, opts: ConstraintReaderOptions = {}): ConstraintReader {
  const deadlineMs = opts.deadlineMs ?? DEADLINE_MS
  const busyTimeoutMs = opts.busyTimeoutMs ?? BUSY_TIMEOUT_MS

  async function once(role: "main_agent" | "subagent"): Promise<ConstraintRead> {
    if ((await constraintDisk.probe(file)) === "missing") return { state: "none" }
    const store = openStoreReadOnly(file, { busyTimeoutMs })
    if (store.state !== "open") return { state: "none" }
    try {
      // The policy table decides what each role reads; only the constraints are taken from it here.
      const lines = store.gate
        .read(role, "system")
        .filter((item) => item.kind === "constraint")
        .map((item) => ({
          id: item.fields.id as number,
          version: item.fields.version as number,
          text: item.fields.text as string,
        }))
      return { state: "loaded", lines }
    } finally {
      store.close()
    }
  }

  return {
    file,
    async read(role) {
      try {
        return await timedRead(() => once(role), { passing: isPassing, deadlineMs, retryWindowMs: opts.retryWindowMs })
      } catch (error) {
        return { state: "failed", failure: failureOf(file, error, deadlineMs) }
      }
    },
  }
}
