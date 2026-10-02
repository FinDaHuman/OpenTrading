#!/usr/bin/env bun
/**
 * Run the real TUI with the SQLite memory provider, for trying memory before the runtime offers it in /config.
 * Same as src/index.tsx except for the memory provider. State lives in OPENTRADING_HOME (default ~/.opentrading);
 * point it at a throwaway directory to keep the demo away from your real data:
 *   $env:OPENTRADING_HOME = "$env:TEMP\opentrading-demo"; bun scripts/dev-memory.tsx
 * Do not toggle memory in /config while using this launcher: /config only knows the reference provider.
 */
import { render } from "@opentui/solid"
import { loadConfig } from "../src/core/config"
import { openSqliteMemory } from "../src/core/memory-root"
import { dataDir } from "../src/core/paths"
import { initRuntime } from "../src/core/runtime"
import { App } from "../src/tui/app"
import { state } from "../src/tui/state"
import { color } from "../src/tui/theme"

function resumeArg(argv: string[]): string | undefined {
  const i = argv.findIndex((a) => a === "--resume" || a === "-r")
  if (i >= 0) return argv[i + 1] ?? "latest"
  if (argv.includes("--continue") || argv.includes("-c")) return "latest"
  return undefined
}

const config = await loadConfig()
const memory = openSqliteMemory(dataDir(), { config: config.memory })
const runtime = initRuntime({ skills: () => state.skills, memory })

process.on("SIGINT", async () => {
  await Promise.race([runtime.mcp.stop(), new Promise((r) => setTimeout(r, 2000))])
  memory.close()
  process.exit(0)
})

await render(() => <App runtime={runtime} resume={resumeArg(process.argv.slice(2))} />, {
  exitOnCtrlC: false,
  targetFps: 30,
  backgroundColor: color.bg,
})
