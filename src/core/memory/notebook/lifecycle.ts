import { MemoryStoreError, storeError } from "../store/errors"
import { openMemoryStore, type MemoryStore } from "../store/open"
import { createNotebookAdmin, grantNotebookAdmin } from "./admin"
import { NotebookMemory, type NotebookSource } from "./provider"

/**
 * Opens the notebook store and hands out its two sides: the provider (model-facing, the policy-checked
 * read path only) and, for the /memory screen, the user's read and delete. A store that fails to open
 * still yields a provider, in an error state that says why on every channel; the file is never touched.
 */

export interface NotebookOptions {
  now?: () => Date
  /** Lock wait for the first open (default: the store's 1 s). */
  busyTimeoutMs?: number
  /** Lock wait when retrying an open that failed as busy; short, since it runs at the start of a turn. */
  retryBusyTimeoutMs?: number
}

const RETRY_BUSY_MS = 200

export function openNotebook(file: string, opts: NotebookOptions = {}): NotebookMemory {
  let store: MemoryStore | undefined
  let error: MemoryStoreError | undefined
  let closed = false

  const open = (busyTimeoutMs: number | undefined) => {
    try {
      store = openMemoryStore(file, { now: opts.now, busyTimeoutMs })
      error = undefined
    } catch (e) {
      store = undefined
      error = e instanceof MemoryStoreError ? e : storeError(e)
    }
  }
  open(opts.busyTimeoutMs)

  // Closures over the store: whoever holds `source` can reach the gate, never the writer.
  const source: NotebookSource = Object.freeze({
    path: file,
    gate: () => store?.gate,
    changed: () => store?.changed() ?? false,
    problem: () => error,
    closed: () => closed,
    retryIfBusy() {
      // Only "busy" passes on its own (another window migrating the store); a newer schema, a foreign or
      // damaged file stays as it is until the user acts, so retrying every turn would only repeat the error.
      if (!closed && !store && error?.kind === "busy") open(opts.retryBusyTimeoutMs ?? RETRY_BUSY_MS)
    },
    fail(e: unknown) {
      const failure = e instanceof MemoryStoreError ? e : storeError(e)
      // Closed now so Windows releases the file; reopening is the user's call (or the next busy retry).
      store?.close()
      store = undefined
      error = failure
      return failure
    },
    close() {
      closed = true
      store?.close()
      store = undefined
    },
  })
  const provider = new NotebookMemory(source)
  grantNotebookAdmin(
    provider,
    createNotebookAdmin({
      path: file,
      reader: () => store?.reader,
      writer: () => store?.writer,
      problem: () => error,
      closed: () => closed,
    }),
  )
  return provider
}
