/**
 * Optional OS sandbox for the shell tool (issue #352; config `shell.sandbox`, flag `--sandbox`).
 * Off by default. With it on, every command the shell tool runs (arithmetic and listings
 * included, in subagents and desk runs too) runs with no network and may write only in the
 * workspace folders and the temp folder; OpenTrading's own data folder stays read-only even when
 * it sits inside one of those. Permission prompts are unchanged: the sandbox is a second wall,
 * not a reason to ask less.
 *
 * - Linux: bubblewrap (`bwrap`): the whole filesystem read-only, the writable folders bound back
 *   read-write, new network and PID namespaces.
 * - macOS: `sandbox-exec` with a Seatbelt profile; the folders are `-D` parameters, never pasted
 *   into the profile text.
 * - Windows: no isolation. The user is warned; commands run as without the sandbox.
 *
 * Fails closed: on Linux and macOS, a sandbox that is on but cannot run (bwrap missing, no user
 * namespaces in a container) stops every shell command with an error; nothing runs unsandboxed.
 * Reads are not restricted, and the file tools, MCP and web tools are not sandboxed (docs/permissions.md).
 */

import { existsSync, realpathSync } from "node:fs"
import path from "node:path"

export type SandboxStatus =
  | { kind: "ready"; tool: "bwrap" | "sandbox-exec"; path: string }
  /** The tool is not installed. */
  | { kind: "missing"; tool: "bwrap" | "sandbox-exec" }
  /** Installed but a trial run failed (no unprivileged user namespaces, AppArmor): `detail` is its stderr. */
  | { kind: "broken"; tool: "bwrap" | "sandbox-exec"; path: string; detail: string }
  /** Windows, or another platform with no sandbox here: commands run unisolated. */
  | { kind: "unsupported"; platform: NodeJS.Platform }

/** Folders the command may write to, and folders inside them that stay read-only. */
export interface SandboxPlan {
  writable: string[]
  readOnly: string[]
}

const SEATBELT = "/usr/bin/sandbox-exec"

let probed: SandboxStatus | undefined

/** What `bwrap` needs to work here: a trial run with the same namespaces a command gets. */
function probeBwrap(): SandboxStatus {
  const bwrap = Bun.which("bwrap")
  if (!bwrap) return { kind: "missing", tool: "bwrap" }
  try {
    const run = Bun.spawnSync([bwrap, ...BWRAP_BASE, "--", "/bin/sh", "-c", "true"], { stdout: "ignore", stderr: "pipe", stdin: "ignore", timeout: 10_000 })
    if (run.exitCode === 0) return { kind: "ready", tool: "bwrap", path: bwrap }
    return { kind: "broken", tool: "bwrap", path: bwrap, detail: run.stderr.toString().trim().split("\n")[0] || `exit ${run.exitCode}` }
  } catch (error) {
    return { kind: "broken", tool: "bwrap", path: bwrap, detail: error instanceof Error ? error.message : String(error) }
  }
}

function probeSeatbelt(): SandboxStatus {
  if (!existsSync(SEATBELT)) return { kind: "missing", tool: "sandbox-exec" }
  try {
    const run = Bun.spawnSync([SEATBELT, "-p", "(version 1)(allow default)", "/bin/sh", "-c", "true"], { stdout: "ignore", stderr: "pipe", stdin: "ignore", timeout: 10_000 })
    if (run.exitCode === 0) return { kind: "ready", tool: "sandbox-exec", path: SEATBELT }
    return { kind: "broken", tool: "sandbox-exec", path: SEATBELT, detail: run.stderr.toString().trim().split("\n")[0] || `exit ${run.exitCode}` }
  } catch (error) {
    return { kind: "broken", tool: "sandbox-exec", path: SEATBELT, detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Whether the sandbox can run on this machine; checked once per process (a trial run, not just PATH). */
export function probeSandbox(): SandboxStatus {
  if (probed) return probed
  const platform = process.platform
  probed = platform === "linux" ? probeBwrap() : platform === "darwin" ? probeSeatbelt() : { kind: "unsupported", platform }
  return probed
}

/**
 * Namespaces and mounts every sandboxed command gets (the probe uses the same). `/run` is an
 * empty tmpfs: a new network namespace does not stop `connect()` on a socket file, and `/run`
 * holds the ones that reach outside (the Docker socket, the D-Bus and systemd user buses, whose
 * `systemd-run --user` starts a process with no sandbox). `/var/run` is a symlink to it.
 */
const BWRAP_BASE = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/run", "--unshare-net", "--unshare-pid", "--unshare-ipc", "--die-with-parent"]

/** `/var/run` when it is a folder of its own instead of the usual symlink to `/run`. */
function separateVarRun(): string[] {
  try {
    return realpathSync("/var/run") === "/run" ? [] : ["--tmpfs", "/var/run"]
  } catch {
    return []
  }
}

/** Existing folders, symlinks resolved, without repeats (bwrap refuses a source that does not exist). */
function realDirs(dirs: string[]): string[] {
  const out: string[] = []
  for (const dir of dirs) {
    try {
      const real = realpathSync(dir)
      if (!out.includes(real)) out.push(real)
    } catch {
      // not there: nothing to bind
    }
  }
  return out
}

const inside = (dir: string, root: string) => dir !== root && dir.startsWith(root.endsWith(path.sep) ? root : root + path.sep)

/**
 * The folders in the order they are applied: writable, then read-only over them, then the
 * writable ones that sit inside a read-only one opened again (a workspace inside the data
 * folder, `<data>/workspace`, stays writable while the config next to it does not).
 */
export function sandboxLayers(plan: SandboxPlan): { writable: string[]; readOnly: string[]; reopened: string[] } {
  const writable = realDirs(plan.writable)
  const readOnly = realDirs(plan.readOnly)
  const reopened = writable.filter((dir) => readOnly.some((root) => inside(dir, root)))
  return { writable, readOnly, reopened }
}

/**
 * The argv that runs `argv` under bubblewrap: the filesystem read-only, the writable folders
 * bound back read-write, the read-only ones over them (later binds win), no network.
 */
export function bwrapArgv(bwrap: string, plan: SandboxPlan, argv: string[], cwd: string): string[] {
  const { writable, readOnly, reopened } = sandboxLayers(plan)
  const out = [bwrap, ...BWRAP_BASE, ...separateVarRun()]
  for (const dir of writable) out.push("--bind", dir, dir)
  // The X server's sockets in a writable temp folder: a window client can type into other windows.
  for (const dir of writable) if (existsSync(path.join(dir, ".X11-unix"))) out.push("--tmpfs", path.join(dir, ".X11-unix"))
  for (const dir of readOnly) out.push("--ro-bind", dir, dir)
  for (const dir of reopened) out.push("--bind", dir, dir)
  out.push("--chdir", cwd, "--")
  return [...out, ...argv]
}

const subpaths = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `(subpath (param "${prefix}${i}"))`).join(" ")

/**
 * The Seatbelt profile: everything allowed except the network and writes; writes allowed back
 * in the writable folders and the few device files programs write to, denied again in the
 * read-only ones, allowed again in the reopened ones (the last matching rule wins). Paths come
 * in as `-D` parameters, never as profile text.
 */
export function seatbeltProfile(writable: number, readOnly: number, reopened: number): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* ${subpaths("W", writable)} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`,
    ...(readOnly > 0 ? [`(deny file-write* ${subpaths("R", readOnly)})`] : []),
    ...(reopened > 0 ? [`(allow file-write* ${subpaths("O", reopened)})`] : []),
  ].join("\n")
}

export function seatbeltArgv(path: string, plan: SandboxPlan, argv: string[]): string[] {
  const { writable, readOnly, reopened } = sandboxLayers(plan)
  const param = (prefix: string, dirs: string[]) => dirs.flatMap((dir, i) => ["-D", `${prefix}${i}=${dir}`])
  return [path, "-p", seatbeltProfile(writable.length, readOnly.length, reopened.length), ...param("W", writable), ...param("R", readOnly), ...param("O", reopened), ...argv]
}

/**
 * The argv to spawn for a sandboxed command, or the English error the model reads when the
 * sandbox is on but cannot run (the command does not run). Unsupported platforms get `argv`
 * back unchanged: the user was warned at startup.
 */
export function sandboxedArgv(status: SandboxStatus, plan: SandboxPlan, argv: string[], cwd: string): string[] | { error: string } {
  if (status.kind === "unsupported") return argv
  if (status.kind === "ready") return status.tool === "bwrap" ? bwrapArgv(status.path, plan, argv, cwd) : seatbeltArgv(status.path, plan, argv)
  const why = status.kind === "missing" ? `${status.tool} is not installed` : `${status.tool} cannot run here (${status.detail})`
  return { error: `The command did not run: the shell sandbox is on but ${why}. No shell command can run until the user fixes the sandbox or turns it off; tell the user, do not retry.` }
}

/** The sentence the shell description gets while sandboxed (model-read, English). Undefined when nothing isolates. */
export function sandboxDescription(enabled: boolean, status: SandboxStatus): string | undefined {
  if (!enabled || status.kind === "unsupported") return undefined
  return "Commands run in a sandbox: no network, and files can be written only in the workspace and the temp folder, so downloads and package installs fail. "
}

/**
 * What the user is told when the session starts (Vietnamese), or undefined when there is
 * nothing to say. `level` "warning": commands run unisolated or not at all. `status` is only
 * needed (and only probed, a trial run) when the sandbox is on.
 */
export function sandboxNotice(
  enabled: boolean,
  status: SandboxStatus | undefined,
  opts: { bypass?: boolean; platform?: NodeJS.Platform } = {},
): { level: "info" | "warning"; text: string } | undefined {
  if (!enabled || !status) {
    // Recommended for ▸▸▸: nothing asks before a command runs. Pointless where nothing isolates.
    const platform = opts.platform ?? process.platform
    if (opts.bypass && (platform === "linux" || platform === "darwin")) return { level: "info", text: "Khuyến nghị: chạy kèm --sandbox (hoặc shell.sandbox: true trong config) để lệnh shell không có mạng và chỉ ghi được trong workspace + thư mục tạm." }
    return undefined
  }
  if (status.kind === "unsupported") {
    return { level: "warning", text: "Sandbox shell đang bật nhưng Windows chưa có cách ly: lệnh shell vẫn chạy thẳng trên máy, có mạng và ghi được mọi nơi bạn ghi được." }
  }
  if (status.kind === "ready") return { level: "info", text: "Sandbox shell bật: lệnh shell không có mạng, chỉ ghi được trong workspace và thư mục tạm." }
  const fix = status.tool === "bwrap" ? "Cài bubblewrap (vd. sudo apt install bubblewrap)" : "Cần /usr/bin/sandbox-exec của macOS"
  const why = status.kind === "missing" ? `không tìm thấy ${status.tool}. ${fix}` : `${status.tool} không chạy được ở đây (${status.detail}); máy hoặc container có thể chặn user namespace`
  return { level: "warning", text: `Sandbox shell đang bật nhưng ${why}. Mọi lệnh shell (kể cả phép tính) sẽ bị từ chối cho tới khi sửa hoặc tắt shell.sandbox.` }
}
