#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { App } from "./tui/app"
import { color } from "./tui/theme"

// Ctrl+C is handled inside the app; this is the fallback if the terminal still delivers SIGINT.
process.on("SIGINT", () => process.exit(0))

await render(() => <App />, {
  exitOnCtrlC: false,
  targetFps: 30,
  backgroundColor: color.bg,
})
