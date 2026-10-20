import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { FileIndex, indexFiles, matchPaths } from "../src/core/fs/file-index"

let base: string

async function tree(root: string) {
  await mkdir(path.join(root, "src", "tui"), { recursive: true })
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
  await mkdir(path.join(root, "build"), { recursive: true })
  await writeFile(path.join(root, "README.md"), "x")
  await writeFile(path.join(root, "báo-cáo.md"), "x")
  await writeFile(path.join(root, "src", "app.ts"), "x")
  await writeFile(path.join(root, "src", "tui", "transcript.tsx"), "x")
  await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "x")
  await writeFile(path.join(root, "build", "out.js"), "x")
  await writeFile(path.join(root, ".env"), "KEY=1")
}

const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" }).exitCode

beforeAll(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "ot-file-index-"))
})
afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe("indexFiles", () => {
  test("in a git repository: tracked and untracked files, .gitignore respected, names as they are", async () => {
    const root = path.join(base, "repo")
    await tree(root)
    await writeFile(path.join(root, ".gitignore"), "node_modules/\nbuild/\n")
    expect(git(root, "init", "-q")).toBe(0)
    git(root, "add", "README.md")
    const { paths } = await indexFiles(root)
    const rels = paths.map((p) => p.rel)
    expect(rels).toContain("README.md")
    // Untracked, and with a Vietnamese name (git would quote it without -z).
    expect(rels).toContain("báo-cáo.md")
    expect(rels).toContain("src/tui/transcript.tsx")
    // Folders come from the file paths.
    expect(rels).toContain("src/")
    expect(rels).toContain("src/tui/")
    expect(rels.some((r) => r.startsWith("node_modules") || r.startsWith("build"))).toBe(false)
    // Key files are never offered.
    expect(rels).not.toContain(".env")
  })

  test("outside git: the glob_files walk (package folders pruned, no secrets)", async () => {
    const root = path.join(base, "plain")
    await tree(root)
    const rels = (await indexFiles(root)).paths.map((p) => p.rel)
    expect(rels).toContain("báo-cáo.md")
    expect(rels).toContain("src/app.ts")
    expect(rels.some((r) => r.startsWith("node_modules"))).toBe(false)
    expect(rels).not.toContain(".env")
  })
})

describe("matchPaths", () => {
  test("name prefix first, then name, then path, then letters in order; accents ignored", async () => {
    const root = path.join(base, "plain")
    const { paths } = await indexFiles(root)
    expect(matchPaths(paths, "trans").map((p) => p.rel)[0]).toBe("src/tui/transcript.tsx")
    expect(matchPaths(paths, "bao-cao").map((p) => p.rel)).toEqual(["báo-cáo.md"])
    expect(matchPaths(paths, "stt").map((p) => p.rel)).toContain("src/tui/transcript.tsx")
    expect(matchPaths(paths, "zzz")).toEqual([])
  })

  test("an empty query lists the top level; `dir/` lists that folder, folders first", async () => {
    const { paths } = await indexFiles(path.join(base, "plain"))
    const top = matchPaths(paths, "").map((p) => p.rel)
    expect(top).toContain("src/")
    expect(top).toContain("README.md")
    expect(top).not.toContain("src/app.ts")
    expect(matchPaths(paths, "src/").map((p) => p.rel)).toEqual(["src/tui/", "src/app.ts"])
  })
})

test("FileIndex builds once, then again only when stale", async () => {
  const index = new FileIndex(path.join(base, "plain"))
  expect(index.current()).toEqual([])
  await index.refresh()
  const first = index.current()
  expect(first.length).toBeGreaterThan(0)
  await writeFile(path.join(base, "plain", "moi.md"), "x")
  await index.refresh()
  expect(index.current()).toBe(first)
  await index.refresh(Date.now() + 10_000)
  expect(index.current().map((p) => p.rel)).toContain("moi.md")
})
