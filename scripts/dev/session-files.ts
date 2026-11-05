import { readdirSync, statSync } from "node:fs"
import path from "node:path"

/** Every saved session under `root`, the index left out. */
export function sessionFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = path.join(root, name)
    return statSync(full).isDirectory() ? sessionFiles(full) : name.endsWith(".jsonl") && name !== "index.jsonl" ? [full] : []
  })
}
