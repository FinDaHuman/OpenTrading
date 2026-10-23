import { afterEach, beforeEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, mkdirSync, linkSync, symlinkSync, lstatSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runUpdateCli } from "../src/cli/update"
import { applyUpdate, archiveFor, checkForUpdate, compareVersions, detectInstall, removeOldBinaries, type Fetch } from "../src/core/update"

// The applyUpdate tests pack and unpack real archives: slow on Windows CI runners.
const dirs: string[] = []
let savedHome: string | undefined
beforeEach(async () => {
  savedHome = process.env.OPENTRADING_HOME
  process.env.OPENTRADING_HOME = await temp()
})
afterEach(async () => {
  if (savedHome === undefined) delete process.env.OPENTRADING_HOME
  else process.env.OPENTRADING_HOME = savedHome
  delete process.env.OPENTRADING_RELEASE_BASE
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-update-"))
  dirs.push(dir)
  return dir
}

const windows = process.platform === "win32"
const exeName = windows ? "opentrading.exe" : "opentrading"
const aliasName = windows ? "ot.exe" : "ot"
const target = windows ? "windows-x64" : process.platform === "darwin" ? "darwin-arm64" : "linux-x64"

/** A fetch that serves `files` by the last path segment and counts calls. */
function server(files: Record<string, Uint8Array | string>) {
  const calls: string[] = []
  const fetchFn: Fetch = async (url) => {
    calls.push(url)
    const body = files[url.split("/").pop()!]
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body as BodyInit)
  }
  return { fetch: fetchFn, calls }
}

test("versions compare numerically, ignoring v and prerelease tags", () => {
  expect(compareVersions("0.10.0", "0.9.9")).toBe(1)
  expect(compareVersions("v1.2.3", "1.2.3")).toBe(0)
  expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBe(0)
  expect(compareVersions("1.2", "1.2.1")).toBe(-1)
})

test("install kind from where the binary runs", () => {
  const info = { version: "0.2.0", commit: "abc", target: "linux-x64" }
  expect(detectInstall("/x/opentrading", undefined)).toEqual({ kind: "source" })
  expect(detectInstall("/usr/lib/node_modules/opentrading/bin/opentrading", info).kind).toBe("npm")
  expect(detectInstall("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\opentrading\\bin\\opentrading.exe", info).kind).toBe("npm")
  expect(detectInstall("/home/a/.opentrading/bin/opentrading", info)).toEqual({ kind: "binary", dir: "/home/a/.opentrading/bin", target: "linux-x64" })
})

test("archive names match the release", () => {
  expect(archiveFor("linux-arm64")).toBe("opentrading-linux-arm64.tar.gz")
  expect(archiveFor("windows-x64-baseline")).toBe("opentrading-windows-x64-baseline.zip")
  expect(archiveFor("darwin-arm64")).toBe("opentrading-darwin-arm64.zip")
})

test("the check asks the network at most once a day and never throws", async () => {
  const install = { kind: "binary", dir: "/x", target } as const
  const gh = server({ latest: JSON.stringify({ tag_name: "v0.3.0" }) })
  const now = Date.UTC(2026, 9, 24)
  expect(await checkForUpdate("0.2.0", install, { fetch: gh.fetch, now })).toBe("0.3.0")
  expect(await checkForUpdate("0.2.0", install, { fetch: gh.fetch, now: now + 3_600_000 })).toBe("0.3.0")
  expect(gh.calls).toHaveLength(1)
  expect(await checkForUpdate("0.3.0", install, { fetch: gh.fetch, now: now + 3_600_000 })).toBeUndefined()
  // A day later it asks again.
  await checkForUpdate("0.2.0", install, { fetch: gh.fetch, now: now + 25 * 3_600_000 })
  expect(gh.calls).toHaveLength(2)
  // No network: no news, no error, the old answer is not reused past a day.
  const down: Fetch = async () => {
    throw new Error("offline")
  }
  expect(await checkForUpdate("0.2.0", install, { fetch: down, now: now + 60 * 3_600_000 })).toBeUndefined()
})

test("npm installs read the npm registry, not GitHub", async () => {
  const npm = server({ latest: JSON.stringify({ version: "0.4.0" }) })
  expect(await checkForUpdate("0.2.0", { kind: "npm", dir: "/x" }, { fetch: npm.fetch })).toBe("0.4.0")
  expect(npm.calls[0]).toBe("https://registry.npmjs.org/@findahuman%2fopentrading/latest")
})

test("update CLI: source, npm, up to date, --check, bad arguments", async () => {
  const lines: string[] = []
  const out = (t: string) => void lines.push(t)
  const gh = server({ latest: JSON.stringify({ tag_name: "v0.3.0" }) })
  const binary = { kind: "binary", dir: "/x", target } as const
  let applied: unknown
  const apply = (async (o: unknown) => {
    applied = o
    return "opentrading 0.3.0"
  }) as typeof applyUpdate

  expect(await runUpdateCli([], { install: { kind: "source" }, out })).toBe(0)
  expect(lines.pop()).toContain("git pull")

  expect(await runUpdateCli([], { install: { kind: "npm", dir: "/x" }, current: "0.2.0", fetch: server({ latest: JSON.stringify({ version: "0.3.0" }) }).fetch, out, apply })).toBe(0)
  expect(lines.pop()).toContain("npm i -g @findahuman/opentrading@latest")
  expect(applied).toBeUndefined()

  expect(await runUpdateCli([], { install: binary, current: "0.3.0", fetch: gh.fetch, out, apply })).toBe(0)
  expect(lines.pop()).toContain("mới nhất")

  expect(await runUpdateCli(["--check"], { install: binary, current: "0.2.0", fetch: gh.fetch, out, apply })).toBe(0)
  expect(lines.pop()).toContain("Có OpenTrading 0.3.0")
  expect(applied).toBeUndefined()

  expect(await runUpdateCli([], { install: binary, current: "0.2.0", fetch: gh.fetch, out, apply })).toBe(0)
  expect(applied).toMatchObject({ dir: "/x", target, version: "0.3.0" })
  expect(lines.pop()).toContain("Đã cập nhật")

  // An explicit version is installed even when older, without asking GitHub.
  applied = undefined
  const calls = gh.calls.length
  expect(await runUpdateCli(["v0.1.0"], { install: binary, current: "0.2.0", fetch: gh.fetch, out, apply })).toBe(0)
  expect(applied).toMatchObject({ version: "0.1.0" })
  expect(gh.calls.length).toBe(calls)

  const errs: string[] = []
  expect(await runUpdateCli(["--yolo"], { install: binary, out, err: (t) => void errs.push(t) })).toBe(1)
  const failing = (async () => {
    throw new Error("sai checksum")
  }) as typeof applyUpdate
  expect(await runUpdateCli([], { install: binary, current: "0.2.0", fetch: gh.fetch, out, err: (t) => void errs.push(t), apply: failing })).toBe(1)
  expect(errs.pop()).toContain("vẫn giữ nguyên")
})

/** An install folder holding `old` as opentrading(.exe) and an ot alias, plus a release with `next`. */
async function fixture(next: string) {
  const dir = await temp()
  writeFileSync(path.join(dir, exeName), "old")
  if (windows) linkSync(path.join(dir, exeName), path.join(dir, aliasName))
  else symlinkSync("opentrading", path.join(dir, aliasName))
  const stage = await temp()
  writeFileSync(path.join(stage, exeName), next)
  const archive = path.join(stage, archiveFor(target))
  const tar = windows ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
  const args = windows ? ["-a", "-cf", archive, "-C", stage, exeName] : archive.endsWith(".zip") ? ["-a", "-cf", archive, "-C", stage, exeName] : ["-czf", archive, "-C", stage, exeName]
  const made = Bun.spawnSync([tar, ...args])
  if (!made.success) throw new Error(made.stderr.toString())
  const bytes = new Uint8Array(readFileSync(archive))
  const sum = createHash("sha256").update(bytes).digest("hex")
  return { dir, bytes, sums: `${sum}  ${archiveFor(target)}\n` }
}

test("applyUpdate swaps in the new binary and its alias", async () => {
  const f = await fixture("new")
  const rel = server({ [archiveFor(target)]: f.bytes, SHA256SUMS: f.sums })
  const line = await applyUpdate({ dir: f.dir, target, version: "0.3.0", fetch: rel.fetch, probe: () => "opentrading 0.3.0 (abc)" })
  expect(line).toBe("opentrading 0.3.0 (abc)")
  expect(rel.calls[0]).toContain("/releases/download/v0.3.0/")
  expect(readFileSync(path.join(f.dir, exeName), "utf8")).toBe("new")
  expect(readFileSync(path.join(f.dir, aliasName), "utf8")).toBe("new")
  if (windows) expect(readdirSync(f.dir).filter((n) => n.endsWith(".old")).sort()).toEqual(["opentrading.exe.old", "ot.exe.old"])
  else expect(lstatSync(path.join(f.dir, aliasName)).isSymbolicLink()).toBe(true)
  expect(readdirSync(f.dir).filter((n) => n.startsWith(".update-"))).toEqual([])
  removeOldBinaries(f.dir)
  expect(readdirSync(f.dir).filter((n) => n.endsWith(".old"))).toEqual([])
}, 30_000)

test("applyUpdate changes nothing on a bad checksum, a wrong version or a missing file", async () => {
  const f = await fixture("new")
  const bad = server({ [archiveFor(target)]: f.bytes, SHA256SUMS: f.sums.replace(/^./, (c) => (c === "0" ? "1" : "0")) })
  await expect(applyUpdate({ dir: f.dir, target, version: "0.3.0", fetch: bad.fetch, probe: () => "opentrading 0.3.0" })).rejects.toThrow("checksum")
  const good = server({ [archiveFor(target)]: f.bytes, SHA256SUMS: f.sums })
  await expect(applyUpdate({ dir: f.dir, target, version: "0.3.0", fetch: good.fetch, probe: () => "opentrading 0.2.9" })).rejects.toThrow("0.3.0")
  await expect(applyUpdate({ dir: f.dir, target, version: "0.3.0", fetch: server({}).fetch })).rejects.toThrow("404")
  expect(readFileSync(path.join(f.dir, exeName), "utf8")).toBe("old")
  expect(readdirSync(f.dir).sort()).toEqual([exeName, aliasName].sort())
}, 30_000)

test("OPENTRADING_RELEASE_BASE points downloads at a local server", async () => {
  process.env.OPENTRADING_RELEASE_BASE = "http://127.0.0.1:9/rel/"
  const f = await fixture("new")
  const rel = server({ [archiveFor(target)]: f.bytes, SHA256SUMS: f.sums })
  await applyUpdate({ dir: f.dir, target, version: "0.3.0", fetch: rel.fetch, probe: () => "opentrading 0.3.0" })
  expect(rel.calls[0]).toBe(`http://127.0.0.1:9/rel/${archiveFor(target)}`)
}, 30_000)

test("leftovers: .old files go, a fresh .update- folder stays", async () => {
  const dir = await temp()
  writeFileSync(path.join(dir, "opentrading.exe.old"), "x")
  mkdirSync(path.join(dir, ".update-fresh"))
  mkdirSync(path.join(dir, ".update-stale"))
  const old = new Date(Date.now() - 2 * 3_600_000)
  utimesSync(path.join(dir, ".update-stale"), old, old)
  removeOldBinaries(dir)
  expect(readdirSync(dir)).toEqual([".update-fresh"])
  expect(existsSync(path.join(dir, ".update-fresh")) && statSync(path.join(dir, ".update-fresh")).isDirectory()).toBe(true)
})

test("the TUI toast: binary installs only, once a newer release exists, off by config", async () => {
  const { announceUpdate } = await import("../src/tui/update-notice")
  const { state } = await import("../src/tui/state")
  const gh = server({ latest: JSON.stringify({ tag_name: "v0.3.0" }) })
  const binary = { kind: "binary", dir: await temp(), target } as const
  await announceUpdate({ update: { check: false } }, { install: binary, version: "0.2.0", fetch: gh.fetch })
  await announceUpdate({}, { install: { kind: "source" }, version: "0.2.0", fetch: gh.fetch })
  expect(gh.calls).toHaveLength(0)
  await announceUpdate({}, { install: binary, version: "0.2.0", fetch: gh.fetch })
  const toast = state.toasts.find((t) => t.key === "update")
  expect(toast?.title).toBe("Có OpenTrading 0.3.0")
  expect(toast?.text).toContain("ot update")
})
