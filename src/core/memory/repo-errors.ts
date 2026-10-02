/** SQLite reports lock contention as SQLITE_BUSY (5) or SQLITE_LOCKED (6). */
export function isSqliteBusy(error: unknown): boolean {
  const e = error as { code?: unknown; errno?: unknown }
  return e?.code === "SQLITE_BUSY" || e?.code === "SQLITE_LOCKED" || e?.errno === 5 || e?.errno === 6
}

/** The one place SQLite errors become memory errors. Messages carry no memory body. */
export class StorageError extends Error {
  constructor(
    readonly code: "storage_busy" | "storage_failed",
    options?: { cause?: unknown },
  ) {
    super(code === "storage_busy" ? "memory database is locked" : "memory database operation failed", options)
  }
}

export const guard = <T>(fn: () => T): T => {
  try {
    return fn()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError(isSqliteBusy(error) ? "storage_busy" : "storage_failed", { cause: error })
  }
}
