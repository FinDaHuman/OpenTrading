import os from "node:os"
import path from "node:path"
import { dataDir } from "../paths"

/**
 * One list of paths the agent must not touch on its own, shared by the file tools, the
 * permission gate and (later) the auto-mode classifier.
 *
 * - Secret paths: reading one sends its content to the LLM provider, so a read always asks
 *   the user and no rule or classifier can approve it (Claude Code protected paths,
 *   opencode `read: { "*.env": "ask" }`).
 * - UNC paths (`\\server\share`): touching one can leak the user's NTLM hash to that host,
 *   so nothing reads it before the user says yes (Claude Code FileReadTool).
 * - Odd Windows spellings (alternate data streams, `\\?\`, device names, trailing dots)
 *   that can make a path check and the real file disagree (Claude Code filesystem.ts).
 */

const isWin = (platform: NodeJS.Platform) => platform === "win32"

/** Path functions of `platform` (win32 rules also run on Linux CI). */
export const pathFor = (platform: NodeJS.Platform = process.platform) => (isWin(platform) ? path.win32 : path.posix)

/** Compare paths the way the OS does: case-insensitive on Windows and macOS. */
export function samePathKey(p: string, platform: NodeJS.Platform = process.platform) {
  const normalized = pathFor(platform).resolve(p)
  return isWin(platform) || platform === "darwin" ? normalized.toLowerCase() : normalized
}

/** `child` is `parent` or inside it (both absolute). */
export function isInside(child: string, parent: string, platform: NodeJS.Platform = process.platform) {
  const flavor = pathFor(platform)
  const c = samePathKey(child, platform)
  const p = samePathKey(parent, platform)
  if (c === p) return true
  const rel = flavor.relative(p, c)
  return rel !== "" && !rel.startsWith("..") && !flavor.isAbsolute(rel)
}

/** Files under the data dir that hold keys and tokens (auth.json: LLM keys; mcp-*: OAuth tokens, headers). */
const DATA_SECRETS = ["auth.json", "mcp-auth.json", "mcp.json"]

/**
 * Folders under the data dir with copies of the user's files: a backup of `.env` is named
 * `0001-.env`, so the name rule alone would miss it (/undo copies). Saved shell output
 * (`tool-output`) stays readable: it is the rest of what an approved command printed.
 */
const DATA_SECRET_DIRS = ["file-history"]

/** Directories under home that hold credentials (whole tree is secret). */
const HOME_SECRET_DIRS = [
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  ".kube",
  ".docker",
  ".config/gcloud",
  ".password-store",
  // Browser profiles: cookies, saved passwords.
  "AppData/Local/Google/Chrome/User Data",
  "AppData/Local/Microsoft/Edge/User Data",
  "AppData/Local/BraveSoftware/Brave-Browser/User Data",
  "AppData/Roaming/Mozilla/Firefox/Profiles",
  "AppData/Roaming/Opera Software",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Firefox",
  "Library/Keychains",
  ".config/google-chrome",
  ".config/chromium",
  ".mozilla/firefox",
]

/** Single files under home that hold tokens. */
const HOME_SECRET_FILES = [".git-credentials", ".netrc", "_netrc", ".npmrc", ".pypirc", ".codex/auth.json", ".claude/.credentials.json", ".claude.json"]

/** Secret by name wherever it is. */
const SECRET_NAME = /^(\.env|\.env\..+|id_rsa.*|id_dsa.*|id_ecdsa.*|id_ed25519.*|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.kdbx|.*\.keystore|\.htpasswd)$/i
/** Template env files hold placeholders, not secrets. */
const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist)$/i

export interface SafetyEnv {
  home?: string
  data?: string
  platform?: NodeJS.Platform
}

function env(e: SafetyEnv = {}) {
  return { home: e.home ?? os.homedir(), data: e.data ?? dataDir(), platform: e.platform ?? process.platform }
}

/** Why `abs` is a secret path, or undefined. `abs` must be absolute. */
export function secretReason(abs: string, e?: SafetyEnv): string | undefined {
  const { home, data, platform } = env(e)
  const flavor = pathFor(platform)
  const name = flavor.basename(abs)
  if (SECRET_NAME.test(name) && !ENV_TEMPLATE.test(name)) return `tên file bí mật (${name})`
  for (const file of DATA_SECRETS) if (samePathKey(abs, platform) === samePathKey(flavor.join(data, file), platform)) return `khoá/token của OpenTrading (${file})`
  for (const dir of DATA_SECRET_DIRS) if (isInside(abs, flavor.join(data, dir), platform)) return `bản sao file của OpenTrading (${dir})`
  for (const dir of HOME_SECRET_DIRS) if (isInside(abs, flavor.join(home, dir), platform)) return `thư mục chứa thông tin đăng nhập (~/${dir})`
  for (const file of HOME_SECRET_FILES) if (samePathKey(abs, platform) === samePathKey(flavor.join(home, file), platform)) return `file chứa token (~/${file})`
  return undefined
}

/**
 * A directory a search must not walk into (glob/grep skip it silently): the secret trees,
 * and the data dir's key files are skipped file by file by `secretReason`.
 */
export function isSecretDir(abs: string, e?: SafetyEnv): boolean {
  const { home, data, platform } = env(e)
  const flavor = pathFor(platform)
  return HOME_SECRET_DIRS.some((dir) => isInside(abs, flavor.join(home, dir), platform)) || DATA_SECRET_DIRS.some((dir) => isInside(abs, flavor.join(data, dir), platform))
}

/** `\\server\share\…` or `//server/share/…` (not the `\\?\` / `\\.\` prefixes). */
export function isUncPath(p: string) {
  return /^(\\\\|\/\/)(?![?.][\\/])[^\\/]+[\\/]/.test(p)
}

const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/**
 * Windows spellings a path check can misread: an alternate data stream (`a.txt:secret`),
 * `\\?\` / `\\.\` prefixes, DOS device names, 8.3 short names (`PROGRA~1`), trailing dots or
 * spaces in a segment. Returns a reason or undefined. Only meaningful on Windows.
 */
export function suspiciousWindowsPath(p: string, platform: NodeJS.Platform = process.platform, opts: { shortNames?: boolean } = {}): string | undefined {
  if (!isWin(platform)) return undefined
  if (/^\\\\[?.]\\/.test(p)) return "tiền tố \\\\?\\ hoặc \\\\.\\"
  const rest = p.replace(/^[a-zA-Z]:/, "")
  if (rest.includes(":")) return "alternate data stream (dấu : trong đường dẫn)"
  for (const segment of rest.split(/[\\/]+/)) {
    if (!segment || segment === "." || segment === "..") continue
    if (DEVICE.test(segment)) return `tên thiết bị DOS (${segment})`
    if (/[. ]$/.test(segment)) return `đoạn đường dẫn kết thúc bằng dấu chấm/khoảng trắng (${segment})`
    if (opts.shortNames !== false && /~\d/.test(segment)) return `tên ngắn 8.3 (${segment})`
  }
  return undefined
}

/**
 * The user's path as typed or dropped into the terminal: surrounding quotes removed, `~`
 * expanded, relative paths resolved against `base`.
 */
export function resolveUserPath(raw: string, base: string, home = os.homedir()): string {
  let p = raw.trim()
  if (p.length >= 2 && ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")))) p = p.slice(1, -1)
  if (p === "~") p = home
  else if (p.startsWith("~/") || p.startsWith("~\\")) p = path.join(home, p.slice(2))
  if (p.startsWith("file://")) {
    try {
      p = Bun.fileURLToPath(p)
    } catch {
      // keep as typed
    }
  }
  return path.resolve(base, p)
}

/**
 * Whether reading `abs` must ask the user first, as an approval scope: `unc:` (network path),
 * `odd:` (a Windows spelling a check can misread, e.g. `auth.json::$DATA`), `secret:` (key
 * file or credential folder, by the path as given or by where its symlinks lead).
 * The string checks come first: resolving symlinks on a UNC path is itself the network access.
 */
export function readScope(abs: string, e?: SafetyEnv, real: (p: string) => string = (p) => p): string | undefined {
  const platform = e?.platform ?? process.platform
  if (isUncPath(abs)) return `unc:${abs}`
  // 8.3 short names are fine for a read (the temp folder is often C:\Users\RUNNER~1\…):
  // the real-path check below sees the long name.
  if (suspiciousWindowsPath(abs, platform, { shortNames: false })) return `odd:${abs}`
  if (secretReason(abs, e) || isSecretDir(abs, e)) return `secret:${abs}`
  const resolved = real(abs)
  if (resolved === abs) return undefined
  if (isUncPath(resolved)) return `secret:${abs}`
  // Compare real with real: home and the data dir may be spelled short (C:\Users\RUNNER~1)
  // while a resolved link comes back with the long name.
  const { home, data } = env(e)
  const realEnv: SafetyEnv = { home: real(home), data: real(data), platform }
  if (secretReason(resolved, realEnv) || isSecretDir(resolved, realEnv) || secretReason(resolved, e) || isSecretDir(resolved, e)) return `secret:${abs}`
  return undefined
}

/** Scopes that must never be stored as "always allow" (approval asks per exact path). */
export const isSensitiveScope = (scope: string | undefined) => !!scope && /^(secret|unc|odd|protected|outside):/.test(scope)

/** File names that configure a shell, git, a package manager or a hook runner: writing one is persistence. */
const PROTECTED_NAME =
  /^(\.bashrc|\.bash_profile|\.bash_login|\.bash_logout|\.bash_aliases|\.profile|\.zshrc|\.zprofile|\.zshenv|\.zlogin|\.zlogout|\.envrc|\.gitconfig|\.gitmodules|\.npmrc|\.yarnrc|\.yarnrc\.yml|bunfig\.toml|\.bunfig\.toml|\.pre-commit-config\.yaml|lefthook\.ya?ml|\.mcp\.json|.*profile\.ps1)$/i
/** Folder names whose content runs code or holds tool config, wherever they are. */
const PROTECTED_DIR = new Set([".git", ".opentrading", ".vscode", ".idea", ".husky", ".github", ".devcontainer", ".ssh"])
/** Folders under home where a file starts at login. */
const AUTOSTART = ["AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup", ".config/autostart", "Library/LaunchAgents"]

/**
 * Why writing `abs` needs the user's own yes, or undefined: OpenTrading's data (config.json
 * holds the permission rules; skills/agents run as instructions), tool config folders,
 * shell/git/package-manager rc files, login autostart, key files (Claude Code protected paths).
 * `<data>/workspace` is an ordinary workspace.
 */
export function protectedWriteReason(abs: string, e?: SafetyEnv): string | undefined {
  const { home, data, platform } = env(e)
  const flavor = pathFor(platform)
  const secret = secretReason(abs, e)
  if (secret) return secret
  // The fallback workspace sits in the data dir (itself named .opentrading): folder names
  // count from the workspace down, not above it.
  const fallback = flavor.join(data, "workspace")
  if (isInside(abs, data, platform) && !isInside(abs, fallback, platform)) return "dữ liệu và cấu hình của OpenTrading"
  const name = flavor.basename(abs)
  if (PROTECTED_NAME.test(name)) return `file cấu hình (${name})`
  const below = isInside(abs, fallback, platform) ? flavor.relative(fallback, abs) : flavor.normalize(abs)
  const segments = below.split(/[\\/]+/)
  const dir = segments.slice(0, -1).find((s) => PROTECTED_DIR.has(s.toLowerCase()))
  if (dir) return `thư mục cấu hình ${dir}`
  if (AUTOSTART.some((d) => isInside(abs, flavor.join(home, d), platform))) return "thư mục tự chạy khi đăng nhập"
  return undefined
}

/**
 * A word of a shell command that names something write_file would protect or read_file would
 * ask about: a key file name, a config file name, or a path through a protected folder
 * (`.git/hooks/pre-commit`, `.opentrading\config.json`). Same lists as above, so the shell
 * and the file tools cannot drift apart.
 */
export function namesProtected(word: string): string | undefined {
  const parts = word.replace(/^["']|["']$/g, "").split(/[\\/]+/).filter(Boolean)
  const name = parts.at(-1) ?? ""
  if ((SECRET_NAME.test(name) && !ENV_TEMPLATE.test(name)) || PROTECTED_NAME.test(name) || DATA_SECRETS.includes(name.toLowerCase())) return name
  return parts.find((p) => PROTECTED_DIR.has(p.toLowerCase()))
}

export type WriteCheck = { block: string } | { scope: string }

/**
 * The approval scope for writing `abs`: `block` (never: odd Windows spelling, network path),
 * `protected:` / `outside:` (the user decides each time, nothing can pre-approve it), or
 * `edit:<folder>` (an ordinary write in the workspace; "this session" covers the folder).
 * `real` resolves symlinks; `inWorkspace` is Workspace.contains.
 */
export function writeCheck(abs: string, inWorkspace: (p: string) => boolean, e?: SafetyEnv, real: (p: string) => string = (p) => p): WriteCheck {
  const platform = e?.platform ?? process.platform
  if (isUncPath(abs)) return { block: "không ghi lên đường dẫn mạng (\\\\server\\share)" }
  const odd = suspiciousWindowsPath(abs, platform, { shortNames: false })
  if (odd) return { block: `đường dẫn dạng lạ: ${odd}` }
  const resolved = real(abs)
  // 8.3 short names only on the real path (the given one may be C:\Users\RUNNER~1\…).
  const oddReal = suspiciousWindowsPath(resolved, platform)
  if (oddReal) return { block: `đường dẫn dạng lạ: ${oddReal}` }
  const { home, data } = env(e)
  const realEnv: SafetyEnv = { home: real(home), data: real(data), platform }
  if (protectedWriteReason(abs, e) || (resolved !== abs && (protectedWriteReason(resolved, e) || protectedWriteReason(resolved, realEnv)))) return { scope: `protected:${abs}` }
  if (!inWorkspace(abs)) return { scope: `outside:${abs}` }
  return { scope: `edit:${pathFor(platform).dirname(abs)}` }
}
