import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { dataDir } from "../paths"
import { isInside, pathFor, resolveUserPath, samePathKey, type SafetyEnv } from "./path-safety"
import type { Scratchpad } from "./scratch"

/**
 * Where the agent works: the folder OpenTrading was opened in, plus folders the user adds
 * with /add-dir. Relative paths resolve against the first root, and (from the edit tools on)
 * writes outside these roots always ask.
 *
 * Opened from the home folder, a drive root or a system folder, "the workspace" would be
 * the whole disk, so a dedicated `<data>/workspace` folder takes its place (Claude Code and
 * Codex trust the working directory because it is a repo; an investor's cwd often is not).
 */

export interface WorkspaceEnv {
  home?: string
  data?: string
  platform?: NodeJS.Platform
}

/** Real path of `p`, or of its nearest existing ancestor plus the missing tail (symlinks resolved). */
export function realish(p: string): string {
  const abs = path.resolve(p)
  let current = abs
  const tail: string[] = []
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...tail)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return abs
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

/** Top-level Windows folders that belong to the system (any drive). */
const WINDOWS_SYSTEM = new Set(["windows", "program files", "program files (x86)", "programdata", "users", "perflogs", "$recycle.bin", "system volume information", "recovery", "boot"])

/** Why `dir` is too broad to be a workspace, or undefined. */
export function unsafeRoot(dir: string, e: WorkspaceEnv = {}): string | undefined {
  const home = e.home ?? os.homedir()
  const data = e.data ?? dataDir()
  const platform = e.platform ?? process.platform
  const flavor = pathFor(platform)
  const abs = flavor.resolve(dir)
  const key = samePathKey(abs, platform)
  if (key === samePathKey(home, platform)) return "thư mục home"
  const root = flavor.parse(abs).root
  if (key === samePathKey(root, platform)) return "gốc ổ đĩa"
  const topLevel = samePathKey(flavor.dirname(abs), platform) === samePathKey(root, platform)
  // Windows: D:\Dau-tu is an ordinary folder; only the system ones are off limits.
  // POSIX: every direct child of / is a system folder (/usr, /etc, /home, /tmp…).
  if (topLevel && (platform !== "win32" || WINDOWS_SYSTEM.has(flavor.basename(abs).toLowerCase()))) return "thư mục hệ thống cấp 1"
  if (isInside(abs, data, platform)) return "thư mục dữ liệu của OpenTrading"
  return undefined
}

export class Workspace {
  /** Relative paths resolve here; artifacts go here by default. */
  readonly primary: string
  /** Why cwd was replaced by `<data>/workspace`, or undefined when cwd is the workspace. */
  readonly fallbackReason?: string
  /** The session's temp folder (scratch.ts), set by the runtime; undefined in tests and evals. */
  scratch?: Scratchpad
  private extra: string[] = []
  private readonly platform: NodeJS.Platform
  private readonly home: string
  private readonly data: string

  constructor(cwd: string, opts: WorkspaceEnv & { dirs?: string[] } = {}) {
    this.platform = opts.platform ?? process.platform
    this.home = opts.home ?? os.homedir()
    this.data = opts.data ?? dataDir()
    const reason = unsafeRoot(cwd, { home: this.home, data: this.data, platform: this.platform })
    if (reason) {
      this.fallbackReason = reason
      this.primary = path.join(this.data, "workspace")
      try {
        mkdirSync(this.primary, { recursive: true })
      } catch {
        // created on first write instead
      }
    } else this.primary = path.resolve(cwd)
    for (const dir of opts.dirs ?? []) {
      const added = this.validate(dir)
      if (typeof added === "string" && !this.extra.some((d) => samePathKey(d, this.platform) === samePathKey(added, this.platform))) this.extra.push(added)
    }
  }

  /** Home, data dir and platform for the secret-path checks (tests point them at temp dirs). */
  env(): SafetyEnv {
    return { home: this.home, data: this.data, platform: this.platform }
  }

  roots(): string[] {
    return [this.primary, ...this.extra]
  }

  /** Absolute path for what the model or user typed (quotes, `~`, relative to the primary root). */
  resolve(raw: string): string {
    return resolveUserPath(raw, this.primary, this.home)
  }

  /** Inside one of the roots, symlinks resolved on both sides. */
  contains(abs: string): boolean {
    const real = realish(abs)
    return this.roots().some((root) => isInside(real, realish(root), this.platform))
  }

  /** In the scratchpad's project folder, symlinks resolved on both sides (writes there skip approval). */
  inScratch(abs: string): boolean {
    return this.scratch?.contains(abs) ?? false
  }

  /** The directory to add, or an error message. */
  validate(raw: string): string | { error: string } {
    const dir = resolveUserPath(raw, this.primary, this.home)
    if (!existsSync(dir)) return { error: `Không có thư mục ${dir}.` }
    try {
      if (!statSync(dir).isDirectory()) return { error: `${dir} không phải thư mục.` }
    } catch (error) {
      return { error: `Không đọc được ${dir}: ${error instanceof Error ? error.message : String(error)}` }
    }
    const reason = unsafeRoot(dir, { home: this.home, data: this.data, platform: this.platform })
    if (reason) return { error: `Không thêm ${dir} (${reason}): quá rộng để agent ghi file. Chọn một thư mục con.` }
    return dir
  }

  /** Add a root for this session. Returns the directory or an error message. */
  add(raw: string): { dir: string } | { error: string } {
    const dir = this.validate(raw)
    if (typeof dir !== "string") return dir
    if (this.roots().some((r) => isInside(dir, r, this.platform))) return { error: `${dir} đã nằm trong workspace.` }
    this.extra.push(dir)
    return { dir }
  }

  /** The `<quyen_tep>` reminder: where relative paths go and which folders are the workspace. */
  describe(): string {
    const lines = [
      `Thư mục làm việc (workspace): ${this.primary}${this.fallbackReason ? ` (người dùng mở OpenTrading ở ${this.fallbackReason} nên dùng thư mục riêng này)` : ""}.`,
      ...(this.extra.length > 0 ? [`Thư mục thêm: ${this.extra.join("; ")}.`] : []),
      "Đường dẫn tương đối tính từ workspace. File/thư mục người dùng đưa (kể cả ngoài workspace) đọc bằng read_file; tìm file bằng glob_files, tìm chữ trong file bằng grep_files.",
    ]
    const scratch = this.scratch?.dir()
    if (scratch) {
      lines.push(
        `Thư mục tạm của phiên: ${scratch}. Dùng cho file tạm (script, kết quả trung gian, file xuất không thuộc dự án của người dùng) thay cho %TEMP% hay /tmp (file người dùng muốn giữ thì vẫn đặt trong workspace); ghi file vào đây không cần hỏi (trừ chế độ chỉ-đọc), lệnh shell vẫn duyệt như thường. Chỉ dùng thư mục tạm khác khi người dùng yêu cầu.`,
      )
    }
    return lines.join("\n")
  }
}
