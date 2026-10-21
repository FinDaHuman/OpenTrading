import { mkdir, open, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"

/**
 * A lock on `file` shared by every OpenTrading process: `<file>.lock`, created exclusively
 * ("wx"), holding the owner's pid. Two TUIs (or a TUI and a headless run) that read-modify-write
 * the same JSON file would otherwise each read the old copy and overwrite the other's change;
 * the atomic rename in writeJson only prevents a half-written file, not a lost update.
 *
 * A lock left by a process that died is taken over: its pid is gone, or it is older than
 * `staleMs`. Waiting longer than `timeoutMs` is an error, never a silent overwrite.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists, it is just not ours to signal.
    return (error as { code?: string }).code === "EPERM"
  }
}

/** The lock's content when it is stale, so the takeover can check nobody replaced it meanwhile. */
async function staleContent(lock: string, staleMs: number): Promise<string | undefined> {
  let text: string
  let mtimeMs: number
  try {
    ;[text, { mtimeMs }] = await Promise.all([readFile(lock, "utf8"), stat(lock)])
  } catch {
    return undefined // gone already: the next attempt creates it
  }
  if (Date.now() - mtimeMs > staleMs) return text
  const pid = Number(/"pid":(\d+)/.exec(text)?.[1])
  // An empty file is a lock being written right now, not a dead one.
  return pid && pid !== process.pid && !alive(pid) ? text : undefined
}

export async function withFileLock<T>(file: string, run: () => Promise<T>, opts: { timeoutMs?: number; staleMs?: number } = {}): Promise<T> {
  const lock = `${file}.lock`
  const timeoutMs = opts.timeoutMs ?? 10_000
  const staleMs = opts.staleMs ?? 30_000
  const deadline = Date.now() + timeoutMs
  await mkdir(path.dirname(file), { recursive: true })
  for (;;) {
    try {
      const handle = await open(lock, "wx")
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }))
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error
    }
    const stale = await staleContent(lock, staleMs)
    if (stale !== undefined) {
      // Only the dead owner's lock goes: one another process just created is left alone.
      const now = await readFile(lock, "utf8").catch(() => undefined)
      if (now === stale) await rm(lock, { force: true })
      continue
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Không ghi được ${file}: một tiến trình OpenTrading khác đang giữ khoá ${lock} quá ${Math.round(timeoutMs / 1000)}s. Thử lại sau; nếu không còn OpenTrading nào chạy thì xoá file khoá đó.`,
      )
    }
    await sleep(10 + Math.random() * 40)
  }
  try {
    return await run()
  } finally {
    await rm(lock, { force: true })
  }
}
