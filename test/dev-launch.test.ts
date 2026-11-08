import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { BUNDLE_INPUTS, bundleKey, launchEntry, pruneBundles, type Git } from "../src/cli/dev-launch"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A git that answers status and rev-parse from these values and records what it was asked. */
function fakeGit(status: string, trees = "aaa\nbbb\nccc\n", ok = true) {
  const asked: string[][] = []
  const git: Git = (args) => {
    asked.push(args)
    if (!ok) return { ok: false, out: "" }
    return { ok: true, out: args[0] === "status" ? status : trees }
  }
  return { git, asked }
}

test("the key follows the git trees of src, package.json and bun.lock, and the Bun version", () => {
  const { git, asked } = fakeGit("")
  const key = bundleKey(git, "1.4.4")!
  expect(key).toMatch(/^[0-9a-f]{16}$/)
  expect(asked[0]).toEqual(["status", "--porcelain", "--", ...BUNDLE_INPUTS])
  expect(asked[1]).toEqual(["rev-parse", "HEAD:src", "HEAD:package.json", "HEAD:bun.lock"])
  expect(bundleKey(fakeGit("").git, "1.4.4")).toBe(key)
  expect(bundleKey(fakeGit("", "aaa\nbbb\nddd\n").git, "1.4.4")).not.toBe(key)
  expect(bundleKey(fakeGit("").git, "1.4.5")).not.toBe(key)
})

test("uncommitted or untracked changes in what the bundle holds, or no git: the source runs", async () => {
  expect(bundleKey(fakeGit(" M src/tui/app.tsx\n").git)).toBeUndefined()
  expect(bundleKey(fakeGit("?? src/new.ts\n").git)).toBeUndefined()
  expect(bundleKey(fakeGit("", "", false).git)).toBeUndefined()
  const root = mkdtempSync(path.join(os.tmpdir(), "ot-launch-"))
  dirs.push(root)
  expect(await launchEntry(root, fakeGit(" M src/x.ts\n").git)).toBe(path.join(root, "src", "index.tsx"))
})

test("an existing bundle for the key is used without building; OPENTRADING_FROM_SOURCE=1 forces the source", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ot-launch-"))
  dirs.push(root)
  const { git } = fakeGit("")
  const dir = path.join(root, "node_modules", ".opentrading-dev", bundleKey(git)!)
  mkdirSync(dir, { recursive: true })
  await Bun.write(path.join(dir, "index.js"), "")
  expect(await launchEntry(root, git)).toBe(path.join(dir, "index.js"))
  process.env.OPENTRADING_FROM_SOURCE = "1"
  try {
    expect(await launchEntry(root, git)).toBe(path.join(root, "src", "index.tsx"))
  } finally {
    delete process.env.OPENTRADING_FROM_SOURCE
  }
})

test("old bundles beyond the newest few go; the one in use and builds in progress stay", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "ot-bundles-"))
  dirs.push(base)
  const names = ["a", "b", "c", "d", "e"]
  names.forEach((n, i) => {
    mkdirSync(path.join(base, n))
    const at = new Date(Date.now() - (names.length - i) * 60_000)
    utimesSync(path.join(base, n), at, at)
  })
  mkdirSync(path.join(base, "f.123.tmp"))
  // "a" is the oldest but in use.
  pruneBundles(base, "a", 3)
  expect(readdirSync(base).sort()).toEqual(["a", "c", "d", "e", "f.123.tmp"])
})
