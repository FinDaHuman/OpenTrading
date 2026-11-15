import type { ShellInfo } from "./run"

/**
 * A shell command that only lists a folder of the workspace, by an exact form (not a filter on
 * dangerous characters): such a command runs without a prompt in every permission mode, also ‖
 * read-only, `ot -p` and evals, like the arithmetic-only commands of math.ts.
 *
 * This is a different promise from `readOnlyCommand` (command.ts), which only spares a
 * classifier request for users who chose ▸▸ auto. Here nobody is asked at all, so the set is
 * small and every part is spelled out:
 * - `pwd` (and PowerShell's `Get-Location`, `gl`) with no argument;
 * - `ls` on a POSIX shell; `ls`, `dir`, `gci`, `Get-ChildItem` on PowerShell, with listed flags
 *   and plain paths.
 *
 * What keeps it a listing (each has a test in test/shell-listing.test.ts):
 * - One command: no `;`, `&`, `|`, redirect, line break, substitution.
 * - Nothing the shell expands: no `$`, backtick, `~`, `%VAR%`, glob (`* ? [ ]`), brace, and no
 *   single quotes (bash and PowerShell disagree on what stays literal inside the others).
 * - Every path, as the shell will resolve it, is inside the workspace or the session's temp
 *   folder, symlinks and junctions followed, and is not a key file or credential folder: the
 *   same answer `read_file` gives. A network path is refused: listing `\\host\share` signs in
 *   to that host.
 * - A colon only in a drive (`C:\…`): `dir env:` lists the environment and `dir HKLM:` the
 *   registry in PowerShell.
 * - Only flags from a list: an unknown one asks, so does recursion (`-R`, `-Recurse`).
 *
 * git, pip, npm and `--version` are not here on purpose: they run programs that files of the
 * folder can configure (`core.fsmonitor`, `gpg.program`, npm scripts).
 */

export interface ListingEnv {
  shell: Pick<ShellInfo, "kind">
  /** The absolute path the shell will use for what was typed (relative to the folder the command runs in). */
  resolve(raw: string): string
  /** A read of this path needs no approval: inside the workspace or scratch, not a secret, not a network or odd path. */
  readable(abs: string): boolean
  /** The OS the shell runs on (default this process's). */
  platform?: NodeJS.Platform
}

export const LISTING_MAX_CHARS = 1000
const MAX_PATHS = 8

/** Letters and digits of any script, and the few marks a plain path or a flag is made of. */
const WORD = /^[\p{L}\p{N}._\-\\/:=~]+$/u
/**
 * A tilde only inside a Windows 8.3 short name (`RUNNER~1`, the temp folder of many machines):
 * after a letter or digit and before a digit. Both shells expand it at the start of a word, and
 * bash also after `=` or `:`; neither does there.
 */
const HOME_TILDE = /(?<![\p{L}\p{N}])~|~(?!\d)/u
/** Inside double quotes a path may also hold spaces, commas and brackets (`Program Files (x86)`). */
const QUOTED = /^[\p{L}\p{N}._\-\\/: ,()+@~]+$/u

/** The words of the command, or undefined when anything is outside the two forms above. */
function words(text: string): { text: string; quoted: boolean }[] | undefined {
  const out: { text: string; quoted: boolean }[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === " " || c === "\t") {
      i++
      continue
    }
    if (c === '"') {
      const end = text.indexOf('"', i + 1)
      if (end < 0) return undefined
      const inner = text.slice(i + 1, end)
      // A quoted word ends at a space or the end: `"a"b` and `a"b"` are joined by the shell.
      if (inner === "" || !QUOTED.test(inner) || HOME_TILDE.test(inner) || (end + 1 < text.length && !/[ \t]/.test(text[end + 1]!))) return undefined
      out.push({ text: inner, quoted: true })
      i = end + 1
      continue
    }
    const end = text.slice(i).search(/[ \t]/)
    const word = end < 0 ? text.slice(i) : text.slice(i, i + end)
    if (!WORD.test(word) || HOME_TILDE.test(word)) return undefined
    out.push({ text: word, quoted: false })
    i += word.length
  }
  return out
}

/** A plain path the caller may list. */
function path(word: string, env: ListingEnv, ps: boolean): boolean {
  const windows = (env.platform ?? process.platform) === "win32"
  // bash reads a backslash as an escape (`a\b` is `ab`): a path that needs one is not plain.
  if (!ps && word.includes("\\")) return false
  // A network or device path (`\\host\share`, `//host/x`, `\\.\pipe\x`, `\\?\C:\`): refused on the
  // string alone. Resolving it (realpath, in `readable`) would already sign in to that host.
  if (/^[\\/]{2}/.test(word)) return false
  // Windows drops trailing dots and spaces from each part of a path (`src\.. \..` is `src\..\..`),
  // and the path check would not: a part may end in neither, except `.` and `..` themselves.
  if (word.split(/[\\/]/).some((part) => part !== "." && part !== ".." && /[. ]$/.test(part))) return false
  // A colon only as a drive letter before a separator, and only on Windows: never a PowerShell
  // provider (`env:`), an alternate data stream (`a.txt:s`) or a drive-relative path (`C:x`).
  if (word.includes(":") && !(windows && /^[A-Za-z]:[\\/][^:]*$/.test(word))) return false
  // `--` and anything else starting with a dash would be read as a flag.
  if (word.startsWith("-") || word.startsWith("=")) return false
  // PowerShell takes `\` and `/` as separators on every OS (pwsh on Linux reads `..\x` as `../x`),
  // and so does the path check, before it resolves the folder.
  return env.readable(env.resolve(ps ? word.replace(/\\/g, "/") : word))
}

/** `ls` flags that only change what is shown: long, all, human sizes, one a line, sort order, type marks, the folder itself. */
const LS_FLAGS = /^-[laAh1trSFd]+$/
/** `Get-ChildItem` switches that only filter or shorten the listing. */
const GCI_SWITCHES = new Set(["-force", "-name", "-file", "-directory", "-hidden"])
const GCI_PATH = new Set(["-path", "-literalpath"])
const GCI_NAMES = new Set(["ls", "dir", "gci", "get-childitem"])
const PWD_NAMES = new Set(["pwd", "gl", "get-location"])

export function listingCommand(command: string, env: ListingEnv): boolean {
  const text = command.trim()
  if (text === "" || text.length > LISTING_MAX_CHARS) return false
  const all = words(text)
  if (!all || all.length === 0 || all[0]!.quoted) return false
  const ps = env.shell.kind === "pwsh" || env.shell.kind === "powershell"
  // bash or sh on Windows (Git Bash, MSYS) maps `/d/x` to `D:\x` and `/tmp` into its own install,
  // where the path check (Node) reads `D:\d\x`: the two would look at different folders. Defensive:
  // OpenTrading starts PowerShell on Windows.
  if (!ps && (env.platform ?? process.platform) === "win32") return false
  // The command's name as typed: `./ls`, `C:\x\ls.exe` or `LS` on a POSIX shell is another program.
  const name = ps ? all[0]!.text.toLowerCase() : all[0]!.text
  const args = all.slice(1)
  if (name === "pwd" || (ps && PWD_NAMES.has(name))) return args.length === 0
  let paths = 0
  if (ps) {
    // Get-ChildItem binds a second positional word to -Filter, and a repeated -Path is an error:
    // one folder per command.
    if (!GCI_NAMES.has(name)) return false
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      const flag = arg.quoted ? "" : arg.text.toLowerCase()
      if (GCI_SWITCHES.has(flag)) continue
      if (GCI_PATH.has(flag)) {
        const value = args[++i]
        if (!value || !path(value.text, env, true) || ++paths > 1) return false
        continue
      }
      // PowerShell reads any other word starting with a dash as a parameter, also in quotes.
      if (arg.text.startsWith("-") || !path(arg.text, env, true) || ++paths > 1) return false
    }
    return true
  }
  if (name !== "ls") return false
  for (const arg of args) {
    if (!arg.quoted && LS_FLAGS.test(arg.text)) continue
    if (!path(arg.text, env, false) || ++paths > MAX_PATHS) return false
  }
  return true
}
