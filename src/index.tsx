#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { loadConfig } from "./core/config"
import { createMemory, initRuntime } from "./core/runtime"
import { App } from "./tui/app"
import { state } from "./tui/state"
import { color } from "./tui/theme"

/** `--continue` / `-c` reopens the newest session; `--resume <id>` / `-r <id>` a given one. */
function resumeArg(argv: string[]): string | undefined {
  const i = argv.findIndex((a) => a === "--resume" || a === "-r")
  if (i >= 0) return argv[i + 1] ?? "latest"
  if (argv.includes("--continue") || argv.includes("-c")) return "latest"
  return undefined
}

const config = await loadConfig()
const runtime = initRuntime({
  skills: () => state.skills,
  memory: createMemory(config.memory?.provider, undefined, config.memory),
})

// Ctrl+C is handled inside the app; this is the fallback if the terminal still delivers SIGINT.
// Stop MCP servers first (bounded), so no child process outlives us on Windows.
process.on("SIGINT", async () => {
  await Promise.race([runtime.mcp.stop(), new Promise((r) => setTimeout(r, 2000))])
  process.exit(0)
})

await render(() => <App runtime={runtime} resume={resumeArg(process.argv.slice(2))} />, {
  exitOnCtrlC: false,
  targetFps: 30,
  backgroundColor: color.bg,
})
