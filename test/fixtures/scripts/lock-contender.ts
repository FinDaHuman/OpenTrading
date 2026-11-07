// Child process for file-lock.test.ts: holds the lock on <file> for <holdMs>, logging
// "enter <pid> <ms>" and "exit <pid> <ms>" to <log> while inside.
import { appendFile } from "node:fs/promises"
import { withFileLock } from "../../../src/core/file-lock"

const [file, holdMs, staleMs, refreshMs, log] = process.argv.slice(2) as [string, string, string, string, string]
await withFileLock(
  file,
  async () => {
    await appendFile(log, `enter ${process.pid} ${Date.now()}\n`)
    await new Promise((r) => setTimeout(r, Number(holdMs)))
    await appendFile(log, `exit ${process.pid} ${Date.now()}\n`)
  },
  { staleMs: Number(staleMs), refreshMs: Number(refreshMs), timeoutMs: 20_000 },
)
console.log("done")
