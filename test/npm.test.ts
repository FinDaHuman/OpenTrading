import { expect, test } from "bun:test"
import path from "node:path"
import { TARGETS, targetName } from "../scripts/targets"

// CI's `npm` job packs and installs the packages for real; this checks the parts it cannot.
const launcher = path.resolve(import.meta.dir, "../scripts/npm/launcher.cjs")

test("the npm launcher is plain Node that parses", () => {
  const node = Bun.which("node")
  if (!node) return
  const run = Bun.spawnSync([node, "--check", launcher], { stdout: "pipe", stderr: "pipe" })
  expect(run.stderr.toString()).toBe("")
  expect(run.exitCode).toBe(0)
})

test("the launcher asks for the package names scripts/npm.ts publishes", async () => {
  const text = await Bun.file(launcher).text()
  expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true)
  expect(text).toContain("`opentrading-${osName}-${arch}`")
  expect(text).toContain("`${base}-baseline`")
  // Every platform the launcher can compute exists as a target.
  const names = new Set(TARGETS.map(targetName))
  for (const os of ["windows", "linux", "darwin"]) {
    for (const arch of ["x64", "arm64"]) expect(names.has(`${os}-${arch}`)).toBe(true)
    expect(names.has(`${os}-x64-baseline`)).toBe(true)
  }
})
