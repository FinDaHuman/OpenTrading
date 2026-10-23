import { mkdir } from "node:fs/promises"
import path from "node:path"
import { TARGETS, archiveName, targetName } from "./targets"

/**
 * Archive every built dist/opentrading-<target>/bin into dist/release/opentrading-<target>.zip
 * (Windows, macOS) or .tar.gz (Linux), with the binary at the archive root. Run after
 * scripts/build.ts on the same runner; the release job adds SHA256SUMS over all of them.
 * Cách chạy: bun scripts/package.ts
 */

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, "dist", "release")
await mkdir(out, { recursive: true })

let count = 0
for (const target of TARGETS) {
  const bin = path.join(root, "dist", `opentrading-${targetName(target)}`, "bin")
  const exe = target.os === "windows" ? "opentrading.exe" : "opentrading"
  if (!(await Bun.file(path.join(bin, exe)).exists())) continue
  const archive = path.join(out, archiveName(target))
  await Bun.file(archive).delete().catch(() => {})
  const command =
    process.platform === "win32"
      ? // Windows' own bsdtar writes both formats (-a picks it from the name); Git's GNU tar on PATH
        // can do neither zip nor D:\ paths. No exec bit from NTFS: the install scripts chmod.
        [path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), "-a", "-cf", archive, "-C", bin, exe]
      : target.os === "linux"
        ? ["tar", "-czf", archive, "-C", bin, exe]
        : ["zip", "-j", "-q", archive, path.join(bin, exe)]
  const run = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" })
  if (!run.success) throw new Error(`archiving ${targetName(target)} failed`)
  console.log(`packed ${path.relative(root, archive)}`)
  count++
}
if (count === 0) throw new Error("nothing to package: run scripts/build.ts first")
