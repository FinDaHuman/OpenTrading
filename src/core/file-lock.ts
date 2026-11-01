import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rm, stat, utimes, type FileHandle } from "node:fs/promises"
import path from "node:path"

/**
 * A lock on `file` shared by every OpenTrading process: `<file>.lock`, created exclusively
 * ("wx"), holding the owner's pid and a token unique to this hold. Two TUIs (or a TUI and a
 * headless run) that read-modify-write the same JSON file would otherwise each read the old
 * copy and overwrite the other's change; the atomic rename in writeJson only prevents a
 * half-written file, not a lost update.
 *
 * The owner touches the lock every `refreshMs` while it holds it. A lock is taken over when
 * its pid is gone, or when nobody touched it for `staleMs` (a reused pid, a machine that
 * slept): a slow owner that keeps refreshing is never taken over. Waiting longer than
 * `timeoutMs` is an error, never a silent overwrite.
 *
 * What is left: an owner that stops refreshing (a frozen process) can lose the lock while it
 * still runs. `HeldLock.assertHeld` lets it check right before it commits, so it fails
 * instead of overwriting; only the moment between that check and the commit stays open.
 */

export interface HeldLock {
  /** Throws when another process took the lock over since it was acquired. */
  assertHeld(): Promise<void>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The holder's reads and the lock's content write, gathered so tests can make one fail (EBUSY) on any OS. */
export const lockFiles = {
  create: (lock: string) => open(lock, "wx"),
  read: (lock: string) => readFile(lock, "utf8"),
  write: (handle: FileHandle, text: string) => handle.writeFile(text),
}

/**
 * Is the lock still this holder's? "unknown" when the file could not be read for another
 * reason than being gone (an antivirus scan or indexer holding it for a moment): that is no
 * proof another process took it over.
 */
async function check(lock: string, token: string): Promise<"ours" | "lost" | "unknown"> {
  try {
    return tokenOf(await lockFiles.read(lock)) === token ? "ours" : "lost"
  } catch (error) {
    return (error as { code?: string }).code === "ENOENT" ? "lost" : "unknown"
  }
}

/** `check`, retried briefly while the answer is "unknown". */
async function checkSettled(lock: string, token: string) {
  let state = await check(lock, token)
  for (let attempt = 0; state === "unknown" && attempt < 3; attempt++) {
    await sleep(20 * (attempt + 1))
    state = await check(lock, token)
  }
  return state
}

const tokenOf = (text: string | undefined) => (text ? /"token":"([^"]+)"/.exec(text)?.[1] : undefined)

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists, it is just not ours to signal.
    return (error as { code?: string }).code === "EPERM"
  }
}

/**
 * The lock's content and mtime when it is stale, so the takeover can check nobody replaced it
 * (content) or refreshed it (mtime) meanwhile.
 */
async function staleLock(lock: string, staleMs: number): Promise<{ text: string; mtimeMs: number } | undefined> {
  let text: string
  let mtimeMs: number
  try {
    ;[text, { mtimeMs }] = await Promise.all([readFile(lock, "utf8"), stat(lock)])
  } catch {
    return undefined // gone already: the next attempt creates it
  }
  // A live owner touches the lock every refreshMs, so this age means it stopped long ago.
  if (Date.now() - mtimeMs > staleMs) return { text, mtimeMs }
  // Read by regex: a lock written before tokens existed still parses.
  const pid = Number(/"pid":(\d+)/.exec(text)?.[1])
  // An empty file is a lock being written right now, not a dead one.
  return pid && pid !== process.pid && !alive(pid) ? { text, mtimeMs } : undefined
}

export async function withFileLock<T>(
  file: string,
  run: (lock: HeldLock) => Promise<T>,
  opts: { timeoutMs?: number; staleMs?: number; refreshMs?: number } = {},
): Promise<T> {
  const lock = `${file}.lock`
  const timeoutMs = opts.timeoutMs ?? 10_000
  // Six refresh periods: a live owner is never this late, and a dead one whose pid was reused
  // blocks writers no longer than before the refresh existed.
  const staleMs = opts.staleMs ?? 30_000
  // Well within staleMs, also when a caller shortens it (refresh only touches the mtime).
  const refreshMs = opts.refreshMs ?? Math.min(5_000, staleMs / 6)
  const token = randomUUID()
  const deadline = Date.now() + timeoutMs
  await mkdir(path.dirname(file), { recursive: true })
  // The last refusal that was not "the lock exists": reported as is if the wait runs out.
  let refused: unknown
  for (;;) {
    try {
      const handle = await lockFiles.create(lock)
      try {
        await lockFiles.write(handle, JSON.stringify({ pid: process.pid, at: Date.now(), token }))
      } catch (error) {
        // An empty lock reads as "being written" to everyone else: remove it rather than block them.
        try {
          await handle.close()
        } finally {
          await rm(lock, { force: true })
        }
        throw error
      }
      await handle.close()
      break
    } catch (error) {
      const code = (error as { code?: string }).code
      // Windows: a lock just removed while another process still has it open stays "delete
      // pending" for a moment, and creating it again fails with EPERM/EACCES (EBUSY likewise).
      if (code === "EPERM" || code === "EACCES" || code === "EBUSY") refused = error
      else if (code !== "EEXIST") throw error
      else refused = undefined
    }
    const stale = refused === undefined ? await staleLock(lock, staleMs) : undefined
    if (stale !== undefined) {
      // Only the dead owner's lock goes: one another process just created (other content) or a
      // late owner just refreshed (newer mtime, read after the content) is left alone.
      const now = await lockFiles.read(lock).catch(() => undefined)
      const touched = await stat(lock).then((s) => s.mtimeMs, () => undefined)
      if (now === stale.text && touched === stale.mtimeMs) await rm(lock, { force: true })
      continue
    }
    if (Date.now() > deadline) {
      if (refused !== undefined) throw refused
      throw new Error(
        `Không ghi được ${file}: một tiến trình OpenTrading khác đang giữ khoá ${lock} quá ${Math.round(timeoutMs / 1000)}s. Thử lại sau; nếu không còn OpenTrading nào chạy thì xoá file khoá đó.`,
      )
    }
    await sleep(10 + Math.random() * 40)
  }

  let lost = false
  let refreshing = false
  const timer = setInterval(async () => {
    if (refreshing || lost) return
    refreshing = true
    try {
      const state = await check(lock, token)
      // "unknown": skip this tick, the next one tries again.
      if (state === "lost") {
        lost = true
        clearInterval(timer)
      } else if (state === "ours") {
        const now = new Date()
        await utimes(lock, now, now).catch(() => {})
      }
    } finally {
      refreshing = false
    }
  }, refreshMs)
  // The refresh must not keep a process alive that is otherwise done.
  timer.unref?.()

  const held: HeldLock = {
    assertHeld: async () => {
      const state = lost ? "lost" : await checkSettled(lock, token)
      if (state === "ours") return
      if (state === "unknown") {
        // Not proof of a takeover, but not proof of ownership either: refuse rather than overwrite.
        throw new Error(`Không ghi được ${file}: không đọc được khoá ${lock} để kiểm, thay đổi chưa được lưu. Thử lại.`)
      }
      lost = true
      throw new Error(`Không ghi được ${file}: khoá ${lock} đã bị tiến trình khác chiếm, thay đổi chưa được lưu. Thử lại.`)
    },
  }
  try {
    return await run(held)
  } finally {
    clearInterval(timer)
    // Another process's lock (it took ours over) is left alone; one still unreadable after the
    // retries is left too, and goes once it is no longer refreshed (staleMs).
    if ((await checkSettled(lock, token)) === "ours") await rm(lock, { force: true })
  }
}
