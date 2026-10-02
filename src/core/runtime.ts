import path from "node:path"
import { HookBus } from "./hooks"
import { McpManager } from "./mcp/manager"
import { openSqliteMemory } from "./memory-root"
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
  /** Current memory provider; replaced in place by switchMemory (callers read it per turn). */
  memory: MemoryProvider
  /** Undo the current provider's hook subscriptions. */
  detachMemory?: () => void
}

/** "file" is the old reference provider's name; it now means the SQLite memory. */
export type MemoryChoice = "none" | "sqlite" | "file"

/**
 * Pick the memory implementation named in config (`memory.provider`). Default: off.
 * `config` is the whole `memory` section; the SQLite provider reads its own settings from it.
 */
export function createMemory(choice: MemoryChoice | undefined, home = dataDir(), config?: unknown): MemoryProvider {
  return choice === "sqlite" || choice === "file" ? openSqliteMemory(home, { config }) : new NoopMemory()
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

  const mcp = new McpManager(registry, {
    home,
    cwd: opts.cwd ?? process.cwd(),
    trustFile: path.join(home, "mcp-trust.json"),
  })
  const runtime: Runtime = { registry, mcp, hooks: new HookBus(), memory: new NoopMemory() }
  switchMemory(runtime, opts.memory ?? new NoopMemory())
  return runtime
}

/** Swap the memory provider live: its tools and hooks are replaced, nothing else restarts. */
export function switchMemory(runtime: Runtime, memory: MemoryProvider) {
  runtime.detachMemory?.()
  runtime.registry.unregisterSource(`memory:${runtime.memory.id}`)
  // A provider that holds a database connection releases it when it is switched out.
  if (runtime.memory !== memory) (runtime.memory as MemoryProvider & { close?: () => void }).close?.()
  runtime.memory = memory
  for (const tool of memory.tools?.() ?? []) runtime.registry.register({ ...tool, source: `memory:${memory.id}` })
  const detach = memory.register?.(runtime.hooks)
  runtime.detachMemory = typeof detach === "function" ? detach : undefined
}
