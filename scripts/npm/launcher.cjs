#!/usr/bin/env node
// `opentrading` / `ot` of the npm package: run the binary from this machine's platform package
// (opentrading-<os>-<arch>[-baseline], an optionalDependency). A launcher rather than a
// postinstall step: npm 12 blocks install scripts unless the user allows them.
"use strict"
const { spawn, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const osName = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform]
const arch = { x64: "x64", arm64: "arm64" }[process.arch]
const exe = process.platform === "win32" ? "opentrading.exe" : "opentrading"

function fail(message) {
  process.stderr.write(`opentrading: ${message}\n`)
  process.exit(1)
}

if (!osName || !arch) fail(`no build for ${process.platform}-${process.arch} (OpenTrading ships x64 and arm64 for Windows, macOS, Linux)`)

function hasAvx2() {
  if (process.platform === "linux") {
    try {
      return /\bavx2\b/i.test(fs.readFileSync("/proc/cpuinfo", "utf8"))
    } catch {
      return false
    }
  }
  if (process.platform === "darwin") return (spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], { encoding: "utf8" }).stdout || "").trim() === "1"
  return true // Windows: try the AVX2 build first; the baseline one is the fallback below.
}

function find() {
  const base = `opentrading-${osName}-${arch}`
  const names = arch === "x64" ? (hasAvx2() ? [base, `${base}-baseline`] : [`${base}-baseline`, base]) : [base]
  for (const name of names) {
    try {
      const file = path.join(path.dirname(require.resolve(`${name}/package.json`)), "bin", exe)
      if (fs.existsSync(file)) return file
    } catch {
      // not installed
    }
  }
  fail(`the binary package ${names.join(" / ")} is missing. Reinstall (npm i -g @findahuman/opentrading), or use the installer: https://github.com/FinDaHuman/OpenTrading#readme`)
}

const child = spawn(find(), process.argv.slice(2), { stdio: "inherit", windowsHide: false })
// The TUI reads ctrl+c itself (raw mode); the launcher only passes signals on and waits.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    try {
      child.kill(signal)
    } catch {
      // already gone
    }
  })
}
child.on("error", (error) => fail(error.message))
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
