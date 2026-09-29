import path from "node:path"
import { HookBus } from "./hooks"
import { McpManager } from "./mcp/manager"
import { FileMemory } from "./memory/file-memory"
import { NoopMemory, type MemoryProvider } from "./memory/types"
import { dataDir } from "./paths"
import type { Skill } from "./skills/schema"
import { currentTimeTool } from "./tools/builtin/current-time"
import { loadSkillTool } from "./tools/builtin/load-skill"
import { ToolRegistry } from "./tools/registry"

export interface Runtime {
  registry: ToolRegistry
  mcp: McpManager
  hooks: HookBus
  memory: MemoryProvider
}

export type MemoryChoice = "none" | "file"

/** Pick the memory implementation named in config (`memory.provider`). Default: off. */
export function createMemory(choice: MemoryChoice | undefined, home = dataDir()): MemoryProvider {
  return choice === "file" ? new FileMemory(path.join(home, "memory")) : new NoopMemory()
}

/**
 * Build the tool registry, hooks, memory and MCP manager. Called explicitly by the entry point
 * (never on import), so tests can build their own runtime against temporary directories. This
 * is the seam where a daemon would later live.
 */
export function initRuntime(opts: { cwd?: string; home?: string; skills: () => Skill[]; memory?: MemoryProvider }): Runtime {
  const home = opts.home ?? dataDir()
  const registry = new ToolRegistry()
  registry.register(currentTimeTool())
  registry.register(loadSkillTool(opts.skills))

  const hooks = new HookBus()
  const memory: MemoryProvider = opts.memory ?? new NoopMemory()
  for (const tool of memory.tools?.() ?? []) registry.register({ ...tool, source: `memory:${memory.id}` })
  memory.register?.(hooks)

  const mcp = new McpManager(registry, {
    home,
    cwd: opts.cwd ?? process.cwd(),
    trustFile: path.join(home, "mcp-trust.json"),
  })
  return { registry, mcp, hooks, memory }
}
