/** Platforms the release ships (scripts/build.ts, scripts/package.ts, install scripts). */
export interface Target {
  os: "windows" | "linux" | "darwin"
  arch: "x64" | "arm64"
  /** x64 CPUs without AVX2. */
  baseline?: boolean
}

export const TARGETS: Target[] = [
  { os: "windows", arch: "x64" },
  { os: "windows", arch: "x64", baseline: true },
  { os: "windows", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", baseline: true },
  { os: "linux", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", baseline: true },
  { os: "darwin", arch: "arm64" },
]

export const targetName = (t: Target) => [t.os, t.arch, t.baseline ? "baseline" : undefined].filter(Boolean).join("-")

export const archiveName = (t: Target) => `opentrading-${targetName(t)}.${t.os === "linux" ? "tar.gz" : "zip"}`
