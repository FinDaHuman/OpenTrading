#!/usr/bin/env bun
import path from "node:path"
import { HELP, parseCli, resolveDir } from "./cli/args"

const cli = parseCli(process.argv.slice(2))

// `opentrading mcp …` is a plain CLI: branch before anything loads the TUI or runtime.
// This file has no JSX, so the CLI also runs without the Solid transform.
if (cli.kind === "mcp") {
  const { runMcpCli } = await import("./cli/mcp")
  process.exit(await runMcpCli(cli.args))
}

if (cli.kind === "help") {
  process.stdout.write(HELP)
  process.exit(0)
}

if (cli.kind === "version") {
  const { build } = await import("./core/bundle")
  if (build) {
    process.stdout.write(`opentrading ${build.version} (${build.commit}, ${build.target})\ncài tại ${process.execPath}\n`)
    process.exit(0)
  }
  const root = path.resolve(import.meta.dir, "..")
  const { version } = await import("../package.json")
  let commit = ""
  try {
    const git = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root, stdout: "pipe", stderr: "ignore" })
    if (git.success) commit = ` (${git.stdout.toString().trim()})`
  } catch {
    // no git on PATH: the version alone
  }
  process.stdout.write(`opentrading ${version}${commit}\ncài tại ${root}\n`)
  process.exit(0)
}

if (cli.kind === "self-check") {
  const { selfCheck } = await import("./cli/self-check")
  process.exit(await selfCheck())
}

if (cli.kind === "error") {
  process.stderr.write(`${cli.message}\n`)
  process.exit(1)
}

if (cli.dir !== undefined) {
  const dir = resolveDir(cli.dir)
  if ("error" in dir) {
    process.stderr.write(`${dir.error}\n`)
    process.exit(1)
  }
  // Before anything reads process.cwd(): the workspace, project skills/agents, .mcp.json,
  // sessions and /export all follow the folder the user asked for.
  process.chdir(dir.path)
}

// Bun reads bunfig.toml (and its Solid preload) from the current folder only, so started from
// any other folder the JSX would not compile. Register the transform here instead.
// A binary is already compiled by scripts/build.ts.
const { compiled } = await import("./core/bundle")
if (!compiled) await import("@opentui/solid/preload")
const { startTui } = await import("./tui/main")
await startTui(cli.resume)
