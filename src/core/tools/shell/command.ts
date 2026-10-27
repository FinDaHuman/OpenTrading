import { namesProtected } from "../../fs/path-safety"

/**
 * What the permission gate needs to know about a shell command before it runs, by string
 * analysis only (best effort — no shell parser; the plan relies on the user, and later the
 * classifier, for anything this does not catch):
 * - whether it is one simple command (no chaining, pipes, redirection, substitution), so a
 *   rule "always allow `git status …`" can never match `git status; Remove-Item …`;
 * - its prefix for such rules (opencode permission/arity.ts);
 * - whether it starts an interpreter (`python x.py`, `node -e`) — never offered "always";
 * - a recursive delete aimed at a drive root, home, a system folder or the workspace root
 *   (Claude Code "critical paths"; codex is_dangerous_command.rs) — never runs;
 * - whether it names a key file or OpenTrading's own config (asked every time).
 */

/** Characters that chain, pipe, redirect or substitute: such a command is not "simple". */
const COMPOUND = /[;&|<>`\n\r]|\$\(|@\(|\$\{/

export function isSimpleCommand(command: string) {
  return command.trim() !== "" && !COMPOUND.test(command)
}

/** Words of a simple command, quotes removed (good enough for prefixes and targets). */
export function words(command: string): string[] {
  const out: string[] = []
  for (const m of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]!)
  return out
}

/** How many words make a command's identity (git status, npm run build). Default 1. */
const ARITY: Record<string, number> = {
  git: 2,
  npm: 2,
  "npm run": 3,
  pnpm: 2,
  "pnpm run": 3,
  yarn: 2,
  "yarn run": 3,
  bun: 2,
  "bun run": 3,
  pip: 2,
  pip3: 2,
  uv: 2,
  "uv pip": 3,
  conda: 2,
  docker: 2,
  "docker compose": 3,
  gh: 3,
  kubectl: 2,
  cargo: 2,
  go: 2,
  dotnet: 2,
  winget: 2,
  choco: 2,
}

/** Programs that run arbitrary code from their arguments: no "always" rule for them. */
const INTERPRETERS = new Set([
  "python", "python3", "python2", "py", "node", "deno", "bun", "bunx", "npx", "tsx", "ts-node", "ruby", "perl", "php", "lua", "rscript",
  "bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd", "wsl", "env", "sudo", "su", "runas", "xargs", "eval", "exec", "ssh",
  "iex", "invoke-expression", "invoke-command", "icm", "start-process", "saps", "start", "start-job", "add-type", "new-object",
  "uv", "uvx", "pipx", "conda",
])

const bare = (w: string) => w.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "").replace(/^.*[\\/]/, "")

/**
 * Commands that change or delete files, processes, settings or remote state: approving one
 * covers only that exact command, never its prefix (`Remove-Item x` must not approve
 * `Remove-Item -Recurse D:\BCTC`; `Set-Content` writes with no backup or protected check).
 */
const MUTATING = new Set([
  "rm", "rmdir", "rd", "del", "erase", "remove-item", "ri", "mv", "move", "move-item", "mi", "cp", "copy", "copy-item", "cpi", "xcopy", "robocopy",
  "ren", "rename", "rename-item", "rni", "set-content", "sc", "add-content", "ac", "out-file", "clear-content", "clc", "new-item", "ni", "tee", "tee-object",
  "truncate", "dd", "sed", "chmod", "chown", "icacls", "takeown", "attrib", "set-acl", "set-itemproperty", "sp", "new-itemproperty", "remove-itemproperty",
  "reg", "setx", "stop-process", "kill", "taskkill", "pkill", "killall", "shutdown", "restart-computer", "stop-computer", "format", "format-volume", "diskpart",
  "set-executionpolicy", "curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm", "scp", "rsync", "ftp", "mklink", "new-psdrive",
])

/** Second words that make a git / package-manager command change something. */
const MUTATING_SUB: Record<string, Set<string>> = {
  git: new Set(["push", "reset", "clean", "checkout", "switch", "restore", "rebase", "merge", "commit", "rm", "mv", "am", "apply", "cherry-pick", "revert", "stash", "tag", "branch", "remote", "config", "submodule", "gc", "prune", "filter-branch", "update-ref", "pull", "fetch", "clone", "init", "worktree"]),
  npm: new Set(["install", "i", "add", "uninstall", "remove", "rm", "update", "publish", "ci", "link", "exec", "run", "init"]),
  pnpm: new Set(["install", "i", "add", "remove", "update", "publish", "exec", "run", "dlx"]),
  yarn: new Set(["install", "add", "remove", "upgrade", "publish", "run", "dlx"]),
  pip: new Set(["install", "uninstall", "download"]),
  pip3: new Set(["install", "uninstall", "download"]),
  winget: new Set(["install", "uninstall", "upgrade", "import"]),
  choco: new Set(["install", "uninstall", "upgrade"]),
  docker: new Set(["run", "rm", "rmi", "stop", "kill", "exec", "build", "push", "pull", "compose", "system", "volume", "network"]),
  gh: new Set(["pr", "issue", "release", "repo", "api", "gist", "workflow", "secret", "auth"]),
  kubectl: new Set(["apply", "delete", "create", "edit", "patch", "scale", "exec", "drain", "replace", "rollout"]),
}

/**
 * `git status` for `git status -s`: the prefix a session / "always" approval may cover.
 * Undefined (exact command only) when the command is not simple, changes something, or puts
 * an option inside the prefix (`git -c core.hooksPath=x status` runs code through config).
 */
export function commandPrefix(command: string): string | undefined {
  if (!isSimpleCommand(command)) return undefined
  const w = words(command)
  if (w.length === 0) return undefined
  const first = bare(w[0]!)
  if (MUTATING.has(first) || MUTATING_SUB[first]?.has((w[1] ?? "").toLowerCase())) return undefined
  const two = w[1] ? `${first} ${w[1].toLowerCase()}` : first
  const n = ARITY[two] ?? ARITY[first] ?? 1
  const rest = w.slice(1, n).map((x) => x.toLowerCase())
  if (rest.some((x) => x.startsWith("-") || x.startsWith("/"))) return undefined
  return [first, ...rest].join(" ")
}

/** Programs that only list or print state, whatever their arguments (checked below for exceptions). */
const LISTERS = new Set(["ls", "dir", "gci", "get-childitem", "pwd", "get-location", "where", "which", "get-command", "gcm", "whoami", "hostname", "get-process", "gps", "ps", "tasklist"])
/** Second words that make these programs only read. */
const READ_SUB: Record<string, Set<string>> = {
  git: new Set(["status", "log", "diff", "show", "blame", "rev-parse", "ls-files", "shortlog", "describe"]),
  pip: new Set(["list", "show", "freeze"]),
  pip3: new Set(["list", "show", "freeze"]),
  conda: new Set(["list", "info"]),
  npm: new Set(["ls", "list"]),
}
/** Programs whose `--version` is a plain read. */
const VERSIONED = new Set(["python", "python3", "py", "node", "bun", "deno", "npm", "pnpm", "yarn", "pip", "pip3", "uv", "conda", "git", "dotnet", "java", "go", "cargo", "rustc", "gh"])
/**
 * Arguments that turn a read into something else: git writing a file or running a configured
 * program (`--output`, `--ext-diff`, `--textconv`), a PowerShell provider drive other than a
 * disk (`env:` prints API keys, `HKLM:` the registry).
 */
const NOT_READ = /^(--output|--ext-diff|--textconv|-o$)|^[a-z]{2,}:/i

/**
 * One simple command that only lists or prints state (git status, dir, pip list, python
 * --version): ▸▸ auto mode runs it without asking the classifier, like Claude Code's
 * read-only shell commands. Anything chained, redirected, naming a key file or reading file
 * contents is not one.
 */
export function readOnlyCommand(command: string): boolean {
  if (!isSimpleCommand(command) || mentionsSensitive(command)) return false
  const w = words(command)
  if (w.length === 0) return false
  const first = bare(w[0]!)
  const rest = w.slice(1)
  if (rest.some((a) => NOT_READ.test(a))) return false
  if (LISTERS.has(first)) return true
  if (READ_SUB[first]?.has((rest[0] ?? "").toLowerCase())) return true
  return VERSIONED.has(first) && rest.length === 1 && /^(--version|-V|version)$/.test(rest[0]!)
}

/** The command starts an interpreter or a wrapper that runs other commands. */
export function startsInterpreter(command: string) {
  const w = words(command.trim().replace(/^&\s*/, ""))
  return w.length > 0 && INTERPRETERS.has(bare(w[0]!))
}

/** Split into the commands a shell would run (on ; && || | and newlines). */
export function segments(command: string): string[] {
  return command
    .split(/\r?\n|;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const RECURSIVE_DELETE = /^(?:sudo\s+)?(?:rm|rmdir|rd|del|erase|remove-item|ri)\b/i

/** Flags that make a delete recursive: rm -r/-R/-rf, rd /s, del /s, Remove-Item -Recurse (any prefix of it). */
function recursive(w: string[]) {
  return w.slice(1).some((a) => /^-[a-z]*r[a-z]*$/i.test(a) || /^--recursive$/i.test(a) || /^\/s$/i.test(a) || /^-rec(u(r(s(e)?)?)?)?$/i.test(a))
}

export interface CriticalEnv {
  /** Folders whose loss is unrecoverable: home, the workspace roots. */
  roots: string[]
  platform?: NodeJS.Platform
}

/** A target that names the filesystem root, a drive, home, a top-level folder, a workspace root or everything. */
function criticalTarget(raw: string, env: CriticalEnv): boolean {
  const t = raw.replace(/^["']|["']$/g, "").replace(/[\\/]+\*?$/, "").replace(/\*$/, "")
  if (t === "" || t === "*" || t === "." || t === ".." || t === "~" || t === "/") return true
  if (/^(\$home|\$env:userprofile|\$env:homedrive|%userprofile%|%homedrive%|\$\{?home\}?|~[\\/]?)$/i.test(t)) return true
  if (/^[a-z]:$/i.test(t)) return true // C:  C:\  C:\*
  // A direct child of a root: C:\Windows, C:\Users, /usr, /home…
  if (/^([a-z]:)?[\\/][^\\/]+$/i.test(t)) return true
  const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
  return env.roots.some((root) => norm(root) === norm(t))
}

/** Why this command must never run, or undefined. */
export function criticalDelete(command: string, env: CriticalEnv): string | undefined {
  for (const raw of segments(command)) {
    // `cmd /c rd /s …`, `& rm -rf …`: look at the command being wrapped.
    const segment = raw.replace(/^(&\s*|cmd(\.exe)?\s+\/[ck]\s+)+/i, "")
    if (!RECURSIVE_DELETE.test(segment)) continue
    const w = words(segment)
    // Remove-Item treats a bare * or a path ending in \* as recursive enough on its own.
    const isRemoveItem = /^(remove-item|ri)$/i.test(w[0] ?? "")
    const targets = w.slice(1).filter((a) => !a.startsWith("-") && !/^\/[a-z]$/i.test(a))
    if (!recursive(w) && !isRemoveItem) continue
    const hit = targets.find((t) => criticalTarget(t, env))
    if (hit) return `lệnh xoá đệ quy nhắm vào "${hit}" (thư mục gốc, ổ đĩa, home, thư mục hệ thống hoặc gốc workspace)`
  }
  return undefined
}

/** Names of key files, OpenTrading's own data and login autostart, wherever they appear in a command. */
const SENSITIVE =
  /(auth\.json|mcp-auth\.json|\.opentrading\b|[\\/]\.ssh\b|^\.ssh\b|\s\.ssh\b|\.aws[\\/]|\.git-credentials|\.netrc|id_rsa|id_ed25519|\.pem\b|(^|[\s\\/"'])\.env(\.[a-z]+)?\b|\$profile\b|start menu[\\/]programs[\\/]startup|currentversion[\\/]run|crontab|\.bashrc|\.zshrc|\.profile\b|launchagents|user data[\\/]default|register-scheduledtask|schtasks|new-service|set-mppreference|executionpolicy\s+bypass)/i

/** What sensitive name the command mentions, or undefined: the pattern above, then each word against path-safety's lists. */
export function mentionsSensitive(command: string): string | undefined {
  const hit = command.match(SENSITIVE)?.[0]?.trim()
  if (hit) return hit
  for (const segment of segments(command)) for (const w of words(segment)) {
    const name = namesProtected(w)
    if (name) return name
  }
  return undefined
}
