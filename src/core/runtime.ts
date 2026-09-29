import path from "node:path"
import { McpManager } from "./mcp/manager"
import { dataDir } from "./paths"
import type { Skill } from "./skills"
import { currentTimeTool } from "./tools/builtin/current-time"
import { loadSkillTool } from "./tools/builtin/load-skill"
import { ToolRegistry } from "./tools/registry"

export interface Runtime {
  registry: ToolRegistry
  mcp: McpManager
}

/**
 * Build the tool registry and MCP manager. Called explicitly by the entry point (never on
 * import), so tests can build their own runtime against temporary directories. This is the
 * seam where a daemon would later live.
 */
export function initRuntime(opts: { cwd?: string; home?: string; skills: () => Skill[] }): Runtime {
  const home = opts.home ?? dataDir()
  const registry = new ToolRegistry()
  registry.register(currentTimeTool())
  registry.register(loadSkillTool(opts.skills))
  const mcp = new McpManager(registry, {
    home,
    cwd: opts.cwd ?? process.cwd(),
    trustFile: path.join(home, "mcp-trust.json"),
  })
  return { registry, mcp }
}
