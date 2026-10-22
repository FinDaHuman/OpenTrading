import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * `bun run install:global` — put `opentrading` and `ot` on PATH so the TUI opens in whatever
 * folder they are typed in. Like Claude Code and Codex, the launchers go to ~/.local/bin and
 * PATH is never edited, only explained. They run this checkout's source (update = git pull),
 * with flags that keep the folder's own bunfig.toml (preload = code) and .env out of Bun.
 */

export const SHIM_MARK = "opentrading-shim"
export const SHIM_NAMES = ["opentrading", "ot"]

export interface ShimFile {
  file: string
  content: string
}

export interface InstallOptions {
  /** The checkout the shims run (holds src/index.tsx). */
  root: string
  /** Where the shims go. */
  dir: string
  platform?: NodeJS.Platform
}

/** A POSIX single-quoted word. */
const shQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

export function shimFiles(opts: InstallOptions): ShimFile[] {
  const platform = opts.platform ?? process.platform
  const files: ShimFile[] = []
  for (const name of SHIM_NAMES) {
    if (platform === "win32") {
      // `%` starts a variable in a .cmd file, even inside quotes.
      const root = path.win32.resolve(opts.root).replaceAll("%", "%%")
      files.push({
        file: path.join(opts.dir, `${name}.cmd`),
        content: [
          "@echo off",
          `rem ${SHIM_MARK}: written by "bun run install:global" in ${root}; run it again to update.`,
          `bun --config="${root}\\src\\cli\\launcher.bunfig.toml" --no-env-file --no-install "${root}\\src\\index.tsx" %*`,
          "",
        ].join("\r\n"),
      })
    }
    // Also on Windows: Git Bash looks for the bare name, never for .cmd.
    const root = opts.root.replaceAll("\\", "/")
    files.push({
      file: path.join(opts.dir, name),
      content: [
        "#!/bin/sh",
        `# ${SHIM_MARK}: written by "bun run install:global" in ${root}; run it again to update.`,
        `exec bun --config=${shQuote(`${root}/src/cli/launcher.bunfig.toml`)} --no-env-file --no-install ${shQuote(`${root}/src/index.tsx`)} "$@"`,
        "",
      ].join("\n"),
    })
  }
  return files
}

async function ours(file: string) {
  const text = await readFile(file, "utf8").catch(() => undefined)
  if (text === undefined) return "missing" as const
  return text.includes(SHIM_MARK) ? ("ours" as const) : ("foreign" as const)
}

export interface InstallResult {
  written: string[]
  /** Files of the same name that some other program owns: never overwritten. */
  skipped: string[]
}

export async function installShims(opts: InstallOptions): Promise<InstallResult> {
  await mkdir(opts.dir, { recursive: true })
  const result: InstallResult = { written: [], skipped: [] }
  for (const shim of shimFiles(opts)) {
    if ((await ours(shim.file)) === "foreign") {
      result.skipped.push(shim.file)
      continue
    }
    await writeFile(shim.file, shim.content, "utf8")
    if (!shim.file.endsWith(".cmd")) await chmod(shim.file, 0o755)
    result.written.push(shim.file)
  }
  return result
}

/** Removes only files this script wrote; returns them. */
export async function uninstallShims(opts: InstallOptions): Promise<string[]> {
  const removed: string[] = []
  for (const shim of shimFiles(opts)) {
    if ((await ours(shim.file)) !== "ours") continue
    await rm(shim.file, { force: true })
    removed.push(shim.file)
  }
  return removed
}

export function onPath(dir: string, pathEnv = process.env.PATH ?? process.env.Path ?? "", platform = process.platform) {
  const norm = (p: string) => {
    const resolved = (platform === "win32" ? path.win32 : path.posix).resolve(p).replace(/[\\/]+$/, "")
    return platform === "win32" ? resolved.toLowerCase() : resolved
  }
  const target = norm(dir)
  return pathEnv
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .some((p) => norm(p) === target)
}

/** How to put `dir` on PATH, for the user to run (we never edit their profile). */
export function pathHint(dir: string, platform = process.platform, shell = process.env.SHELL ?? "") {
  if (platform === "win32") {
    return [
      `${dir} chưa có trong PATH. Chạy trong PowerShell rồi mở terminal mới:`,
      `  [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";${dir}", "User")`,
    ].join("\n")
  }
  if (shell.endsWith("fish")) return `${dir} chưa có trong PATH. Chạy: fish_add_path ${shQuote(dir)}`
  const rc = shell.endsWith("zsh") ? "~/.zshrc" : "~/.bashrc"
  return [`${dir} chưa có trong PATH. Chạy rồi mở terminal mới:`, `  echo 'export PATH="${dir}:$PATH"' >> ${rc}`].join("\n")
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf("--dir")
  const dir = path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1]! : path.join(os.homedir(), ".local", "bin"))
  const opts = { root: path.resolve(import.meta.dir, "../.."), dir }

  if (argv.includes("--uninstall")) {
    const removed = await uninstallShims(opts)
    console.log(removed.length > 0 ? `Đã gỡ: ${removed.join(", ")}` : `Không có lệnh nào của OpenTrading trong ${dir}.`)
    process.exit(0)
  }

  const { written, skipped } = await installShims(opts)
  for (const file of written) console.log(`Đã ghi ${file}`)
  for (const file of skipped) console.log(`Bỏ qua ${file}: file này không phải của OpenTrading, không ghi đè.`)
  if (!Bun.which("bun")) console.log("Không thấy bun trong PATH: lệnh sẽ không chạy được cho tới khi thêm bun vào PATH.")
  if (!onPath(dir)) console.log(pathHint(dir))
  else console.log("Xong. Mở terminal ở thư mục bất kỳ và gõ: opentrading (hoặc ot)")
  process.exit(skipped.length > 0 && written.length === 0 ? 1 : 0)
}
