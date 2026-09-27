import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T
  } catch {
    return fallback
  }
}

export async function writeJson(file: string, value: unknown, secret = false) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8")
  if (secret && process.platform !== "win32") await chmod(file, 0o600)
}
