import { afterAll } from "bun:test"
import { mkdtempSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Temp folders removed when the calling test file ends. Each full run used to leave 14 folders in
 * the system temp dir (thousands after a few weeks).
 *
 * Call it at the top of the file: that registers the cleanup for this file. (A hook registered in
 * this module's own top level would belong only to the first file that loads it when `bun test`
 * runs without --parallel, since files then share one module registry.) Folders still open
 * elsewhere (a SQLite file on Windows) are left, not fatal.
 */
export function tempDirs() {
  const made: string[] = []
  afterAll(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})))
  })
  return {
    /** A new folder under the system temp dir, named `<prefix>XXXXXX`. */
    async make(prefix: string) {
      const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
      made.push(dir)
      return dir
    },
    makeSync(prefix: string) {
      const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
      made.push(dir)
      return dir
    },
  }
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
