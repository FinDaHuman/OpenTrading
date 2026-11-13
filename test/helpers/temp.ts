import { afterAll } from "bun:test"
import { mkdtempSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Temp folders removed when the test file ends. Each full run used to leave 14 folders in the
 * system temp dir (thousands after a few weeks). Importing this module registers the cleanup for
 * the importing file; folders still open elsewhere (a SQLite file on Windows) are left, not fatal.
 */
const made: string[] = []

afterAll(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})))
})

/** A new folder under the system temp dir, named `<prefix>XXXXXX`, removed after the file's tests. */
export async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  made.push(dir)
  return dir
}

/**
 * Removes a temp folder a test made, and nothing else: "" or a path outside the system temp dir is
 * left alone. Bun's `rm("", { recursive: true })` empties the current directory, the checkout under
 * test: what an after hook did when `mkdtemp` in its before hook had failed (TEMP pointing nowhere).
 */
export async function removeTempDir(dir: string, opts: { maxRetries?: number; retryDelay?: number } = {}) {
  const root = path.resolve(os.tmpdir()) + path.sep
  if (!dir || !path.resolve(dir).startsWith(root)) return
  await rm(dir, { recursive: true, force: true, ...opts })
}

export function tempDirSync(prefix: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  made.push(dir)
  return dir
}
