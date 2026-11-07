import { expect, test } from "bun:test"
import path from "node:path"
import { Script } from "node:vm"
import { TARGETS, targetName } from "../scripts/targets"

// CI's `npm` job packs and installs the packages for real; this checks the parts it cannot.
const launcher = path.resolve(import.meta.dir, "../scripts/npm/launcher.cjs")

test("the npm launcher is plain Node that parses", async () => {
  // Parsed in this process, as Node wraps a CommonJS module: under --parallel on the Windows
  // runner a spawned `node --check` hung past 20 s (main d85b9a1, #243), and again past its own
  // 15 s limit after the async spawn (#251, exit 143). Running it under real Node is the
  // Package workflow's npm job (3 OSes, `ot --version` from the installed package).
  const source = (await Bun.file(launcher).text()).replace(/^#!.*\n/, "\n")
  expect(() => new Script(`(function (exports, require, module, __filename, __dirname) {${source}\n})`, { filename: launcher })).not.toThrow()
  // The check would catch what Node rejects: TypeScript or an import in a .cjs file.
  expect(() => new Script("(function () { const x: number = 1 })")).toThrow()
  expect(() => new Script('(function () { import x from "y" })')).toThrow()
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
