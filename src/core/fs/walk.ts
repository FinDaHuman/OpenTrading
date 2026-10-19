import type { Dirent } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { isSecretDir, secretReason, type SafetyEnv } from "./path-safety"

/**
 * Walk a folder for glob_files / grep_files. Folders nobody wants searched (VCS, package
 * caches, virtualenvs) are pruned, secret trees and key files are skipped silently, and the
 * walk stops after `maxEntries` so a search rooted at a huge folder cannot hang the turn.
 */

const PRUNE = new Set([".git", ".hg", ".svn", ".jj", "node_modules", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache", ".next", ".cache", ".Trash", "$RECYCLE.BIN", "System Volume Information"])

export interface WalkEntry {
  abs: string
  /** Relative to the walk root, with `/` separators. */
  rel: string
}

export interface WalkResult {
  files: WalkEntry[]
  /** The entry limit stopped the walk early. */
  capped: boolean
}

export async function walkFiles(root: string, opts: { signal?: AbortSignal; maxEntries?: number; env?: SafetyEnv; accept?: (rel: string) => boolean } = {}): Promise<WalkResult> {
  const max = opts.maxEntries ?? 50_000
  const files: WalkEntry[] = []
  const queue: string[] = [root]
  let seen = 0
  while (queue.length > 0) {
    if (opts.signal?.aborted) throw new Error("Đã huỷ.")
    const dir = queue.shift()!
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable folder: skip, like rg
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (++seen > max) return { files, capped: true }
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (PRUNE.has(entry.name) || isSecretDir(abs, opts.env)) continue
        queue.push(abs)
      } else if (entry.isFile()) {
        if (secretReason(abs, opts.env)) continue
        const rel = path.relative(root, abs).split(path.sep).join("/")
        if (!opts.accept || opts.accept(rel)) files.push({ abs, rel })
      }
    }
  }
  return { files, capped: false }
}
