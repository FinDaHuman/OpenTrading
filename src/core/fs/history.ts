import { appendFile, copyFile, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { hashBytes } from "./file-state"
import { samePathKey } from "./path-safety"

/**
 * Copies of files before write_file / edit_file change them, so /undo can put them back
 * (Claude Code file history; opencode keeps a shadow git repo). An investor's folder is
 * rarely under git, so this is the only way back. One folder per run of OpenTrading:
 * `<data>/file-history/<run>/` with the copies and an `index.jsonl`; runs older than 30 days
 * are deleted at startup. Only changes made by these tools are covered, not the shell's.
 */

export interface Change {
  /** 1 = first change of this run. */
  n: number
  path: string
  tool: string
  at: string
  /** The file did not exist: undo deletes it. */
  created: boolean
  /** Copy of the file before the change (absent when `created`). */
  backup?: string
  /** sha1 of what the tool wrote: undo asks before overwriting a file changed since. */
  after: string
  /** Already put back by /undo. */
  undone?: boolean
}

export const HISTORY_KEEP_DAYS = 30

export class FileHistory {
  private changes: Change[] = []
  /** Files this conversation created (auto mode treats them as the session's own). */
  private createdKeys = new Set<string>()
  readonly dir: string

  constructor(root: string, run = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${process.pid}`) {
    this.dir = path.join(root, run)
  }

  /**
   * Call before writing `abs` (whose current bytes are `before`, or undefined when it does not
   * exist), then `commit` with what was written. Copies the old bytes first, so a crash
   * between the two still leaves the copy.
   */
  async before(abs: string, before: Uint8Array | undefined): Promise<{ commit: (after: Uint8Array, tool: string) => Promise<Change> }> {
    const n = this.changes.length + 1
    let backup: string | undefined
    if (before) {
      await mkdir(this.dir, { recursive: true })
      backup = path.join(this.dir, `${String(n).padStart(4, "0")}-${path.basename(abs)}`)
      await writeFile(backup, before)
    }
    return {
      commit: async (after, tool) => {
        const change: Change = { n, path: abs, tool, at: new Date().toISOString(), created: !before, ...(backup ? { backup } : {}), after: hashBytes(after) }
        this.changes.push(change)
        if (!before) this.createdKeys.add(samePathKey(abs))
        await mkdir(this.dir, { recursive: true })
        await appendFile(path.join(this.dir, "index.jsonl"), `${JSON.stringify(change)}\n`)
        return change
      },
    }
  }

  /** Newest first. */
  list(): Change[] {
    return [...this.changes].reverse()
  }

  /**
   * A new conversation (/new, /clear, resume): files an earlier conversation created are no
   * longer "the session's own" for auto mode. /undo still has them.
   */
  newConversation() {
    this.createdKeys.clear()
  }

  /** The file was created by write_file during this conversation. */
  createdThisRun(abs: string) {
    return this.createdKeys.has(samePathKey(abs))
  }

  /**
   * Put change `n` back: restore the copy, or delete a file the tool created. Refuses (unless
   * `force`) when the file changed after the tool wrote it, so later edits are not lost.
   */
  async undo(n: number, force = false): Promise<{ ok: string } | { error: string }> {
    const change = this.changes.find((c) => c.n === n)
    if (!change) return { error: `Không có thay đổi số ${n}. Gõ /undo để xem danh sách.` }
    if (change.undone) return { error: `Thay đổi số ${n} đã được hoàn tác.` }
    let current: Uint8Array | undefined
    try {
      current = new Uint8Array(await Bun.file(change.path).arrayBuffer())
    } catch {
      current = undefined
    }
    if (!force && current && hashBytes(current) !== change.after) {
      return { error: `${change.path} đã thay đổi sau lần ${change.tool} này; hoàn tác sẽ mất các thay đổi đó. Gõ /undo ${n} --force nếu vẫn muốn.` }
    }
    if (change.created) {
      if (current) await unlink(change.path)
      change.undone = true
      return { ok: `Đã xoá ${change.path} (file do ${change.tool} tạo).` }
    }
    await mkdir(path.dirname(change.path), { recursive: true })
    await copyFile(change.backup!, change.path)
    change.undone = true
    return { ok: `Đã khôi phục ${change.path} về trước lần ${change.tool} lúc ${change.at.slice(11, 19)}.` }
  }
}

/** Delete entries (history folders, saved tool output) older than `days` (best effort, at startup). */
export async function pruneHistory(root: string, days = HISTORY_KEEP_DAYS, now = Date.now()) {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  for (const name of entries) {
    const dir = path.join(root, name)
    try {
      const info = await stat(dir)
      if (now - info.mtimeMs > days * 86_400_000) await rm(dir, { recursive: true, force: true })
    } catch {
      // another process may be using it
    }
  }
}
