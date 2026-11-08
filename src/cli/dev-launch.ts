/**
 * What the `ot` / `opentrading` shims run (src/cli/install.ts): the checkout's own code, but
 * from a bundle built once per state of the code instead of transforming every .tsx file with
 * the Solid plugin on each start (about 3 s from source, about 0.4 s from the bundle).
 *
 * The bundle is keyed on the git trees of what it compiles in (src, package.json, bun.lock)
 * and on the Bun version, and lives in node_modules/.opentrading-dev/<key>/, where packages
 * resolve from the checkout's node_modules and src/core/bundle.ts finds the repo two folders
 * up. While any of those has uncommitted changes (work in progress), the source runs as before,
 * so the shims always run what is checked out. Plain TypeScript: no JSX runtime needed here.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"

/** The inputs a bundle is built from; a change to any of them means another bundle. */
export const BUNDLE_INPUTS = ["src", "package.json", "bun.lock"]
/** Bundles kept besides the one in use (another branch checked out and back). */
export const KEEP_BUNDLES = 3

export type Git = (args: string[]) => { ok: boolean; out: string }

const realGit =
  (root: string): Git =>
  (args) => {
    const run = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "ignore" })
    return { ok: run.success, out: run.stdout.toString() }
  }

/** The bundle key for this checkout, or undefined when the source must run (uncommitted changes, no git). */
export function bundleKey(git: Git, bunVersion = Bun.version): string | undefined {
  const status = git(["status", "--porcelain", "--", ...BUNDLE_INPUTS])
  if (!status.ok || status.out.trim() !== "") return undefined
  const trees = git(["rev-parse", ...BUNDLE_INPUTS.map((p) => `HEAD:${p}`)])
  if (!trees.ok) return undefined
  return createHash("sha1").update(trees.out).update(bunVersion).digest("hex").slice(0, 16)
}

export const bundlesDir = (root: string) => path.join(root, "node_modules", ".opentrading-dev")

/**
 * Packages left in node_modules, loaded at run time as from source (native OpenTUI and its
 * tree-sitter worker among them). Not solid-js and @opentui/solid: resolved without the Solid
 * plugin in front, solid-js would load its server build, where effects never run again; bundled,
 * the plugin swaps in the client build as the release binary does.
 */
export async function externals(root: string): Promise<string[]> {
  const pkg = (await Bun.file(path.join(root, "package.json")).json()) as { dependencies?: Record<string, string> }
  const kept = Object.keys(pkg.dependencies ?? {}).filter((name) => name !== "solid-js" && name !== "@opentui/solid")
  // index.tsx skips the preload in the bundle (build-info `prebundled`); keep it out of it too.
  return [...kept, "@opentui/core-*", "@opentui/solid/preload"]
}

/** Build the bundle into a temp folder, then move it in place; another start doing the same wins harmlessly. */
async function build(root: string, dir: string) {
  const { createSolidTransformPlugin } = await import("@opentui/solid/bun-plugin")
  const tmp = `${dir}.${process.pid}.tmp`
  rmSync(tmp, { recursive: true, force: true })
  const result = await Bun.build({
    entrypoints: [path.join(root, "src", "index.tsx")],
    outdir: tmp,
    target: "bun",
    external: await externals(root),
    splitting: true,
    plugins: [createSolidTransformPlugin()],
    define: { OPENTRADING_PREBUNDLED: "true" },
  })
  if (!result.success) {
    rmSync(tmp, { recursive: true, force: true })
    throw new AggregateError(result.logs, "bundle build failed")
  }
  try {
    renameSync(tmp, dir)
  } catch {
    rmSync(tmp, { recursive: true, force: true })
    if (!existsSync(path.join(dir, "index.js"))) throw new Error(`could not place the bundle in ${dir}`)
  }
}

/** Remove all but the newest `keep` bundles other than `current`. */
export function pruneBundles(base: string, current: string, keep = KEEP_BUNDLES) {
  let names: string[]
  try {
    // A ".tmp" folder is another start building right now.
    names = readdirSync(base).filter((n) => n !== current && !n.endsWith(".tmp"))
  } catch {
    return
  }
  const aged = names
    .map((n) => ({ n, at: (() => { try { return statSync(path.join(base, n)).mtimeMs } catch { return 0 } })() }))
    .sort((a, b) => b.at - a.at)
  for (const { n } of aged.slice(keep)) rmSync(path.join(base, n), { recursive: true, force: true })
}

/** The entry to import: the bundle for this checkout (built now if missing), or the source. */
export async function launchEntry(root: string, git: Git = realGit(root)): Promise<string> {
  const source = path.join(root, "src", "index.tsx")
  if (process.env.OPENTRADING_FROM_SOURCE === "1") return source
  const key = bundleKey(git)
  if (!key) return source
  const base = bundlesDir(root)
  const dir = path.join(base, key)
  const entry = path.join(dir, "index.js")
  if (existsSync(entry)) return entry
  try {
    mkdirSync(base, { recursive: true })
    await build(root, dir)
    pruneBundles(base, key)
    return entry
  } catch (error) {
    // The source still works: say why once and run it.
    process.stderr.write(`opentrading: chạy từ source (không dựng được bản nhanh: ${error instanceof Error ? error.message : String(error)})\n`)
    return source
  }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "../..")
  await import(await launchEntry(root))
}
