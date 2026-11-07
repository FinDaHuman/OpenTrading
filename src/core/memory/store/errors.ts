/**
 * The one place SQLite errors become memory-store errors. Callers (the /memory UI in a later
 * spec) switch on `kind`; `message` is Vietnamese. A message may quote user text only after it
 * passed the input checks (text.ts), which refuse secrets; anything unchecked is never quoted.
 */

export type MemoryStoreErrorKind =
  | "newer_schema"
  | "not_a_store"
  | "open_failed"
  | "busy"
  | "write_failed"
  | "corrupt"
  | "conflict"
  | "deleted"
  | "not_found"
  | "invalid"
  | "limit"
  | "secret"
  | "alias_taken"

export class MemoryStoreError extends Error {
  override readonly name = "MemoryStoreError"

  constructor(
    readonly kind: MemoryStoreErrorKind,
    message: string,
    /** The current record on a conflict, so the form can show a diff. */
    readonly current?: unknown,
  ) {
    super(message)
  }
}

const sqliteCode = (error: unknown) => (error as { code?: unknown }).code

const detail = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isBusy = (code: unknown) => typeof code === "string" && code.startsWith("SQLITE_BUSY")
const isCorrupt = (code: unknown) => typeof code === "string" && code.startsWith("SQLITE_CORRUPT")

const busy = () =>
  new MemoryStoreError("busy", "Kho memory đang bận (một cửa sổ OpenTrading khác đang ghi). Thử lại.")

const corrupt = (error: unknown) =>
  new MemoryStoreError("corrupt", `Dữ liệu trong kho memory bị hỏng: ${detail(error)}`)

/** An error while opening, checking or migrating the store file. */
export function openError(error: unknown, file: string): MemoryStoreError {
  if (error instanceof MemoryStoreError) return error
  const code = sqliteCode(error)
  if (isBusy(code)) return busy()
  if (isCorrupt(code)) return corrupt(error)
  if (code === "SQLITE_NOTADB") {
    return new MemoryStoreError(
      "not_a_store",
      `File ${file} không phải kho memory của OpenTrading (${detail(error)}). File được giữ nguyên.`,
    )
  }
  return new MemoryStoreError("open_failed", `Không mở được kho memory ${file}: ${detail(error)}`)
}

/** An error inside a read or a write transaction. */
export function storeError(error: unknown): MemoryStoreError {
  if (error instanceof MemoryStoreError) return error
  const code = sqliteCode(error)
  if (isBusy(code)) return busy()
  // A list column that does not parse was damaged outside the store: say so, never read it as empty.
  if (isCorrupt(code) || code === "SQLITE_NOTADB" || error instanceof SyntaxError) return corrupt(error)
  return new MemoryStoreError("write_failed", `Kho memory báo lỗi: ${detail(error)}`)
}
