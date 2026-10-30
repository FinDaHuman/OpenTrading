import { lstat, readdir, rmdir, unlink } from "node:fs/promises"
import path from "node:path"
import type { Scratchpad } from "./scratch"

/**
 * Size and age of the scratchpad folders (scratch.ts). Claude Code never cleans its temp
 * folders, so they grow without bound; here old sessions go after `keepDays` and the user
 * hears when the project's folders pass a size.
 *
 * Every walk uses lstat and never enters a link: a junction in a session folder may point at
 * home, and neither counting nor deleting may follow it.
 */

export const SCRATCH_KEEP_DAYS = 30
export const SCRATCH_WARN_MB = 1024
/** At most one size walk this often (it runs in the background, after a turn starts). */
export const SCAN_INTERVAL_MS = 30 * 60_000
/** Entries one walk looks at; past that the size is "at least". */
const MAX_ENTRIES = 50_000

export interface TreeSize {
  bytes: number
  files: number
  /** Newest mtime seen (files and folders), ms. */
  newest: number
  /** Stopped at MAX_ENTRIES: the numbers are a lower bound. */
  partial: boolean
}

/** Bytes, files and newest mtime under `dir`, links not followed; zeros when it is missing. */
export async function treeSize(dir: string, maxEntries = MAX_ENTRIES): Promise<TreeSize> {
  const size: TreeSize = { bytes: 0, files: 0, newest: 0, partial: false }
  const stack = [dir]
  let seen = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    if (++seen > maxEntries) {
      size.partial = true
      break
    }
    let info
    try {
      info = await lstat(current)
    } catch {
      continue
    }
    size.newest = Math.max(size.newest, info.mtimeMs)
    if (info.isSymbolicLink()) continue
    if (!info.isDirectory()) {
      size.bytes += info.size
      size.files++
      continue
    }
    try {
      for (const name of await readdir(current)) stack.push(path.join(current, name))
    } catch {
      // unreadable: count what we can
    }
  }
  return size
}

/** Delete `p`; a link is removed as a link, its target untouched (a junction too). */
export async function removeTree(p: string): Promise<void> {
  let info
  try {
    info = await lstat(p)
  } catch {
    return
  }
  if (info.isSymbolicLink()) {
    // Windows: a directory link or junction goes with rmdir, a file link with unlink.
    await unlink(p).catch(() => rmdir(p))
    return
  }
  if (!info.isDirectory()) return unlink(p)
  for (const name of await readdir(p)) await removeTree(path.join(p, name))
  await rmdir(p)
}

/** A real folder of ours (POSIX: owned by this user), never a link. */
async function ownedDir(p: string): Promise<boolean> {
  try {
    const info = await lstat(p)
    return !info.isSymbolicLink() && info.isDirectory() && (!process.getuid || info.uid === process.getuid())
  } catch {
    return false
  }
}

async function children(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

/**
 * Delete session folders untouched for `days` (newest mtime anywhere inside), in every
 * project under `base`, then the projects left empty. `skip`: folders kept anyway (this
 * session). A walk that hit the entry limit keeps its folder: its newest file may be unseen.
 */
export async function pruneScratch(base: string, days = SCRATCH_KEEP_DAYS, opts: { now?: number; skip?: string[] } = {}): Promise<number> {
  const now = opts.now ?? Date.now()
  const skip = new Set((opts.skip ?? []).map((p) => path.resolve(p)))
  let removed = 0
  if (!(await ownedDir(base))) return 0
  for (const project of await children(base)) {
    if (!(await ownedDir(project))) continue
    for (const session of await children(project)) {
      if (skip.has(path.resolve(session)) || !(await ownedDir(session))) continue
      const size = await treeSize(session)
      if (size.partial || now - size.newest <= days * 86_400_000) continue
      try {
        await removeTree(session)
        removed++
      } catch {
        // in use by another process
      }
    }
    if ((await children(project)).length === 0) await rmdir(project).catch(() => {})
  }
  return removed
}

/** Another OpenTrading window in the same folder may be using a session folder changed this recently. */
export const CLEAR_SPARE_MS = 60 * 60_000

/**
 * /scratch clear: delete the project's other session folders not changed in the last hour
 * (another window in the same folder may be live); `current` also deletes this session's.
 */
export async function clearScratch(pad: Scratchpad, opts: { current?: boolean; now?: number } = {}): Promise<{ removed: number; spared: number }> {
  const now = opts.now ?? Date.now()
  const mine = pad.dir() ? path.resolve(path.dirname(pad.dir()!)) : undefined
  let removed = 0
  let spared = 0
  if (!(await ownedDir(pad.project))) return { removed, spared }
  for (const session of await children(pad.project)) {
    const isMine = path.resolve(session) === mine
    if ((isMine && !opts.current) || !(await ownedDir(session))) continue
    if (!isMine) {
      const size = await treeSize(session)
      if (size.partial || now - size.newest < CLEAR_SPARE_MS) {
        spared++
        continue
      }
    }
    try {
      await removeTree(session)
      removed++
    } catch {
      spared++
    }
  }
  return { removed, spared }
}

/** "820 MB", "1,3 GB" (Vietnamese decimal comma). */
export function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb < 1) return `${Math.max(0, Math.round(bytes / 1024))} KB`
  if (mb < 1024) return `${Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1).replace(".", ",")} GB`
}

export interface ScratchUsage {
  project: TreeSize
  session: TreeSize
  /** Session folders in the project. */
  sessions: number
}

/** The project's folders and this session's, for /scratch and the size warning. */
export async function scratchUsage(pad: Scratchpad): Promise<ScratchUsage> {
  const dir = pad.dir()
  const [project, session, sessions] = await Promise.all([
    treeSize(pad.project),
    dir ? treeSize(path.dirname(dir)) : Promise.resolve({ bytes: 0, files: 0, newest: 0, partial: false }),
    children(pad.project).then((c) => c.length),
  ])
  return { project, session, sessions }
}

/**
 * The size warning under an answer: a background walk when a turn starts (at most once per
 * SCAN_INTERVAL_MS), read when the turn ends. Each step of `warnBytes` is reported once
 * (1 GB, then 2 GB…); dropping below the first step resets it.
 */
export class ScratchMonitor {
  private lastStart = Number.NEGATIVE_INFINITY
  private pending?: Promise<void>
  private latest?: ScratchUsage
  private step = 0
  private reported = 0

  constructor(
    private readonly pad: Scratchpad,
    private readonly opts: { warnBytes: () => number | Promise<number>; intervalMs?: number; now?: () => number; usage?: (pad: Scratchpad) => Promise<ScratchUsage> } = {
      warnBytes: () => SCRATCH_WARN_MB * 1024 * 1024,
    },
  ) {}

  /** A turn started: walk the folders in the background if the last walk is old enough. */
  start(): void {
    const now = this.opts.now?.() ?? Date.now()
    if (!this.pad.active || this.pending || now - this.lastStart < (this.opts.intervalMs ?? SCAN_INTERVAL_MS)) return
    this.lastStart = now
    this.pending = Promise.all([this.opts.warnBytes(), (this.opts.usage ?? scratchUsage)(this.pad)])
      .then(([step, usage]) => {
        this.step = step
        this.latest = usage
      })
      .catch(() => {})
      .finally(() => (this.pending = undefined))
  }

  /** Wait for a walk in flight (tests). */
  async settled(): Promise<void> {
    await this.pending
  }

  /** The warning to show under this turn's answer, once per step crossed; undefined otherwise. */
  takeWarning(): string | undefined {
    const usage = this.latest
    if (!usage) return undefined
    this.latest = undefined
    if (this.step <= 0) return undefined
    const level = Math.floor(usage.project.bytes / this.step)
    if (level === 0) this.reported = 0
    if (level <= this.reported) return undefined
    this.reported = level
    const atLeast = usage.project.partial ? "hơn " : ""
    return `Thư mục tạm của dự án đã ${atLeast}${formatSize(usage.project.bytes)} (phiên này ${formatSize(usage.session.bytes)}, ${usage.sessions} phiên): ${this.pad.project} · /scratch để xem, /scratch clear để xoá các phiên khác`
  }
}
