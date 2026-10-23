import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { build } from "./build-info"
import { dataDir } from "./home"

/**
 * New versions: what is installed, what the latest release is, and replacing a binary in place.
 * Releases come from GitHub (scripts/build.ts → .github/workflows/release.yml); a release stays a
 * draft until every channel has it, so `releases/latest` never names a version npm lacks.
 */

export const REPO = "FinDaHuman/OpenTrading"
/** The npm package (the unscoped name was refused as too close to "opentracing"). */
export const NPM_PACKAGE = "@findahuman/opentrading"
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`
const NPM_LATEST = `https://registry.npmjs.org/${NPM_PACKAGE.replace("/", "%2f")}/latest`
const CHECK_EVERY_MS = 24 * 3_600_000

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export type Install =
  | { kind: "source" }
  /** Installed with `npm i -g @findahuman/opentrading`: npm owns the files, so it updates them. */
  | { kind: "npm"; dir: string }
  /** Installed by install.sh / install.ps1 (or copied by hand): replaced in place. */
  | { kind: "binary"; dir: string; target: string }

export function detectInstall(execPath = process.execPath, info = build): Install {
  if (!info) return { kind: "source" }
  const dir = path.dirname(execPath)
  if (execPath.split(/[\\/]/).includes("node_modules")) return { kind: "npm", dir }
  return { kind: "binary", dir, target: info.target }
}

/** -1, 0 or 1 for `x.y.z` versions (a leading v and a -prerelease suffix are ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/** The newest published version for this kind of install. */
export async function latestVersion(install: Install, fetchFn: Fetch = fetch): Promise<string> {
  const timeout = AbortSignal.timeout(10_000)
  if (install.kind === "npm") {
    const res = await fetchFn(NPM_LATEST, { signal: timeout })
    if (!res.ok) throw new Error(`npm registry: HTTP ${res.status}`)
    return String(((await res.json()) as { version?: string }).version ?? "")
  }
  const res = await fetchFn(RELEASES_API, { signal: timeout, headers: { accept: "application/vnd.github+json" } })
  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`)
  const tag = String(((await res.json()) as { tag_name?: string }).tag_name ?? "")
  if (!tag) throw new Error("GitHub releases: no tag_name")
  return tag.replace(/^v/, "")
}

interface Cache {
  checkedAt: number
  latest: string
}

const cacheFile = () => path.join(dataDir(), "cache", "update.json")

/** Last answer of {@link checkForUpdate}, without asking the network. */
export async function cachedLatest(): Promise<string | undefined> {
  try {
    return (JSON.parse(await readFile(cacheFile(), "utf8")) as Cache).latest || undefined
  } catch {
    return undefined
  }
}

/**
 * The newer version if there is one, asking the network at most once a day (the answer is
 * cached in ~/.opentrading/cache/update.json). Never throws: no network means no news.
 */
export async function checkForUpdate(current: string, install: Install, opts: { fetch?: Fetch; now?: number } = {}): Promise<string | undefined> {
  const now = opts.now ?? Date.now()
  let latest: string | undefined
  try {
    const cache = JSON.parse(await readFile(cacheFile(), "utf8")) as Cache
    if (now - cache.checkedAt < CHECK_EVERY_MS && cache.checkedAt <= now) latest = cache.latest
  } catch {
    // no cache yet
  }
  if (latest === undefined) {
    try {
      latest = await latestVersion(install, opts.fetch)
      await mkdir(path.dirname(cacheFile()), { recursive: true })
      await writeFile(cacheFile(), JSON.stringify({ checkedAt: now, latest } satisfies Cache))
    } catch {
      return undefined
    }
  }
  return latest && compareVersions(latest, current) > 0 ? latest : undefined
}

/** Off with `update.check: false` in config.json or OPENTRADING_DISABLE_UPDATE_CHECK=1. */
export function updateCheckEnabled(config: { update?: { check?: boolean } }): boolean {
  return config.update?.check !== false && !process.env.OPENTRADING_DISABLE_UPDATE_CHECK
}

export const archiveFor = (target: string) => `opentrading-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`

/** Where release files are downloaded from; OPENTRADING_RELEASE_BASE points tests at a local server. */
export function releaseBase(version?: string): string {
  if (process.env.OPENTRADING_RELEASE_BASE) return process.env.OPENTRADING_RELEASE_BASE.replace(/\/+$/, "")
  return version ? `https://github.com/${REPO}/releases/download/v${version.replace(/^v/, "")}` : `https://github.com/${REPO}/releases/latest/download`
}

export interface ApplyOptions {
  dir: string
  target: string
  /** A version to install; latest when omitted. */
  version?: string
  fetch?: Fetch
  platform?: NodeJS.Platform
  /** Runs the new binary with --version; returns its first line (tests stub it). */
  probe?: (file: string) => string
}

/**
 * Download the archive for `target`, check it against SHA256SUMS, and swap it in for
 * `<dir>/opentrading[.exe]` (and the `ot` alias when there is one). Nothing changes unless every
 * step before the swap succeeds; a failed swap puts the old files back. Returns the new
 * binary's `--version` line.
 */
export async function applyUpdate(opts: ApplyOptions): Promise<string> {
  const fetchFn = opts.fetch ?? fetch
  const windows = (opts.platform ?? process.platform) === "win32"
  const base = releaseBase(opts.version)
  const archive = archiveFor(opts.target)
  // Inside the install folder: the final rename stays on one volume.
  const work = mkdtempSync(path.join(opts.dir, ".update-"))
  try {
    const download = async (name: string) => {
      const res = await fetchFn(`${base}/${name}`, { signal: AbortSignal.timeout(300_000) })
      if (!res.ok) throw new Error(`tải ${name} thất bại: HTTP ${res.status} (${base})`)
      return new Uint8Array(await res.arrayBuffer())
    }
    const data = await download(archive)
    const sums = new TextDecoder().decode(await download("SHA256SUMS"))
    const expected = sums
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      .find((p) => p[1]?.replace(/^\*/, "") === archive)?.[0]
      ?.toLowerCase()
    if (!expected) throw new Error(`SHA256SUMS không có ${archive}`)
    const actual = createHash("sha256").update(data).digest("hex")
    if (actual !== expected) throw new Error(`sai checksum ${archive}: cần ${expected}, nhận ${actual}`)

    const archivePath = path.join(work, archive)
    await writeFile(archivePath, data)
    const out = path.join(work, "x")
    await mkdir(out)
    const tar = windows ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
    const unpack = Bun.spawnSync([tar, "-xf", archivePath, "-C", out], { stdout: "ignore", stderr: "pipe" })
    if (!unpack.success) throw new Error(`giải nén ${archive} thất bại: ${unpack.stderr.toString().trim()}`)
    const exeName = windows ? "opentrading.exe" : "opentrading"
    const fresh = path.join(out, exeName)
    if (!existsSync(fresh)) throw new Error(`${archive} không có ${exeName}`)
    if (!windows) chmodSync(fresh, 0o755)
    const probe = opts.probe ?? runVersion
    const line = probe(fresh)
    if (opts.version && !line.includes(opts.version.replace(/^v/, ""))) throw new Error(`bản tải về báo "${line}", không phải ${opts.version}`)

    swapIn(opts.dir, fresh, windows)
    return line
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function runVersion(file: string): string {
  const run = Bun.spawnSync([file, "--version"], { stdout: "pipe", stderr: "pipe" })
  if (!run.success) throw new Error(`bản mới không chạy được: ${run.stderr.toString().trim() || `exit ${run.exitCode}`}`)
  return run.stdout.toString().split(/\r?\n/)[0]!.trim()
}

function swapIn(dir: string, fresh: string, windows: boolean) {
  const exe = path.join(dir, windows ? "opentrading.exe" : "opentrading")
  const alias = path.join(dir, windows ? "ot.exe" : "ot")
  const hasAlias = exists(alias)
  if (!windows) {
    // rename over a running binary is fine on Unix: the running process keeps the old inode.
    const staged = path.join(dir, ".opentrading.new")
    copyFileSync(fresh, staged)
    chmodSync(staged, 0o755)
    renameSync(staged, exe)
    if (hasAlias && !lstatSync(alias).isSymbolicLink()) {
      unlinkSync(alias)
      symlinkSync("opentrading", alias)
    }
    return
  }
  // Windows: a running exe (or any hard link to it, such as ot.exe) can be renamed but not
  // overwritten or deleted. Move every name aside first, then write the new files.
  const moved: [string, string][] = []
  try {
    for (const file of hasAlias ? [exe, alias] : [exe]) {
      if (!exists(file)) continue
      const old = freeName(`${file}.old`)
      renameSync(file, old)
      moved.push([file, old])
    }
    copyFileSync(fresh, exe)
    if (hasAlias) {
      try {
        linkSync(exe, alias)
      } catch {
        copyFileSync(exe, alias)
      }
    }
  } catch (error) {
    for (const [file, old] of moved) {
      try {
        if (exists(file)) unlinkSync(file)
        renameSync(old, file)
      } catch {
        // leave what is there; the error below says what failed
      }
    }
    throw new Error(`không ghi được vào ${dir}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const exists = (file: string) => {
  try {
    lstatSync(file)
    return true
  } catch {
    return false
  }
}

function freeName(file: string): string {
  if (!exists(file)) return file
  try {
    unlinkSync(file)
    return file
  } catch {
    // still running from an earlier update
    return `${file.slice(0, -4)}.${Date.now()}.old`
  }
}

/** Remove the `.old` files a Windows update left behind (they were running then). */
export function removeOldBinaries(dir: string) {
  try {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name)
      // An .update- folder younger than an hour may belong to an update running right now.
      const stale = name.endsWith(".old") || (name.startsWith(".update-") && Date.now() - statSync(file).mtimeMs > 3_600_000)
      if (stale) rmSync(file, { recursive: true, force: true })
    }
  } catch {
    // still in use, or not ours: next start tries again
  }
}
