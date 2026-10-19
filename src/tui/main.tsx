import { render } from "@opentui/solid"
import { loadConfig } from "../core/config"
import { createMemory, initRuntime } from "../core/runtime"
import { App } from "./app"
import { requestExit, state } from "./state"
import { color } from "./theme"

/** Boot the TUI. Kept out of src/index.tsx so `opentrading mcp …` never needs a JSX runtime. */
export async function startTui(resume: string | undefined) {
  const config = await loadConfig()
  const runtime = initRuntime({ skills: () => state.skills, memory: createMemory(config.memory?.provider), workspaceDirs: config.workspace?.dirs })
  runtime.permissions.setMode(config.permissions?.defaultMode === "ask" ? "ask" : "read-only")

  // Ctrl+C is handled inside the app; this is the fallback if the terminal still delivers SIGINT.
  // Stop MCP servers first (bounded), so no child process outlives us on Windows.
  // Same exit path as /exit (renderer restored, session saved, MCP stopped); before the
  // app has mounted there is nothing to save.
  process.on("SIGINT", () => requestExit())

  await render(() => <App runtime={runtime} resume={resume} />, {
    exitOnCtrlC: false,
    targetFps: 30,
    backgroundColor: color.bg,
  })
}
