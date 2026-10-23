import { afterEach, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BUNDLED_ROOT, compiled, materialize } from "../src/core/bundle"
import { AGENTS_DIR, SKILLS_DIR } from "../src/core/paths"
import { PROMPTS_DIR } from "../src/core/prompt/assemble"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ot-bundle-"))
  dirs.push(dir)
  return dir
}

const assets = { "skills/a/SKILL.md": "skill a", "prompts/identity.md": "id", "market/calendar.json": "{}" }

test("from source the bundled files are the checkout's own folders", () => {
  expect(compiled).toBe(false)
  const repo = path.resolve(import.meta.dir, "..")
  expect(BUNDLED_ROOT).toBe(repo)
  expect(SKILLS_DIR).toBe(path.join(repo, "skills"))
  expect(AGENTS_DIR).toBe(path.join(repo, "agents"))
  expect(PROMPTS_DIR).toBe(path.join(repo, "prompts"))
})

test("materialize writes every file once and leaves no temporary folder", async () => {
  const base = await temp()
  const dir = materialize(assets, "0.2.0-aaaa", base)
  expect(dir).toBe(path.join(base, "0.2.0-aaaa"))
  expect(readFileSync(path.join(dir, "skills", "a", "SKILL.md"), "utf8")).toBe("skill a")
  expect(readFileSync(path.join(dir, "market", "calendar.json"), "utf8")).toBe("{}")
  expect(readdirSync(base)).toEqual(["0.2.0-aaaa"])

  // A second start with the same id reuses the copy (an edit there survives).
  writeFileSync(path.join(dir, "prompts", "identity.md"), "edited")
  materialize(assets, "0.2.0-aaaa", base)
  expect(readFileSync(path.join(dir, "prompts", "identity.md"), "utf8")).toBe("edited")
})

test("a folder without the completion mark is rewritten", async () => {
  const base = await temp()
  const dir = materialize(assets, "0.2.0-aaaa", base)
  await rm(path.join(dir, ".complete"))
  await rm(path.join(dir, "skills"), { recursive: true })
  materialize(assets, "0.2.0-aaaa", base)
  expect(existsSync(path.join(dir, "skills", "a", "SKILL.md"))).toBe(true)
  expect(existsSync(path.join(dir, ".complete"))).toBe(true)
})

test("a new version keeps the previous copy and removes older ones", async () => {
  const base = await temp()
  const age = (id: string, seconds: number) => {
    const t = new Date(Date.now() - seconds * 1000)
    utimesSync(path.join(base, id, ".complete"), t, t)
  }
  materialize(assets, "0.1.0-1111", base)
  age("0.1.0-1111", 300)
  materialize(assets, "0.2.0-2222", base)
  expect(readdirSync(base).sort()).toEqual(["0.1.0-1111", "0.2.0-2222"])
  age("0.2.0-2222", 200)
  materialize(assets, "0.3.0-3333", base)
  // 0.2.0 may still be open in another session; 0.1.0 goes.
  expect(readdirSync(base).sort()).toEqual(["0.2.0-2222", "0.3.0-3333"])
})

test("stale temporary folders from a crash are cleaned, fresh ones are left alone", async () => {
  const base = await temp()
  materialize(assets, "0.2.0-aaaa", base)
  const stale = path.join(base, ".tmp-0.2.0-aaaa-1-1")
  const fresh = path.join(base, ".tmp-0.2.0-aaaa-2-2")
  for (const d of [stale, fresh]) {
    await Bun.write(path.join(d, "x"), "x")
  }
  const old = new Date(Date.now() - 2 * 3_600_000)
  utimesSync(stale, old, old)
  materialize(assets, "0.2.0-aaaa", base)
  expect(existsSync(stale)).toBe(false)
  expect(statSync(fresh).isDirectory()).toBe(true)
})

test("a complete copy from another process is used as is", async () => {
  const base = await temp()
  const winner = materialize(assets, "0.2.0-aaaa", base)
  const again = materialize({ ...assets, "skills/a/SKILL.md": "ignored" }, "0.2.0-aaaa", base)
  expect(again).toBe(winner)
  expect(readFileSync(path.join(winner, "skills", "a", "SKILL.md"), "utf8")).toBe("skill a")
  expect(readdirSync(base).filter((n) => n.startsWith(".tmp-"))).toEqual([])
})
