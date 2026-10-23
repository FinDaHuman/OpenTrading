import { expect, test } from "bun:test"
import path from "node:path"
import { TARGETS, archiveName, targetName } from "../scripts/targets"

// The installers run on machines without the repo; CI's `install` job runs them for real.
const root = path.resolve(import.meta.dir, "..")
const ps1 = await Bun.file(path.join(root, "install.ps1")).text()
const sh = await Bun.file(path.join(root, "install.sh")).text()

test("install.ps1 is ASCII (PowerShell 5.1 reads a file without BOM in the ANSI code page)", () => {
  expect([...ps1].filter((c) => c.charCodeAt(0) > 127)).toEqual([])
})

test("install.ps1 never calls exit: under `irm | iex` that would close the user's window", () => {
  const code = ps1.split("\n").filter((l) => !l.trim().startsWith("#"))
  expect(code.filter((l) => /\bexit\b/.test(l))).toEqual([])
})

test("installers ask for the archive names the release publishes", () => {
  const names = TARGETS.map(archiveName)
  for (const t of TARGETS.filter((t) => t.os === "windows")) expect(ps1).toContain(`"${targetName(t)}"`)
  expect(ps1).toContain('$asset = "opentrading-$target.zip"')
  expect(sh).toContain('asset="opentrading-$name.tar.gz"')
  expect(sh).toContain('asset="opentrading-$name.zip"')
  expect(names).toContain("opentrading-windows-x64-baseline.zip")
  expect(names).toContain("opentrading-linux-arm64.tar.gz")
  expect(names).toContain("opentrading-darwin-x64-baseline.zip")
  expect(TARGETS.map(targetName)).toContain("windows-arm64")
})

test("install.sh stops on the first error", () => {
  expect(sh.startsWith("#!/usr/bin/env bash\n")).toBe(true)
  expect(sh).toContain("set -euo pipefail")
})
