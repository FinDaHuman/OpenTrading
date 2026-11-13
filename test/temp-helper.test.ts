import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { removeTempDir, tempDir } from "./helpers/temp"

// Runs from a throwaway folder: if the guard ever broke, rm("") would empty this one, not the checkout.
const sandbox = mkdtempSync(path.join(os.tmpdir(), "ot-temp-guard-"))
const outside = path.join(sandbox, "kept.txt")
writeFileSync(outside, "x")
const cwd = process.cwd()
afterAll(() => {
  process.chdir(cwd)
  rmSync(sandbox, { recursive: true, force: true })
})

test('removeTempDir(""), what an after hook passes when mkdtemp failed, removes nothing', async () => {
  process.chdir(sandbox)
  try {
    await removeTempDir("")
    expect(existsSync(outside)).toBe(true)
  } finally {
    process.chdir(cwd)
  }
})

test("removeTempDir removes a folder the test made under the system temp dir", async () => {
  const dir = await tempDir("ot-temp-guard-")
  mkdirSync(path.join(dir, "a"))
  await removeTempDir(dir)
  expect(existsSync(dir)).toBe(false)
})
