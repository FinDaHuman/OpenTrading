#!/usr/bin/env bun
export {}

/** `--continue` / `-c` reopens the newest session; `--resume <id>` / `-r <id>` a given one. */
function resumeArg(argv: string[]): string | undefined {
  const i = argv.findIndex((a) => a === "--resume" || a === "-r")
  if (i >= 0) return argv[i + 1] ?? "latest"
  if (argv.includes("--continue") || argv.includes("-c")) return "latest"
  return undefined
}

const argv = process.argv.slice(2)

// `opentrading mcp …` is a plain CLI: branch before anything loads the TUI or runtime.
// This file has no JSX, so the CLI also runs outside the repo (without bunfig's JSX setup).
if (argv[0] === "mcp") {
  const { runMcpCli } = await import("./cli/mcp")
  process.exit(await runMcpCli(argv.slice(1)))
}

const { startTui } = await import("./tui/main")
await startTui(resumeArg(argv))
