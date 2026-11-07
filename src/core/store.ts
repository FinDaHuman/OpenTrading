import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { withFileLock } from "./file-lock"

/** JSON text as editors save it: Notepad and PowerShell 5 put a UTF-8 BOM first, which JSON.parse rejects. */
export const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(stripBom(await readFile(file, "utf8"))) as T
  } catch {
    return fallback
  }
}

/** A file another handle has open for a moment on Windows (a reader, an antivirus scan). */
const busy = (error: unknown) => ["EPERM", "EBUSY", "EACCES"].includes((error as { code?: string }).code ?? "")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Read a JSON object that is about to be changed and written back. Unlike readJson, only a
 * missing file counts as `fallback`: a file that is locked, unreadable, not JSON or not an
 * object throws, so a save never replaces what it could not read (codex config/edit.rs does
 * the same). Briefly locked files are retried, as writeJson does.
 */
export async function readJsonForUpdate<T extends object>(file: string, fallback: T): Promise<T> {
  let text: string
  for (let attempt = 0; ; attempt++) {
    try {
      text = await readFile(file, "utf8")
      break
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === "ENOENT") return fallback
      if (attempt < 9 && busy(error)) {
        await sleep(20 * (attempt + 1))
        continue
      }
      throw unreadable(file, code ?? (error instanceof Error ? error.message : String(error)))
    }
  }
  let value: unknown
  try {
    value = JSON.parse(stripBom(text))
  } catch {
    throw unreadable(file, "JSON lỗi")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unreadable(file, "không phải object JSON")
  return value as T
}

const unreadable = (file: string, why: string) =>
  new Error(`Không đọc được ${file} (${why}): chưa ghi để không mất dữ liệu cũ. Sửa hoặc xoá file này.`)

/** The rename writeJson retries; a seam so tests can make an attempt fail with EBUSY on any OS. */
export const jsonFiles = {
  rename: (from: string, to: string) => rename(from, to),
}

/**
 * Write via a temp file + rename so a crash mid-write never leaves half a JSON file behind.
 * `beforeCommit` (a file lock's assertHeld) runs before every rename attempt: when it throws,
 * the temp file is removed and the target is left as it was.
 */
export async function writeJson(
  file: string,
  value: unknown,
  secret = false,
  opts: { beforeCommit?: () => Promise<void> } = {},
) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: secret ? 0o600 : 0o644 })
    if (secret && process.platform !== "win32") await chmod(tmp, 0o600)
  } catch (error) {
    // A half-written temp copy goes too (every failure below removes it as well).
    await rm(tmp, { force: true })
    throw error
  }
  // Windows refuses to replace a file another handle has open for a moment (a reader, an
  // antivirus scan): EPERM/EBUSY. Retry briefly instead of failing the save. The lock can be
  // lost while waiting, hence the check inside the loop.
  for (let attempt = 0; ; attempt++) {
    if (opts.beforeCommit) {
      try {
        await opts.beforeCommit()
      } catch (error) {
        await rm(tmp, { force: true })
        throw error
      }
    }
    try {
      return await jsonFiles.rename(tmp, file)
    } catch (error) {
      if (attempt >= 9 || !busy(error)) {
        // Never leave the temp copy behind: for auth.json it holds the key.
        await rm(tmp, { force: true }).catch(() => {})
        throw error
      }
      await sleep(20 * (attempt + 1))
    }
  }
}

const updates = new Map<string, Promise<unknown>>()

/**
 * Read-modify-write of a JSON file: in order within this process, under a lock file across
 * processes (file-lock.ts), from what is on disk inside the lock, and never over a file that
 * could not be read (readJsonForUpdate). Resolves with what was written.
 */
export function updateJson<T extends object>(file: string, fallback: T, change: (current: T) => T, opts: { secret?: boolean } = {}): Promise<T> {
  const run = (updates.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(() =>
      withFileLock(file, async (lock) => {
        const next = change(await readJsonForUpdate(file, fallback))
        // Re-check the lock right before the rename: a lock taken over while we waited must not be overwritten.
        await writeJson(file, next, opts.secret, { beforeCommit: lock.assertHeld })
        return next
      }),
    )
  updates.set(file, run)
  return run
}
