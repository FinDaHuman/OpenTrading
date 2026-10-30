import { createHash } from "node:crypto"
import { lstatSync } from "node:fs"
import { lstat, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isInside } from "./path-safety"
import { realish } from "./workspace"

/**
 * The session's scratchpad: a folder in the system temp dir where the agent keeps scripts,
 * intermediate results and exports that do not belong in the user's project, and writes
 * without asking (except in ‖ read-only). Claude Code's layout:
 * `<tmp>/opentrading/<cwd>/<session id>/scratchpad`.
 *
 * The folder that skips approval is the project folder (`<tmp>/opentrading/<cwd>`), fixed for
 * the process, while the session id changes on /new, /clear and resume: a background subagent
 * started before /new keeps writing where it was told to.
 */

/** Longest cwd part of the path: Windows still trips over 260-character paths (Python). */
const CWD_MAX = 60

/** The cwd as one folder name, as Claude Code names it, but shorter and with a hash when cut. */
export function scratchFolderName(cwd: string): string {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, "-")
  if (name.length <= CWD_MAX) return name
  return `${name.slice(0, CWD_MAX)}-${createHash("sha256").update(cwd).digest("hex").slice(0, 8)}`
}

/** `<tmp>/opentrading` (Windows: the temp dir is already per user) or `<tmp>/opentrading-<uid>`. */
export function scratchBase(tmp = process.env.OPENTRADING_TMPDIR || os.tmpdir(), platform: NodeJS.Platform = process.platform): string {
  const uid = platform === "win32" ? undefined : process.getuid?.()
  return path.join(tmp, uid === undefined ? "opentrading" : `opentrading-${uid}`)
}

export interface ScratchOptions {
  /** Temp dir to build under (tests); default OPENTRADING_TMPDIR or os.tmpdir(). */
  tmp?: string
  platform?: NodeJS.Platform
}

export class Scratchpad {
  /** `<tmp>/opentrading/<cwd>`, symlinks and 8.3 short names resolved once. */
  readonly project: string
  /** Off in /config: no folder, no prompt line, no approval shortcut. */
  enabled = true
  private session?: string
  /** As built, before resolving: the ownership check looks at this one, not at a link's target. */
  private readonly rawBase: string
  /** `<tmp>/opentrading`, resolved: the folder old sessions are pruned from. */
  readonly base: string
  private readonly platform: NodeJS.Platform
  /** The base folder failed the ownership check (POSIX shared /tmp): stay off for the process. */
  private unsafe = false

  constructor(cwd: string, opts: ScratchOptions = {}) {
    this.platform = opts.platform ?? process.platform
    this.rawBase = scratchBase(opts.tmp, this.platform)
    try {
      this.unsafe = !this.owned(lstatSync(this.rawBase))
    } catch {
      // not there yet: ensure() makes it
    }
    this.base = realish(this.rawBase)
    this.project = path.join(this.base, scratchFolderName(path.resolve(cwd)))
  }

  /** POSIX: a real folder of ours (a shared /tmp lets anyone plant a link there first). */
  private owned(info: { isSymbolicLink(): boolean; isDirectory(): boolean; uid: number }) {
    if (this.platform === "win32") return true
    return !info.isSymbolicLink() && info.isDirectory() && (!process.getuid || info.uid === process.getuid())
  }

  /** The conversation now writing (startup, /new, /clear, resume). */
  attach(sessionId: string) {
    this.session = sessionId
  }

  get active() {
    return this.usable && this.session !== undefined
  }

  /** On, and the base folder passed the ownership check. */
  get usable() {
    return this.enabled && !this.unsafe
  }

  /** This session's folder, or undefined when off. */
  dir(): string | undefined {
    return this.active ? path.join(this.project, this.session!, "scratchpad") : undefined
  }

  /** `abs` is in the project's scratch folders (the caller checks the resolved path as well). */
  contains(abs: string): boolean {
    return this.enabled && !this.unsafe && isInside(abs, this.project, this.platform) && isInside(realish(abs), this.project, this.platform)
  }

  /**
   * Create the session's folder (each turn: cheap, and puts it back after the OS cleaned the
   * temp dir). On POSIX the base must be a real folder owned by us, or the scratchpad stays off.
   */
  async ensure(): Promise<string | undefined> {
    const dir = this.dir()
    if (!dir) return undefined
    try {
      await mkdir(this.rawBase, { recursive: true, mode: 0o700 })
      if (!this.owned(await lstat(this.rawBase))) {
        this.unsafe = true
        return undefined
      }
      await mkdir(dir, { recursive: true, mode: 0o700 })
      return dir
    } catch {
      return undefined
    }
  }
}
