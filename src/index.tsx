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
if (argv[0] === "mcp") {
  const { runMcpCli } = await import("./cli/mcp")
  process.exit(await runMcpCli(argv.slice(1)))
}

const [{ render }, { loadConfig }, { createMemory, initRuntime }, { App }, { state }, { color }] = await Promise.all([
  import("@opentui/solid"),
  import("./core/config"),
  import("./core/runtime"),
  import("./tui/app"),
  import("./tui/state"),
  import("./tui/theme"),
])

const config = await loadConfig()
const runtime = initRuntime({ skills: () => state.skills, memory: createMemory(config.memory?.provider) })

// Ctrl+C is handled inside the app; this is the fallback if the terminal still delivers SIGINT.
// Stop MCP servers first (bounded), so no child process outlives us on Windows.
process.on("SIGINT", async () => {
  await Promise.race([runtime.mcp.stop(), new Promise((r) => setTimeout(r, 2000))])
  process.exit(0)
})

await render(() => <App runtime={runtime} resume={resumeArg(argv)} />, {
  exitOnCtrlC: false,
  targetFps: 30,
  backgroundColor: color.bg,
})
