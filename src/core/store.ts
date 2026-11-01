import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/** JSON text as editors save it: Notepad and PowerShell 5 put a UTF-8 BOM first, which JSON.parse rejects. */
export const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(stripBom(await readFile(file, "utf8"))) as T
  } catch {
    return fallback
  }
}

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
      const code = (error as { code?: string }).code
      if (attempt >= 9 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        // Never leave the temp copy behind: for auth.json it holds the key.
        await rm(tmp, { force: true })
        throw error
      }
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)))
    }
  }
}
