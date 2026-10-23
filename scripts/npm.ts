import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import pkg from "../package.json"
import { NPM_PACKAGE } from "../src/core/update"
import { TARGETS, archiveName, targetName, type Target } from "./targets"

/**
 * npm packages, the way opencode ships its binary: one package per platform
 * (`opentrading-<target>`, with `os`/`cpu` so npm installs only the matching ones) and the
 * `@findahuman/opentrading` package that depends on all of them optionally; its `opentrading` and `ot` commands
 * are a small Node launcher that runs the matching binary (scripts/npm/launcher.cjs). opencode puts
 * the binary in place with postinstall instead, but npm 12 blocks install scripts by default.
 *
 * Cách chạy:
 *   bun scripts/npm.ts                       pack from dist/opentrading-<target>/bin (bun run build)
 *   bun scripts/npm.ts --archives release    pack from release archives (.zip / .tar.gz)
 *   add --publish to publish (skips versions already on npm; needs NODE_AUTH_TOKEN, --provenance in CI)
 * Output: dist/npm/<package>/ and dist/npm/<package>-<version>.tgz
 */

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, "dist", "npm")
const archives = process.argv.includes("--archives") ? path.resolve(process.argv[process.argv.indexOf("--archives") + 1] ?? "") : undefined
const publish = process.argv.includes("--publish")
const version = process.env.OPENTRADING_BUILD_VERSION ?? pkg.version
const NODE_OS = { windows: "win32", linux: "linux", darwin: "darwin" } as const

const npm = (args: string[], cwd: string) => {
  const run = Bun.spawnSync([process.platform === "win32" ? "npm.cmd" : "npm", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  return { ok: run.success, text: `${run.stdout}${run.stderr}`.trim() }
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const common = {
  version,
  license: pkg.license,
  repository: pkg.repository,
  homepage: "https://github.com/FinDaHuman/OpenTrading#readme",
}

const platforms: Record<string, string> = {}
for (const target of TARGETS) {
  const name = `opentrading-${targetName(target)}`
  const exe = target.os === "windows" ? "opentrading.exe" : "opentrading"
  const dir = path.join(out, name)
  await mkdir(path.join(dir, "bin"), { recursive: true })
  if (!(await binaryInto(target, path.join(dir, "bin"), exe))) {
    await rm(dir, { recursive: true, force: true })
    continue
  }
  if (target.os !== "windows") await chmod(path.join(dir, "bin", exe), 0o755)
  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({ name, description: `OpenTrading binary for ${targetName(target)}`, ...common, os: [NODE_OS[target.os]], cpu: [target.arch], preferUnplugged: true }, null, 2),
  )
  await copyFile(path.join(root, "LICENSE"), path.join(dir, "LICENSE"))
  platforms[name] = version
}
if (Object.keys(platforms).length === 0) throw new Error("no binaries found: run bun run build, or pass --archives <dir>")

const main = path.join(out, "opentrading")
await mkdir(path.join(main, "bin"), { recursive: true })
await copyFile(path.join(import.meta.dir, "npm", "launcher.cjs"), path.join(main, "bin", "opentrading.cjs"))
await chmod(path.join(main, "bin", "opentrading.cjs"), 0o755)
await copyFile(path.join(root, "LICENSE"), path.join(main, "LICENSE"))
await Bun.write(
  path.join(main, "README.md"),
  `# OpenTrading\n\nTerminal AI harness for researching Vietnamese equities. See https://github.com/FinDaHuman/OpenTrading#readme\n\n\`\`\`shell\nnpm i -g @findahuman/opentrading\not\n\`\`\`\n`,
)
await Bun.write(
  path.join(main, "package.json"),
  JSON.stringify(
    {
      name: NPM_PACKAGE,
      description: pkg.description,
      ...common,
      bin: { opentrading: "bin/opentrading.cjs", ot: "bin/opentrading.cjs" },
      engines: { node: ">=18" },
      os: ["win32", "darwin", "linux"],
      cpu: ["x64", "arm64"],
      optionalDependencies: platforms,
    },
    null,
    2,
  ),
)

// Platform packages first: the main package must never point at versions npm lacks.
for (const name of [...Object.keys(platforms), NPM_PACKAGE]) {
  const dir = name === NPM_PACKAGE ? main : path.join(out, name)
  const packed = npm(["pack", "--pack-destination", out], dir)
  if (!packed.ok) throw new Error(`npm pack ${name}: ${packed.text}`)
  console.log(`packed ${name}@${version}`)
  if (!publish) continue
  if (npm(["view", `${name}@${version}`, "version"], dir).ok) {
    console.log(`  already on npm: ${name}@${version}`)
    continue
  }
  const pub = npm(["publish", "--access", "public", ...(process.env.CI ? ["--provenance"] : [])], dir)
  if (!pub.ok) throw new Error(`npm publish ${name}: ${pub.text}`)
  console.log(`  published ${name}@${version}`)
}

/** Copy the binary for `target` into `binDir` from the build folder or a release archive. */
async function binaryInto(target: Target, binDir: string, exe: string): Promise<boolean> {
  if (!archives) {
    const built = path.join(root, "dist", `opentrading-${targetName(target)}`, "bin", exe)
    if (!(await Bun.file(built).exists())) return false
    await copyFile(built, path.join(binDir, exe))
    return true
  }
  const archive = path.join(archives, archiveName(target))
  if (!(await Bun.file(archive).exists())) return false
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
  // bsdtar (Windows, macOS) reads zip too; GNU tar on Linux does not.
  const command = archive.endsWith(".zip") && process.platform === "linux" ? ["unzip", "-q", "-o", archive, "-d", binDir] : [tar, "-xf", archive, "-C", binDir]
  const run = Bun.spawnSync(command, { stdout: "ignore", stderr: "pipe" })
  if (!run.success) throw new Error(`extracting ${archive}: ${run.stderr}`)
  return (await readdir(binDir)).includes(exe)
}
