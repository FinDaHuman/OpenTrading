import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return fallback
  }
}

/** Write via a temp file + rename so a crash mid-write never leaves half a JSON file behind. */
export async function writeJson(file: string, value: unknown, secret = false) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: secret ? 0o600 : 0o644 })
  if (secret && process.platform !== "win32") await chmod(tmp, 0o600)
  // Windows refuses to replace a file another handle has open for a moment (a reader, an
  // antivirus scan): EPERM/EBUSY. Retry briefly instead of failing the save.
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(tmp, file)
    } catch (error) {
      const code = (error as { code?: string }).code
      if (attempt >= 9 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)))
    }
  }
}
