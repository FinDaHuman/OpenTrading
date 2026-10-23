import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { compiled } from "./build-info"
import { dataDir } from "./home"

/**
 * Where the files OpenTrading ships (skills/, agents/, prompts/, market/) are read from.
 *
 * Run from source: the checkout itself. In a binary built by scripts/build.ts there is no checkout:
 * the files are compiled in (OPENTRADING_ASSETS) and written out once per version to
 * ~/.opentrading/bundled/<version>-<hash>/, because the loaders walk real folders (readdir,
 * realpath, a skill's side files).
 */

// Set by scripts/build.ts with `define`; absent when running the source.
declare const OPENTRADING_ASSETS: Record<string, string> | undefined
declare const OPENTRADING_ASSETS_ID: string | undefined

const MARK = ".complete"

/**
 * Write `assets` to `<base>/<id>/` unless a complete copy is already there; returns that folder.
 * Written to a temporary folder and renamed, so a crash never leaves a half copy that looks done.
 * The newest older copy is kept (a session of the previous version may still be open and read its
 * skills); older ones go.
 */
export function materialize(assets: Record<string, string>, id: string, base: string): string {
  const target = path.join(base, id)
  if (!existsSync(path.join(target, MARK))) {
    // Not ours to keep (a copy someone emptied by hand): the rename below needs the name free.
    rmSync(target, { recursive: true, force: true })
    const tmp = path.join(base, `.tmp-${id}-${process.pid}-${Date.now()}`)
    for (const [rel, text] of Object.entries(assets)) {
      const file = path.join(tmp, rel)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    writeFileSync(path.join(tmp, MARK), id)
    try {
      renameSync(tmp, target)
    } catch (error) {
      rmSync(tmp, { recursive: true, force: true })
      // Another process won the race (Windows never renames onto an existing folder).
      if (!existsSync(path.join(target, MARK))) throw error
    }
  }
  prune(base, id)
  return target
}

function prune(base: string, keep: string) {
  const now = Date.now()
  const copies: { name: string; time: number }[] = []
  for (const name of readdirSync(base)) {
    const dir = path.join(base, name)
    try {
      if (name.startsWith(".tmp-")) {
        // Left by a crash; a live writer finishes in well under an hour.
        if (now - statSync(dir).mtimeMs > 3_600_000) rmSync(dir, { recursive: true, force: true })
        continue
      }
      if (name !== keep) copies.push({ name, time: statSync(path.join(dir, MARK)).mtimeMs })
    } catch {
      // not ours or already gone
    }
  }
  for (const old of copies.sort((a, b) => b.time - a.time).slice(1)) {
    try {
      rmSync(path.join(base, old.name), { recursive: true, force: true })
    } catch {
      // still in use (Windows): next start tries again
    }
  }
}

/** Folder holding skills/, agents/, prompts/ and market/. */
export const BUNDLED_ROOT = compiled
  ? materialize(OPENTRADING_ASSETS!, OPENTRADING_ASSETS_ID!, path.join(dataDir(), "bundled"))
  : path.resolve(import.meta.dir, "../..")
