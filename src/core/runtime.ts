import path from "node:path"
import { HookBus } from "./hooks"
import { AskBroker } from "./ask"
import { loadConfig } from "./config"
import { McpManager } from "./mcp/manager"
import { askUserTool } from "./tools/builtin/ask-user"
import { PermissionGate } from "./permission"
import { FileMemory } from "./memory/file-memory"
import { NoopMemory, type MemoryProvider } from "./memory/types"
import { dataDir } from "./paths"
import type { Skill } from "./skills/schema"
import { currentTimeTool } from "./tools/builtin/current-time"
import { loadSkillTool } from "./tools/builtin/load-skill"
import { chartDepthTool, chartRenderTool } from "./tools/chart/render"
import { chartCompareTool } from "./tools/chart/compare"
import { doctorLocalTool, sessionHistoryTools } from "./tools/session/history"
import { sendMessageTool, spawnSubagentTool, stopAgentTool } from "./tools/subagent/spawn"
import { SubagentManager } from "./subagents/manager"
import type { AgentDefinition } from "./agents/schema"
import { toolSearchTool } from "./tools/builtin/tool-search"
import { todoWriteTool } from "./tools/builtin/todo-write"
import { webFetchTool } from "./tools/web/fetch"
import { webSearchTool } from "./tools/web/search"
import { cycleStatsTools } from "./tools/cycle-stats/cycle-stats"
import { localWatchlistTools } from "./tools/watchlist/local"
import { ToolRegistry } from "./tools/registry"

export interface Runtime {
  registry: ToolRegistry
  /** Approval prompts for tools with side effects; the TUI answers them. */
  permissions: PermissionGate
  /** Questions from the model (ask_user); the TUI answers them. */
  questions: AskBroker
  mcp: McpManager
  hooks: HookBus
  /** Current memory provider; replaced in place by switchMemory (callers read it per turn). */
  memory: MemoryProvider
  /** Undo the current provider's hook subscriptions. */
  detachMemory?: () => void
  /** Subagents started by spawn_subagent: progress, limits, stop. */
  subagents: SubagentManager
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
  const permissions = new PermissionGate()
  registry.gate = permissions
  const questions = new AskBroker()
  registry.register(currentTimeTool())
  registry.register(askUserTool(questions))
  registry.register(todoWriteTool())
  registry.register(
    loadSkillTool(opts.skills, () =>
      registry
        .list()
        .filter((d) => d.deferrable)
        .map((d) => d.name),
    ),
  )
  registry.register(chartRenderTool())
  registry.register(chartCompareTool())
  registry.register(chartDepthTool())
  for (const tool of sessionHistoryTools()) registry.register(tool)
  for (const tool of localWatchlistTools(home)) registry.register(tool)
  for (const tool of cycleStatsTools(home)) registry.register(tool)
  registry.register(webFetchTool())
  registry.register(webSearchTool())

  const mcp = new McpManager(registry, {
    home,
    cwd: opts.cwd ?? process.cwd(),
    trustFile: path.join(home, "mcp-trust.json"),
  })
  registry.register(
    doctorLocalTool({
      mcpStatus: () => mcp.status().map((s) => ({ name: s.name, state: s.state, tools: s.tools })),
      model: async () => (await loadConfig()).model,
      home,
    }),
  )
  registry.register(toolSearchTool(registry, () => mcp.status().filter((s) => s.state === "connecting").map((s) => s.name)))
  const subagents = new SubagentManager({ parent: registry, skills: opts.skills, serverInstructions: () => mcp.instructions() })
  registry.register(spawnSubagentTool(subagents))
  registry.register(sendMessageTool(subagents))
  registry.register(stopAgentTool(subagents))
  const runtime: Runtime = { registry, permissions, questions, mcp, hooks: new HookBus(), memory: new NoopMemory(), subagents }
  switchMemory(runtime, opts.memory ?? new NoopMemory())
  return runtime
}

/** Re-register spawn_subagent with the loaded agent types (its description lists them). */
export function setAgents(runtime: Runtime, agents: AgentDefinition[]) {
  runtime.registry.register(spawnSubagentTool(runtime.subagents, agents))
  runtime.registry.register(sendMessageTool(runtime.subagents, agents))
}

/** Swap the memory provider live: its tools and hooks are replaced, nothing else restarts. */
export function switchMemory(runtime: Runtime, memory: MemoryProvider) {
  runtime.detachMemory?.()
  runtime.registry.unregisterSource(`memory:${runtime.memory.id}`)
  runtime.memory = memory
  for (const tool of memory.tools?.() ?? []) runtime.registry.register({ ...tool, source: `memory:${memory.id}` })
  const detach = memory.register?.(runtime.hooks)
  runtime.detachMemory = typeof detach === "function" ? detach : undefined
}
