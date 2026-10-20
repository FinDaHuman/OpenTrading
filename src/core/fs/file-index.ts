import path from "node:path"
import { isSecretDir, secretReason, type SafetyEnv } from "./path-safety"
import { walkFiles } from "./walk"

/** Lowercase without Vietnamese accents (as the TUI's `fold`): "bao cao" finds "báo-cáo.md". */
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase()

/**
 * The files `@` offers in the prompt. In a git repository, `git ls-files` (tracked plus
 * untracked, .gitignore respected: Claude Code's choice); elsewhere, or without git, the same
 * walk glob_files uses (VCS and package folders pruned). Folders come from the file paths.
 * Secret files and folders are never listed.
 */

export const MAX_INDEXED = 50_000
/** An index older than this is rebuilt the next time the list opens (Claude Code: 5s). */
export const INDEX_FRESH_MS = 5_000
/** A query that matches nothing rebuilds an index older than this (a file made just now). */
export const INDEX_MISS_MS = 1_000

export interface IndexedPath {
  /** Relative to the root, `/` separated; folders end with `/`. */
  rel: string
  dir: boolean
  /** Lowercased, accents removed: what queries match against. */
  folded: string
  base: string
}

async function gitFiles(root: string): Promise<string[] | undefined> {
  try {
    // -z: names as they are, NUL-separated. Without it git quotes non-ASCII names
    // ("b\303\241o-c\303\241o.md"), which would mangle every Vietnamese file name.
    const proc = Bun.spawn(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, stdout: "pipe", stderr: "ignore", stdin: "ignore" })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) return undefined
    return out.split("\0").filter(Boolean)
  } catch {
    return undefined // no git on PATH
  }
}

function entry(rel: string, dir: boolean): IndexedPath {
  const name = rel.replace(/\/$/, "")
  return { rel, dir, folded: fold(rel), base: fold(name.slice(name.lastIndexOf("/") + 1)) }
}

/** Every file under `root` (and the folders above them), sorted, at most MAX_INDEXED. */
export async function indexFiles(root: string, env?: SafetyEnv): Promise<{ paths: IndexedPath[]; capped: boolean }> {
  let files = await gitFiles(root)
  let capped = false
  if (files) {
    files = files.filter((rel) => !secretReason(path.join(root, rel), env))
  } else {
    const walked = await walkFiles(root, { maxEntries: MAX_INDEXED, env })
    files = walked.files.map((f) => f.rel)
    capped = walked.capped
  }
  if (files.length > MAX_INDEXED) {
    files = files.slice(0, MAX_INDEXED)
    capped = true
  }
  const dirs = new Set<string>()
  const out: IndexedPath[] = []
  for (const rel of files) {
    const parts = rel.split("/")
    let skip = false
    for (let i = 1; i < parts.length; i++) {
      const dir = `${parts.slice(0, i).join("/")}/`
      if (dirs.has(dir)) continue
      if (isSecretDir(path.join(root, dir), env)) {
        skip = true
        break
      }
      dirs.add(dir)
      out.push(entry(dir, true))
    }
    if (!skip) out.push(entry(rel, false))
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel))
  return { paths: out, capped }
}

/**
 * Paths for a query, best first: name starts with it, name contains it, path contains it,
 * then its letters in order (shorter paths first within each). An empty query lists the
 * top level. A query ending in `/` lists that folder.
 */
export function matchPaths(paths: readonly IndexedPath[], query: string, limit = 50): IndexedPath[] {
  const q = fold(query.replace(/\\/g, "/"))
  if (!q || q.endsWith("/")) {
    const dir = q
    const depth = dir ? dir.split("/").length - 1 : 0
    return paths
      .filter((p) => p.folded.startsWith(dir) && p.folded !== dir && p.rel.replace(/\/$/, "").split("/").length === depth + 1)
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.rel.localeCompare(b.rel))
      .slice(0, limit)
  }
  const scored: { p: IndexedPath; score: number }[] = []
  for (const p of paths) {
    let score: number
    if (p.base.startsWith(q)) score = 4000
    else if (p.base.includes(q)) score = 3000
    else if (p.folded.includes(q)) score = 2000
    else if (subsequence(p.folded, q)) score = 1000
    else continue
    scored.push({ p, score: score - Math.min(999, p.rel.length) })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.p.rel.localeCompare(b.p.rel))
    .slice(0, limit)
    .map((s) => s.p)
}

function subsequence(text: string, query: string) {
  let i = 0
  for (const ch of text) if (ch === query[i] && ++i === query.length) return true
  return false
}

/** One index per root, rebuilt in the background once stale. */
export class FileIndex {
  private paths: IndexedPath[] = []
  private builtAt = 0
  private building: Promise<boolean> | undefined

  constructor(
    readonly root: string,
    private env?: SafetyEnv,
  ) {}

  private soon: Promise<boolean> | undefined

  /** Rebuild once the index is `maxAge` old (now, if it already is); true when it was rebuilt. */
  refreshAfter(maxAge: number): Promise<boolean> {
    const wait = this.builtAt ? this.builtAt + maxAge - Date.now() : 0
    if (wait <= 0) return this.refresh(Date.now(), maxAge)
    this.soon ??= new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.soon = undefined
        resolve(this.refresh(Date.now(), maxAge))
      }, wait)
      ;(timer as { unref?: () => void }).unref?.()
    })
    return this.soon
  }

  /** What is indexed now (empty until the first build ends). */
  current(): readonly IndexedPath[] {
    return this.paths
  }

  /** Rebuild if older than `maxAge`; resolves when the index is fresh, true if it was rebuilt. */
  refresh(now = Date.now(), maxAge = INDEX_FRESH_MS): Promise<boolean> {
    if (this.building) return this.building
    if (this.builtAt && now - this.builtAt < maxAge) return Promise.resolve(false)
    this.building = indexFiles(this.root, this.env)
      .then((r) => {
        this.paths = r.paths
        this.builtAt = Date.now()
        return true
      })
      .catch(() => {
        this.builtAt = Date.now() // unreadable root: an empty list, retried later
        return false
      })
      .finally(() => {
        this.building = undefined
      })
    return this.building
  }
}
