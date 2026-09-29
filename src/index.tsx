#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { initRuntime } from "./core/runtime"
import { App } from "./tui/app"
import { state } from "./tui/state"
import { color } from "./tui/theme"

const runtime = initRuntime({ skills: () => state.skills })

// Ctrl+C is handled inside the app; this is the fallback if the terminal still delivers SIGINT.
// Stop MCP servers first (bounded), so no child process outlives us on Windows.
process.on("SIGINT", async () => {
  await Promise.race([runtime.mcp.stop(), new Promise((r) => setTimeout(r, 2000))])
  process.exit(0)
})

await render(() => <App runtime={runtime} />, {
  exitOnCtrlC: false,
  targetFps: 30,
  backgroundColor: color.bg,
})
