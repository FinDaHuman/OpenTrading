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
  await rename(tmp, file)
}
