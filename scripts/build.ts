import { createHash } from "node:crypto"
import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import pkg from "../package.json"
import { TARGETS, targetName, type Target } from "./targets"

/**
 * Build standalone binaries (Bun runtime inside, nothing else to install) into
 * dist/opentrading-<os>-<arch>[-baseline]/bin/opentrading[.exe].
 * Cách chạy: bun run build [--single | --targets linux-x64,linux-arm64]
 *   --single: only this machine's platform; --targets: those (release.yml splits them per runner).
 * The binary for this machine's platform is smoke-tested (--version, --self-check).
 */

const root = path.resolve(import.meta.dir, "..")
const single = process.argv.includes("--single")
const only = process.argv.includes("--targets") ? process.argv[process.argv.indexOf("--targets") + 1]?.split(",") : undefined

const hostOs = process.platform === "win32" ? "windows" : process.platform
const isHost = (t: Target) => t.os === hostOs && t.arch === process.arch && !t.baseline

const targets = single ? TARGETS.filter(isHost) : only ? TARGETS.filter((t) => only.includes(targetName(t))) : TARGETS
if (only && targets.length !== only.length) throw new Error(`Unknown target in ${only.join(",")}; known: ${TARGETS.map(targetName).join(", ")}`)
if (targets.length === 0) throw new Error(`No build target for ${process.platform}-${process.arch}`)

// Files read at run time (skills, agents, prompts, market calendar) go inside the binary;
// src/core/bundle.ts writes them out once per version. Tracked files only: no local leftovers.
const listed = Bun.spawnSync(["git", "ls-files", "-z", "skills", "agents", "prompts", "market"], { cwd: root, stdout: "pipe" })
if (!listed.success) throw new Error("git ls-files failed")
const files = listed.stdout.toString().split("\0").filter(Boolean).sort()
const assets: Record<string, string> = {}
const hash = createHash("sha256")
for (const file of files) {
  const text = await Bun.file(path.join(root, file)).text()
  assets[file] = text
  hash.update(file).update("\0").update(text).update("\0")
}
// OPENTRADING_BUILD_VERSION: CI builds a "next" version to exercise `opentrading update` end to end.
const version = process.env.OPENTRADING_BUILD_VERSION ?? pkg.version
const assetsId = `${version}-${hash.digest("hex").slice(0, 8)}`

const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root, stdout: "pipe" }).stdout.toString().trim()

if (!single) {
  // OpenTUI's native library comes as one optional package per platform; fetch them all.
  const install = Bun.spawnSync([process.execPath, "install", "--os=*", "--cpu=*", `@opentui/core@${pkg.dependencies["@opentui/core"]}`], { cwd: root, stdout: "inherit", stderr: "inherit" })
  if (!install.success) throw new Error("bun install of every @opentui/core native package failed")
}

const workerFile = "opentui-tree-sitter-worker.js"
const worker = await Bun.file(fileURLToPath(import.meta.resolve("@opentui/core/parser.worker"))).text()

for (const target of targets) {
  const name = `opentrading-${targetName(target)}`
  const out = path.join(root, "dist", name)
  await rm(out, { recursive: true, force: true })
  console.log(`building ${name}`)
  const bunfs = target.os === "windows" ? "B:/~BUN/root/" : "/$bunfs/root/"
  if (!isHost(target)) await fetchRuntime(target)
  const result = await Bun.build({
    entrypoints: ["./src/index.tsx", workerFile],
    files: { [workerFile]: worker },
    plugins: [createSolidTransformPlugin()],
    conditions: ["bun", "node"],
    format: "esm",
    minify: true,
    splitting: true,
    root,
    compile: {
      // A folder's own bunfig.toml (preload = code) or .env must never reach the binary.
      autoloadBunfig: false,
      autoloadDotenv: false,
      target: `bun-${targetName(target)}` as Bun.Build.CompileTarget,
      outfile: path.join(out, "bin", "opentrading"),
    },
    define: {
      OPENTRADING_VERSION: JSON.stringify(version),
      OPENTRADING_COMMIT: JSON.stringify(commit),
      OPENTRADING_TARGET: JSON.stringify(targetName(target)),
      OPENTRADING_ASSETS_ID: JSON.stringify(assetsId),
      OPENTRADING_ASSETS: JSON.stringify(assets),
      OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(bunfs + workerFile),
    },
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }

  if (isHost(target)) {
    const exe = path.join(out, "bin", target.os === "windows" ? "opentrading.exe" : "opentrading")
    for (const args of [["--version"], ["--self-check"]]) {
      const run = Bun.spawnSync([exe, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, OPENTRADING_HOME: path.join(out, ".smoke-home") } })
      process.stdout.write(run.stdout)
      if (!run.success) {
        process.stderr.write(run.stderr)
        console.error(`smoke test failed: ${name} ${args.join(" ")}`)
        process.exit(1)
      }
    }
    await rm(path.join(out, ".smoke-home"), { recursive: true, force: true })
  }
}

/**
 * Download another platform's Bun runtime with the CLI first. Bun 1.3.14's Bun.build fails on
 * Windows with "Failed to extract executable" when it has to fetch one itself; once the CLI has
 * cached it, Bun.build uses the cache.
 */
async function fetchRuntime(target: Target) {
  const dir = path.join(root, "dist", ".runtime-probe")
  await Bun.write(path.join(dir, "probe.js"), "export {}\n")
  const run = Bun.spawnSync([process.execPath, "build", "--compile", `--target=bun-${targetName(target)}`, path.join(dir, "probe.js"), "--outfile", path.join(dir, `probe-${targetName(target)}`)], { stdout: "pipe", stderr: "pipe" })
  await rm(dir, { recursive: true, force: true })
  if (!run.success) throw new Error(`could not download the Bun runtime for ${targetName(target)}:\n${run.stdout}${run.stderr}`)
}
