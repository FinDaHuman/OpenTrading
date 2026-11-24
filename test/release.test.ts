import { expect, test } from "bun:test"
import path from "node:path"
import { releaseNotes } from "../scripts/release-notes"
import { TARGETS, archiveName, targetName } from "../scripts/targets"

const changelog = `# Changelog

## [Unreleased]

- next

## [0.2.0] — 2026-10-24

### Added

- binaries

## [0.1.0] — 2026-10-22

- first
`

test("release notes are one version's CHANGELOG section", () => {
  expect(releaseNotes(changelog, "0.2.0")).toBe("### Added\n\n- binaries")
  expect(releaseNotes(changelog, "0.1.0")).toBe("- first")
  expect(releaseNotes(changelog, "0.3.0")).toBeUndefined()
  // "0.1" must not match "0.1.0"
  expect(releaseNotes(changelog, "0.1")).toBeUndefined()
  expect(releaseNotes(changelog.replaceAll("\n", "\r\n"), "0.1.0")).toBe("- first")
})

test("targets: unique names, zip except on Linux", () => {
  const names = TARGETS.map(targetName)
  expect(new Set(names).size).toBe(names.length)
  expect(names).toContain("windows-x64")
  expect(names).toContain("darwin-arm64")
  expect(archiveName({ os: "linux", arch: "x64", baseline: true })).toBe("opentrading-linux-x64-baseline.tar.gz")
  expect(archiveName({ os: "windows", arch: "arm64" })).toBe("opentrading-windows-arm64.zip")
})

test("release.yml builds every target exactly once", async () => {
  const yml = await Bun.file(path.resolve(import.meta.dir, "../.github/workflows/release.yml")).text()
  const listed = [...yml.matchAll(/targets: (.+)/g)].flatMap((m) => m[1]!.trim().split(","))
  expect(listed.sort()).toEqual(TARGETS.map(targetName).sort())
})

test("release.yml checks the published release, and npm comes before publishing it", async () => {
  const yml = await Bun.file(path.resolve(import.meta.dir, "../.github/workflows/release.yml")).text()
  const { jobs } = Bun.YAML.parse(yml) as { jobs: Record<string, { needs?: string | string[]; uses?: string }> }
  expect(jobs.publish!.needs).toEqual(["release", "npm"])
  expect(jobs.verify).toMatchObject({ needs: "publish", uses: "./.github/workflows/verify-release.yml" })
})

test("verify-release.yml runs on every OS and CPU the release ships", async () => {
  const yml = await Bun.file(path.resolve(import.meta.dir, "../.github/workflows/verify-release.yml")).text()
  const { jobs } = Bun.YAML.parse(yml) as { jobs: { install: { strategy: { matrix: { include: { target: string }[] } } } } }
  const ran = jobs.install.strategy.matrix.include.map((m) => m.target)
  expect(ran.sort()).toEqual(TARGETS.filter((t) => !t.baseline).map(targetName).sort())
})
