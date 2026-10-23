import path from "node:path"

/**
 * The CHANGELOG section of one version, used as the GitHub release notes.
 * Cách chạy: bun scripts/release-notes.ts 0.2.0 > notes.md   (exits 1 when the section is missing)
 */
export function releaseNotes(changelog: string, version: string): string | undefined {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## ["))
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim()
  return body || undefined
}

if (import.meta.main) {
  const version = process.argv[2]?.replace(/^v/, "")
  if (!version) throw new Error("usage: bun scripts/release-notes.ts <version>")
  const notes = releaseNotes(await Bun.file(path.resolve(import.meta.dir, "../CHANGELOG.md")).text(), version)
  if (!notes) {
    console.error(`CHANGELOG.md has no "## [${version}]" section (or it is empty)`)
    process.exit(1)
  }
  process.stdout.write(`${notes}\n`)
}
